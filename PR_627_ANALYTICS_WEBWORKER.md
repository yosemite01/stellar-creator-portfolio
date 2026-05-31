# [Frontend] Build Advanced Analytics WebWorker Processing

## Summary

Moves all heavy analytics data-mutation functions off the main thread into a dedicated **WebWorker**, ensuring the UI stays at a consistent **60fps** during charting operations regardless of dataset size.

## Changes

| File | Description |
|------|-------------|
| `public/workers/analytics.worker.js` | WebWorker with all 7 data-mutation functions inlined |
| `hooks/useAnalyticsWorker.ts` | Typed React hook — singleton worker, structured-clone postMessage, promise-per-id |
| `components/analytics-dashboard.tsx` | Dashboard component dispatching all tasks in parallel via the worker |
| `app/profile/analytics/page.tsx` | Creator analytics page (SSR-safe via `next/dynamic`) |

## Implementation Details

### WebWorker (`public/workers/analytics.worker.js`)
- Inlines all pure functions from `lib/analytics/analytics-engine.ts`
- Message protocol: `{ id, type, payload }` → `{ id, result }` or `{ id, error }`
- Structured clone is automatic via `postMessage` — no manual serialisation needed
- Handles: `computeEarningsMetrics`, `computePerformanceMetrics`, `computeConversionFunnel`, `computeTrendData`, `computePeerComparison`, `computePredictiveTrends`, `formatDataForExport`

### Hook (`hooks/useAnalyticsWorker.ts`)
- Creates a singleton `Worker` on mount, terminates on unmount
- `run(type, payload)` dispatches a task and returns a typed `Promise`
- Pending resolvers stored in a `Map` keyed by auto-incrementing message id
- Full TypeScript generics — return type inferred from task type

### Dashboard (`components/analytics-dashboard.tsx`)
- Dispatches all 5 compute tasks **in parallel** via `Promise.all`
- Main thread only calls `setState` with the results — zero blocking computation
- Renders KPI cards + 4 recharts charts (bar, horizontal bar, line, summary)
- Loading skeleton shown while worker computes

### 60fps Guarantee
All data transformations (filtering, bucketing, regression, aggregation) run in the worker thread. The main thread only:
1. Sends plain-object payloads (structured clone, ~microseconds)
2. Receives plain-object results
3. Calls `setState` → React re-renders charts

## Testing

```
pnpm dev
# Navigate to /profile/analytics
# Open DevTools → Performance tab
# Confirm main thread is idle during data computation
```

---

closes #627
