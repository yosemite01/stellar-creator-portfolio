# Leaderboard: Anti-Gaming and Efficient Ranking at Scale

**Issue:** [#1777](https://github.com/yosemite01/stellar-creator-portfolio/issues/1777)  
**Difficulty:** Hard · **Estimated size:** L (1–2 weeks)

---

## Background

The leaderboard currently runs two full-table Prisma queries on every request and sorts all creators in JavaScript. Redis exists in the codebase (`lib/storage/redis.ts`) but is not used for ranking. There is no anti-gaming logic: a creator can inflate their earnings rank by funding their own bounties. This work moves ranking to Redis sorted sets updated from events, adds self-dealing exclusion, implements a periodic recompute, and adds server-side pagination.

---

## Current State

### Server component — `app/leaderboard/page.tsx`

Runs on every request (note: `export const dynamic = 'force-dynamic'` overrides the `export const revalidate = 3600` setting, so ISR is never used):

1. `prisma.creatorProfile.findMany({ include: { user: true } })` — loads **all** creator profiles with no limit.
2. `prisma.escrow.findMany({ where: { status: 'released' }, select: { creatorId, amount } })` — loads **all** released escrows.
3. Groups escrow amounts into `earningsMap: Record<userId, number>`.
4. Sorts all profiles in JavaScript and builds `rankByUser: Map<userId, rank>`.
5. Serialises each profile to `CreatorLeaderboardItem` with an `earningsBucket` string (`'<1k'`, `'1k–5k'`, `'5k–10k'`, `'10k+'`) and an integer `earningsRank`.

### Client component — `components/analytics/leaderboard-client.tsx`

Three sort modes, URL-persisted:
- **Top by Discipline**: filter by discipline, sort by `rating` desc then `completedProjects` desc.
- **Top Earners**: sort by `earningsRank` asc (server-assigned).
- **Rising Stars**: creators with `createdAt >= 90 days ago`, sort by `rating` desc.

Renders only the first 20 entries from the active list (`top20 = currentList.slice(0, 20)`). There is no pagination — all creators are loaded and transmitted to the browser.

### Known bugs

| Bug | Location | Impact |
|---|---|---|
| Rating scaling (`Math.round(c.rating * 100)`) | `app/leaderboard/page.tsx` line 44 | `4.5 → 450`; displayed as `"450.0"` instead of `"4.5"` |
| `force-dynamic` overrides `revalidate` | Same file | Full-table Prisma queries on every page load |
| No anti-gaming | Escrow aggregation | Self-funded bounties inflate earnings rank |
| No pagination | Both files | All creator rows sent to every browser |

### Redis — `lib/storage/redis.ts`

A gracefully-degrading ioredis singleton. Exports `redisGet`, `redisSet`, `redisDel`, `redisIncr`. Key namespaces: `creators:*`, `bounties:*`, `users:*`, `rl:*`. **No sorted set helpers exist.** Redis is not referenced anywhere in the leaderboard code.

---

## Proposed Implementation

### 1. Redis sorted sets updated from events

Add sorted-set helpers to `lib/storage/redis.ts`:

```ts
// Leaderboard key: leaderboard:{metric}
// Score: earnings in XLM (integer stroops or cents to avoid float imprecision)
export async function leaderboardAdd(
  metric: string,
  userId: string,
  score: number,
): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  await redis.zadd(`leaderboard:${metric}`, score, userId);
}

export async function leaderboardIncrBy(
  metric: string,
  userId: string,
  delta: number,
): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  await redis.zincrby(`leaderboard:${metric}`, delta, userId);
}

export async function leaderboardRange(
  metric: string,
  start: number,
  stop: number,
): Promise<Array<{ userId: string; score: number }>> {
  const redis = getClient();
  if (!redis) return [];
  const result = await redis.zrevrange(`leaderboard:${metric}`, start, stop, 'WITHSCORES');
  const out: Array<{ userId: string; score: number }> = [];
  for (let i = 0; i < result.length; i += 2) {
    out.push({ userId: result[i]!, score: parseFloat(result[i + 1]!) });
  }
  return out;
}

export async function leaderboardRank(
  metric: string,
  userId: string,
): Promise<number | null> {
  const redis = getClient();
  if (!redis) return null;
  const rank = await redis.zrevrank(`leaderboard:${metric}`, userId);
  return rank !== null ? rank + 1 : null; // 1-indexed
}

export async function leaderboardCount(metric: string): Promise<number> {
  const redis = getClient();
  if (!redis) return 0;
  return redis.zcard(`leaderboard:${metric}`);
}
```

**Where to call `leaderboardIncrBy`:** hook into the escrow release event. Create or extend a service function called when an escrow is released:

```ts
// server/services/escrow-service.ts (extend releaseEscrow)
import { leaderboardIncrBy } from '@/lib/storage/redis';

async function releaseEscrow(escrowId: string): Promise<void> {
  const escrow = await prisma.escrow.update({
    where: { id: escrowId },
    data: { status: 'released', releasedAt: new Date() },
  });

  // Only add to leaderboard if not self-dealing (see section 2)
  if (!isSelfDealing(escrow)) {
    await leaderboardIncrBy('earnings', escrow.creatorId, escrow.amount);
  }
}
```

### 2. Exclude self-dealing and wash activity

**Self-dealing:** a release where `escrow.clientId === escrow.creatorId` or where the escrow funder and recipient share a funding source.

Add a `clientId` column to the `Escrow` model if not present, then:

```ts
function isSelfDealing(escrow: { creatorId: string; clientId: string | null }): boolean {
  return escrow.clientId === escrow.creatorId;
}
```

For wash activity (a creator funding many small bounties from multiple accounts to themselves), add a velocity check: if a single `clientId` has released more than N escrows to the same `creatorId` within a rolling 7-day window, exclude those escrows from the leaderboard score. Implement as a database query on the recompute path:

```sql
-- Suspicious pairs: same client→creator with >= 10 releases in 7 days
SELECT client_id, creator_id, COUNT(*) as cnt
FROM escrows
WHERE status = 'released'
  AND released_at > NOW() - INTERVAL '7 days'
GROUP BY client_id, creator_id
HAVING COUNT(*) >= 10;
```

Apply these exclusions in the periodic recompute (see section 3).

### 3. Periodic recompute

Recompute the full sorted set nightly or on-demand from the database (this is the source of truth; Redis is the read cache). Create `app/api/cron/leaderboard-recompute/route.ts`:

```ts
// app/api/cron/leaderboard-recompute/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { leaderboardAdd } from '@/lib/storage/redis';
import { withRequestId } from '@/lib/request-id-middleware';
import { logger } from '@/lib/logger';

export const GET = withRequestId(async (req: NextRequest) => {
  // Vercel Cron / internal secret guard
  if (req.headers.get('x-cron-secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Load released escrows, excluding self-dealing and wash pairs
  const escrows = await prisma.$queryRaw<{ creatorId: string; total: bigint }[]>`
    SELECT e.creator_id AS "creatorId", SUM(e.amount) AS total
    FROM escrows e
    WHERE e.status = 'released'
      AND e.client_id <> e.creator_id          -- exclude self-dealing
      AND NOT EXISTS (                          -- exclude wash pairs
        SELECT 1 FROM (
          SELECT client_id, creator_id
          FROM escrows
          WHERE status = 'released'
            AND released_at > NOW() - INTERVAL '7 days'
          GROUP BY client_id, creator_id
          HAVING COUNT(*) >= 10
        ) suspicious
        WHERE suspicious.client_id = e.client_id
          AND suspicious.creator_id = e.creator_id
      )
    GROUP BY e.creator_id
  `;

  // Replace leaderboard:earnings entirely (atomic rename with MULTI/EXEC)
  const redis = (await import('@/lib/storage/redis')).getClient?.();
  if (redis) {
    const pipeline = redis.pipeline();
    pipeline.del('leaderboard:earnings:next');
    for (const row of escrows) {
      pipeline.zadd('leaderboard:earnings:next', Number(row.total), row.creatorId);
    }
    pipeline.rename('leaderboard:earnings:next', 'leaderboard:earnings');
    await pipeline.exec();
  }

  logger.info('[leaderboard] recompute complete', { count: escrows.length });
  return NextResponse.json({ ok: true, count: escrows.length });
});
```

Add a Vercel Cron entry to `vercel.json`:
```json
{
  "crons": [{ "path": "/api/cron/leaderboard-recompute", "schedule": "0 2 * * *" }]
}
```

### 4. Pagination

Replace the full-table server component with a paginated API route:

```ts
// app/api/leaderboard/route.ts
import { withRequestId } from '@/lib/request-id-middleware';
import { leaderboardRange, leaderboardCount } from '@/lib/storage/redis';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const QuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
  metric: z.enum(['earnings', 'rating']).default('earnings'),
});

export const GET = withRequestId(async (req: NextRequest) => {
  const params = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!params.success) return NextResponse.json({ error: 'Invalid params' }, { status: 400 });

  const { page, limit, metric } = params.data;
  const start = (page - 1) * limit;
  const stop = start + limit - 1;

  const [entries, total] = await Promise.all([
    leaderboardRange(metric, start, stop),
    leaderboardCount(metric),
  ]);

  if (entries.length === 0) {
    return NextResponse.json({ creators: [], total, page, limit });
  }

  const userIds = entries.map((e) => e.userId);
  const profiles = await prisma.creatorProfile.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, displayName: true, avatar: true, discipline: true, rating: true, completedProjects: true },
  });

  const profileMap = new Map(profiles.map((p) => [p.userId, p]));
  const creators = entries.map((e, i) => ({
    rank: start + i + 1,
    ...profileMap.get(e.userId),
    score: e.score,
  }));

  return NextResponse.json({ creators, total, page, limit, pages: Math.ceil(total / limit) });
});
```

Update `app/leaderboard/page.tsx` to call this endpoint (or convert it to use `leaderboardRange` directly on the server) instead of raw Prisma queries.

**Client-side pagination:** add `page` to the URL query params (alongside `sort` and `discipline`) and fetch the next page on scroll or button click.

### 5. Fix the rating scaling bug

```ts
// app/leaderboard/page.tsx — remove Math.round(c.rating * 100)
rating: c.rating,  // already a float from Prisma; display directly
```

In `components/analytics/leaderboard-client.tsx`, display as:
```tsx
{creator.rating.toFixed(1)}
```

---

## Data Model

### Redis keys

| Key | Type | TTL | Contents |
|---|---|---|---|
| `leaderboard:earnings` | Sorted set | None (permanent; recomputed nightly) | `userId → earnings score` |
| `leaderboard:earnings:next` | Sorted set | Transient (renamed during recompute) | Atomic swap buffer |

### Escrow schema additions

If `clientId` is not already a column on `Escrow`, add it:

```prisma
model Escrow {
  // ... existing fields ...
  clientId  String?  // the account that funded the escrow
  client    User?    @relation("EscrowClient", fields: [clientId], references: [id])
}
```

---

## Failure Modes

| Scenario | Behaviour |
|---|---|
| Redis is unavailable | `leaderboardRange()` returns `[]`; fall back to Prisma query (same as today) |
| Recompute cron fails | Stale leaderboard served from Redis; alert via logger; nightly retry will recover |
| Rename fails mid-recompute | `leaderboard:earnings` retains old data; `leaderboard:earnings:next` is left behind and deleted at the start of the next recompute |
| Self-dealing creator has no clean escrows | Score is 0; still appears on leaderboard at the bottom |

---

## Test Plan

| Test | What to verify |
|---|---|
| `isSelfDealing` unit test | Returns `true` when `clientId === creatorId` |
| Wash-trading fixture | Recompute query excludes escrows from a client→creator pair with ≥ 10 releases in 7 days |
| `leaderboardRange` unit test | Returns entries in descending score order |
| Pagination | `GET /api/leaderboard?page=2&limit=5` returns entries 6–10 |
| Redis fallback | When `REDIS_URL` is unset, leaderboard page renders from Prisma without error |
| Rating display | Stored `4.5` → displayed `"4.5"` (not `"450.0"`) |

---

## Acceptance Criteria

- [ ] Leaderboard reads from Redis sorted sets; Prisma full-table queries only run during nightly recompute.
- [ ] Self-dealing escrows (same `clientId` and `creatorId`) are excluded from scores.
- [ ] Wash-activity pairs (≥10 releases in 7 days between the same pair) are excluded.
- [ ] API route returns paginated results; no more than `limit` creator rows per request.
- [ ] Rating is displayed correctly as a decimal (e.g., `"4.5"`).
- [ ] CI is green (lint, type-check, tests).
- [ ] No new TODOs without a linked issue.

---

## Definition of Done

- Code merged to `main` with tests.
- Acceptance criteria above all checked.
- PR description explains the change, links this issue (`Closes #1777`), and lists anything deferred.
- Docs updated where user-facing or integrator-facing behaviour changed.

---

## Getting Started

```bash
git clone https://github.com/yosemite01/stellar-creator-portfolio.git
cd stellar-creator-portfolio
pnpm install
cp .env.example .env.local   # set REDIS_URL=redis://localhost:6379
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
# Rust API + canonical contracts
cd backend && cargo test --workspace
make check-all
```

Write a short design note in the PR (Redis key schema, anti-gaming rules and their thresholds, pagination cursor vs. offset trade-off) before the bulk of the implementation.
