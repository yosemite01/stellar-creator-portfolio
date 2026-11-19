# tRPC & REST Unified Cache Strategy (Issue #1827)

This document describes the unified caching, request batching, exponential backoff retries, and mutation cache invalidation strategy across tRPC and REST client calls in the Stellar Creator Portfolio platform.

## Overview

Previously, the platform utilized disconnected cache management between legacy REST API utilities (`lib/api-client.ts`) and tRPC (`lib/trpc-client.ts`), leading to stale UI state upon mutations (such as submitting reviews, releasing escrow, or creating bounties).

With Issue #1827, both surfaces share a centralized TanStack Query (`@tanstack/react-query`) cache, unified query key conventions, automated dependency invalidations, and resilient retry policies.

---

## 1. Unified Cache & Query Key Conventions

All cache keys are structured hierarchically under `lib/query-invalidation-map.ts`:

- **Bounties**:
  - `queryKeys.bounties.all`: `['bounties']`
  - `queryKeys.bounties.lists()`: `['bounties', 'list']`
  - `queryKeys.bounties.list(filters)`: `['bounties', 'list', filters]`
  - `queryKeys.bounties.details()`: `['bounties', 'detail']`
  - `queryKeys.bounties.detail(id)`: `['bounties', 'detail', id]`
  - `queryKeys.bounties.submissions(id)`: `['bounties', 'detail', id, 'submissions']`

- **Creators**:
  - `queryKeys.creators.all`: `['creators']`
  - `queryKeys.creators.list(filters)`: `['creators', 'list', filters]`
  - `queryKeys.creators.detail(id)`: `['creators', 'detail', id]`
  - `queryKeys.creators.reputation(id)`: `['creators', 'detail', id, 'reputation']`
  - `queryKeys.creators.reviews(id)`: `['creators', 'detail', id, 'reviews']`

- **Reviews**:
  - `queryKeys.reviews.all`: `['reviews']`
  - `queryKeys.reviews.byTarget(targetId)`: `['reviews', 'target', targetId]`

- **Escrow**:
  - `queryKeys.escrow.all`: `['escrow']`
  - `queryKeys.escrow.detail(id)`: `['escrow', 'detail', id]`

---

## 2. Mutation Cache Invalidation Map

Rather than manually calling `queryClient.invalidateQueries()` ad-hoc throughout individual React components, mutation dependencies are declared in `MUTATION_INVALIDATION_MAP` (`lib/query-invalidation-map.ts`).

### Invalidation Mappings

| Mutation Key | Context Parameters | Invalidated Queries |
| :--- | :--- | :--- |
| `bounty.create` | `creatorId?` | `bounties.all`, `['bounty']`, `['dashboard']`, `creators.detail(creatorId)` |
| `bounty.update` | `bountyId?` | `bounties.all`, `bounties.detail(bountyId)`, `['bounty']` |
| `bounty.submit` | `bountyId?`, `creatorId?` | `bounties.detail(bountyId)`, `bounties.submissions(bountyId)`, `creators.detail(creatorId)` |
| `review.submit` | `targetId?`, `creatorId?`, `bountyId?` | `reviews.all`, `creators.detail`, `creators.reputation`, `creators.reviews`, `bounties.detail` |
| `escrow.release` | `escrowId?`, `bountyId?` | `escrow.all`, `escrow.detail`, `bounties.detail`, `['earnings']` |
| `projects.create` | `creatorId?` | `creators.all`, `creators.detail`, `bounties.all`, `['projects']` |

### Helper Function

`invalidateMutationDependencies(queryClient, mutationKey, context)` triggers invalidation across all matched keys.

In `lib/api-client.ts`, REST mutations automatically trigger dependency invalidation:
```typescript
export async function submitReview(data: SubmitReviewPayload): Promise<ReviewResponse> {
  const result = await apiFetch<ReviewResponse>('/api/reviews', { ... });
  await invalidateMutationDependencies(queryClient, 'review.submit', {
    creatorId: data.creatorId,
    bountyId: data.bountyId,
  });
  return result;
}
```

---

## 3. Request Batching

tRPC queries are configured with `httpBatchLink`:

```typescript
httpBatchLink({
  url: getBaseUrl() + '/api/trpc',
  maxURLLength: 2083, // Prevents URI Too Long (414) in standard proxy and browser environments
})
```

Adjacent queries triggered during the same tick are batched into a single HTTP POST request, significantly cutting connection overhead on dashboard and detail views.

---

## 4. Exponential Backoff Retries

The shared `QueryClient` defaults specify intelligent retry handling:

- **Client Errors (4xx)**: 400, 401, 403, 404, 422 are non-retryable; queries fail immediately without wasting bandwidth.
- **Server Errors & Rate Limits**: 408 (Request Timeout), 429 (Too Many Requests), and 5xx (500, 502, 503, 504) are retried up to 3 times.
- **Backoff Delay**: Exponential backoff `min(1000 * 2^attempt, 10000) + jitter` avoids hammering backend services during brief outages.
- **REST Client Retries**: `apiFetchWithRetry(endpoint, options, maxRetries)` implements the same exponential backoff strategy for non-tRPC HTTP calls.
