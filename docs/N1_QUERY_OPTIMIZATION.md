# N+1 Query Optimization (Creator Reviews/Reputation)

Single canonical doc — replaces `OPTIMIZATION_SUMMARY.md` (repo root) and
`docs/INTEGRATION_GUIDE.md`, which covered the same feature at different
levels of detail.

## Problem

Rendering a list of creators alongside their reviews issued one fetch per
creator: 20 creators on screen meant 20 separate review requests (plus one
for the creator list itself), and the pattern got worse under concurrent
users.

## Solution

### DataLoader pattern — [`lib/dataloader.ts`](../lib/dataloader.ts)

Collects `.load(id)` calls made within a batching window (10ms default)
and issues one batched request instead of one per call, with in-memory
caching so a repeated `.load()` for the same id doesn't refetch.

```typescript
// Before: one request per creator
for (const creator of creators) {
  const reviews = await fetchCreatorReviews(creator.id);
}

// After: automatically batched into one request
const reviews = await Promise.all(creators.map((c) => loader.load(c.id)));
```

### Batch endpoints

- `POST /api/creators/reviews/batch` — [`app/api/creators/reviews/batch/route.ts`](../app/api/creators/reviews/batch/route.ts)
- `POST /api/creators/reputation/batch` — [`app/api/creators/reputation/batch/route.ts`](../app/api/creators/reputation/batch/route.ts)

Both accept `{ "creatorIds": [...] }` (up to 100 per request) and return an
object keyed by creator id.

### Request deduplication — [`lib/api-client.ts`](../lib/api-client.ts)

Concurrent calls for the same resource share one in-flight HTTP request
rather than each firing independently.

### React integration

- [`app/providers/DataLoaderProvider.tsx`](../app/providers/DataLoaderProvider.tsx)
  — already wraps the app in [`app/layout.tsx`](../app/layout.tsx).
- [`lib/hooks/useCreatorReviews.ts`](../lib/hooks/useCreatorReviews.ts) —
  `useCreatorReviews(creatorId)` and `useCreatorReputation(creatorId)`,
  both automatically batched through the provider.

```typescript
import { useCreatorReputation } from '@/lib/hooks/useCreatorReviews';

export function CreatorCard({ creator }) {
  const { data: reputation, loading } = useCreatorReputation(creator.id);
  if (loading) return <Skeleton />;
  return (
    <>
      <Rating value={reputation.averageRating} />
      <p>{reputation.totalReviews} reviews</p>
    </>
  );
}
```

### Performance tooling

- [`lib/performance/query-monitor.ts`](../lib/performance/query-monitor.ts)
  — `queryMonitor.logReport()` / `queryMonitor.detectN1Patterns()`, dev-only.
- [`lib/performance/benchmark.ts`](../lib/performance/benchmark.ts) —
  `benchmarkN1Queries()`, runnable from the browser console.

## Migrating a component

Replace a direct per-creator fetch with the hook — no other wiring needed,
`DataLoaderProvider` is already in place:

```typescript
// Before
const [payload, setPayload] = useState(null);
useEffect(() => {
  fetch(`/api/v1/creators/${creatorId}/reviews`).then((r) => r.json()).then(setPayload);
}, [creatorId]);

// After
const { data: payload, loading } = useCreatorReputation(creatorId);
```

## Verifying it worked

1. DevTools → Network tab → filter "batch" → load the creators page. Expect
   1–2 batch requests instead of one-per-creator.
2. `queryMonitor.logReport()` from any component to see a query count/timing
   summary and flagged N+1 patterns.
3. `await benchmarkN1Queries()` in the browser console for a direct
   before/after comparison run against live data.

## Troubleshooting

| Symptom | Check |
|---|---|
| `useDataLoaders must be used within DataLoaderProvider` | Confirm the component tree is inside `app/layout.tsx`'s provider |
| Still seeing individual requests | Hard refresh; confirm the component actually calls the hook, not a direct `fetch` |
| Batch endpoint 404 | Confirm the two `route.ts` files above still exist at those paths |
| DataLoader not batching | Confirm multiple `.load()` calls happen in the same render tick |

## Not yet done

- A GraphQL layer for more flexible nested queries — noted as a future
  option, not started. (A `creatorId` index on `Review` already exists —
  `prisma/schema.prisma`'s `Review` model has `@@index([creatorId])` — so
  that's not the remaining bottleneck if query time is still an issue.)

## References

- [DataLoader pattern](https://github.com/graphql/dataloader)
- [PostgreSQL performance](https://www.postgresql.org/docs/current/performance.html)
