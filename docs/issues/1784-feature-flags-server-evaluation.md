# #1784: Feature flags: server-side evaluation with audit and percentage rollout

## Context
Flags live in Postgres (`FeatureFlag`, `FeatureFlagEvaluation` in
[prisma/schema.prisma](../../prisma/schema.prisma)). They are evaluated by
`evaluateFlag` in [lib/feature-flags/service.ts](../../lib/feature-flags/service.ts),
with a 60 s Redis cache. Three paths reach it:

| Path | File | How it builds the context |
| --- | --- | --- |
| Route guard | [lib/feature-flags/middleware.ts](../../lib/feature-flags/middleware.ts) `withFeatureFlag` | `userId` and `role` from the session, `platform` from `x-platform` |
| Multi-flag guard | same file, `withFeatureFlags` | `userId` and `role` only. **No `platform`**, so platform segments never match |
| HTTP endpoint | [app/api/feature-flags/evaluate/route.ts](../../app/api/feature-flags/evaluate/route.ts) | Session user, **or `?userId=` from the query string** |

Some parts already work:
- **Sticky bucketing.** `rolloutBucket` hashes `sha256("<flag>:<userId>")` and maps the
  first 16 bits to 0–100, so a user stays in the same bucket for a given flag.
- **Audit on edits.** `PATCH` and `DELETE` on `/api/admin/feature-flags/[name]` write an
  `AuditLog` row with the before and after state (#1614).

Gaps:
1. **The evaluate endpoint trusts the client.** An anonymous caller can pass any
   `userId` and see which bucket that user is in. The response is also
   `Cache-Control: public, s-maxage=60`, so a CDN can serve one user's answer to another.
   When `userId` comes from the query string and there is no session,
   `requireAuth({ user: undefined })` runs, so the anonymous path either throws or
   behaves inconsistently.
2. **Create is not audited.** `POST /api/admin/feature-flags`
   ([route.ts](../../app/api/admin/feature-flags/route.ts)) calls `upsertFlag` and writes
   no `AuditLog` row. Because it is an upsert, it can also overwrite an existing flag
   without any record.
3. **No real kill switch.** Turning a flag off writes `enabled=false` and deletes the
   cache key. Other instances can still read a stale value, and a Redis outage falls
   back to the DB. There is no single, documented "off now, everywhere" control, and no
   global "all risky flags off" control either.
4. **No SSR integration.** Server components and pages cannot get the evaluated flags
   for a request, so client components fetch `/evaluate` one flag at a time. That causes
   a flash of the wrong UI and repeats the client-trust problem.
5. **Anonymous users are always out** of a partial rollout (`rolloutPercent` between 1
   and 99), because there is no stable anonymous ID.

## Why it matters
Risky features need a controlled rollout that the server decides and the client
cannot influence. Every change to that rollout needs to be attributable, and an
operator needs to be able to turn a feature off quickly.

## Suggested approach
1. **One server-side context builder.** Add `buildFlagContext(req)` to
   `lib/feature-flags/context.ts`. It takes `userId` and `role` from the session only,
   reads `platform` from a header checked against an allowlist, and adds an `anonId`
   from a signed, HTTP-only `ff_anon` cookie that it creates if missing. Both
   middleware helpers and the endpoint use it. Remove the `?userId=` query parameter.
2. **Bucketing.** Keep the current hash so existing users stay in their buckets. Bucket
   on `userId ?? anonId`. Add an optional `salt` column to `FeatureFlag`, so a
   re-rollout can reshuffle users on purpose without renaming the flag. Fix the bucket
   range to `0–99` (`% 100` on the 32-bit prefix) so `rolloutPercent = N` means exactly
   N%.
3. **Kill switches.**
   - Add a `killSwitch Boolean @default(false)` column. If it is true, `evaluateFlag`
     returns `false` before it checks segments or rollout.
   - Add `PUT /api/admin/feature-flags/[name]/kill`. It sets the column, deletes the
     cache key, and publishes the flag name on a Redis channel (`feature_flag:invalidate`).
     Each instance subscribes to that channel and clears its in-process copy.
   - Add an environment override, `FEATURE_FLAGS_FORCE_OFF=flag_a,flag_b`, for
     incidents when the DB or Redis is down. It is checked first.
4. **Audit.** Add the same `AuditLog` write to the `POST` handler: `action: 'create'`,
   or `'update'` if the upsert hit an existing row. Use `resource: 'feature_flag'`
   for kill-switch changes too, so a single filter shows a flag's full history.
5. **SSR.** Add `getServerFlags(names)` (it reads the context with `headers()` and
   `cookies()`) for server components. Add a `<FlagsProvider>` that hydrates the
   evaluated values into a `useFlag(name)` hook. Client code reads the hydrated values
   and never calls `/evaluate` for the current user.
6. **Endpoint caching.** Change `/api/feature-flags/evaluate` to
   `Cache-Control: private, no-store`, because the answer depends on the user. Batch it
   with `?flags=a,b,c` so it makes one round trip.
7. **Evaluation logging.** `FeatureFlagEvaluation` gets a row on every evaluation. Sample
   it (for example 1%, configurable) so it doesn't grow without limit. Audit is for
   changes, evaluation logs are for analytics, and they should stay separate.

## Docs to update
- `docs/FEATURES.md`: how to add a flag, use `getServerFlags` and `useFlag`, and use
  the kill switch and the env override.
- Header comment in `lib/feature-flags/service.ts`: evaluation order (env override →
  kill switch → enabled → segment → rollout).

## Test plan
- **Deterministic bucketing:** the same `(flag, userId)` gets the same result across
  1,000 calls and across fresh process instances. A fixed vector of IDs produces fixed
  expected buckets, as a snapshot test, so any change to the hash fails CI.
- **Distribution:** at 10,000 synthetic IDs and `rolloutPercent = 25`, the share of
  users in the rollout is within ±2%.
- **Monotonic rollout:** a user who is in at 20% is still in at 50%.
- **Salt:** changing `salt` reshuffles the buckets, and leaving it unchanged does not.
- **Kill switch:** `killSwitch=true` returns false even at 100% rollout, and the env
  override wins when Prisma is mocked to throw.
- **Client can't spoof:** `GET /evaluate?userId=other` without a session ignores
  `userId`. The response has `Cache-Control: private`.
- **Audit:** `POST`, `PATCH`, `DELETE` and kill each write exactly one `AuditLog` row
  that includes the admin's ID.
- **SSR:** `getServerFlags` returns the same values as `evaluateFlag` for the same
  request context.

## Acceptance criteria
- [ ] All flag decisions come from the server-built context, and the client cannot
      choose a bucket.
- [ ] Every flag mutation is audited, including create and kill.
- [ ] The kill switch takes effect on every instance without waiting out the cache TTL.
- [ ] CI is green (lint, type-check, tests).
- [ ] No new TODOs without a linked issue.
