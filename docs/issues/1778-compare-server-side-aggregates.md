# #1778: Compare page — server-side comparison with cached aggregates

## Context

`app/compare/page.tsx` is a client component that imports the full in-memory creator
catalogue from `lib/services/creators-data` and filters it on the client:

```ts
// app/compare/page.tsx
import { creators as allCreators, Creator } from '@/lib/services/creators-data';
// …
const matched = allCreators.filter((c) => idList.includes(c.id));
```

`components/compare/comparison-context.tsx` holds the selection state in React, with
no server round-trip. The page resolves IDs from `?ids=a,b,c` on the client only, and
shares the full `Creator` shape, which may include private fields, with the browser.

There is no dedicated comparison endpoint, no caching, and no stable shareable URL that
can be linked from outside the browser session.

## Why it matters

Fetching full profiles client-side has three problems:

1. **Privacy.** The `Creator` type may carry private fields that the comparison view
   doesn't need. Sending all of them to the browser over-shares.
2. **Performance.** As the creator catalogue grows, importing the full dataset for every
   compare page load wastes bandwidth and increases Time to Interactive.
3. **Shareability.** A URL like `/compare?ids=a,b,c` works only if the client already
   has the data catalogue loaded. It is not a stable link that another user, or a crawler,
   can resolve without running JavaScript.

## Suggested approach

### 1. Dedicated comparison endpoint

Add `GET /api/compare?ids=a,b,c` (up to 3–5 IDs). The route lives in
`app/api/compare/route.ts`. Input is validated with zod:

```ts
const schema = z.object({
  ids: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(2).max(5)),
});
```

The route queries only the public aggregate fields needed for comparison — display name,
discipline, skills, rating, completed bounty count, and hourly rate range. It never
returns email, wallet address, or any other private field. Business logic lives in
`lib/server/services/compare-service.ts`.

### 2. Response shape

```ts
export interface CreatorCompareSummary {
  id: string;
  displayName: string;
  discipline: string;
  skills: string[];
  avgRating: number | null;
  ratingCount: number;
  completedBounties: number;
  hourlyRateMin: number | null;
  hourlyRateMax: number | null;
  avatarUrl: string | null;
}
```

No other fields leave the server.

### 3. Caching

Cache the response in Redis with a key of `compare:<sorted-ids>` (IDs sorted
alphabetically before hashing, so `a,b` and `b,a` share the same entry). TTL: 60
seconds. Invalidate on profile update. This keeps the endpoint cheap enough to call
on every page load without hammering the database.

If Redis is unavailable, fall through to a direct DB query rather than erroring.

### 4. Shareable URLs

Move the page to a Next.js Server Component. The URL `/compare?ids=a,b,c` renders
server-side, returns a fully populated HTML response, and is indexable. The
`ComparisonContext` can remain for client-side selection (adding/removing creators
from the compare bar), but the initial render should not depend on it.

### 5. Update the compare bar

`components/compare/comparison-context.tsx` builds the `?ids=` query string when the
user clicks "Compare". That string becomes the canonical shareable link. No changes to
the context interface are required; the bar can keep its current `Creator` selection
state for the interactive flow.

## Test plan

Write the failing test first.

- **Private field exclusion (key test):** call `GET /api/compare?ids=a,b` with two
  creators that have email and wallet set; assert neither field appears in the response body.
- **Too few IDs:** `?ids=a` → 400.
- **Too many IDs:** `?ids=a,b,c,d,e,f` → 400.
- **Unknown ID:** one valid, one nonexistent ID → 404 (or return only found creators
  with a `missing` list; decide and document in the PR).
- **Cache hit:** fetch twice with the same IDs, assert the DB is queried only once
  (use a spy or the response header if you add one).
- **Server render:** the compare page returns populated HTML with no JS enabled
  (Playwright with JS disabled, or a snapshot of the RSC payload).

## Acceptance criteria

- [ ] `GET /api/compare` returns only public aggregate fields
- [ ] No private fields (email, wallet address, etc.) in any response
- [ ] Response is cached; a second identical request does not hit the database
- [ ] `/compare?ids=a,b,c` renders server-side and returns valid HTML without client JS
- [ ] `docs/` updated to describe the new endpoint shape and cache TTL
- [ ] CI is green (lint, type-check, tests)
- [ ] No new TODOs without a linked issue
