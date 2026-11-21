# Mobile AI features moved off-device with cost controls

**Issue:** #1790 · **Area:** mobile, backend · **Status:** Design (not yet implemented)

## Summary

Run AI upscaling and subtitling as server-side jobs instead of in the app. Put the jobs behind per-user quotas, stream partial results back to the client, track cost per user, and degrade gracefully when the service is unavailable or the user is over quota.

## Why this matters

- **Battery and thermals.** On-device super-resolution and speech-to-text models peg the CPU/GPU/NPU for minutes, drain the battery and get the app throttled.
- **Cost.** Calling a paid inference API straight from the client has no metering. A single user, or a leaked key, can create unbounded spend.
- **Security.** Any API key shipped in the app binary can be extracted.

## Current state

The issue points to `mobile/src/upscaling`, `mobile/src/subtitling` and `mobile/src/ai` at commit `dd8420b`. On `main` (as of `a3edbdb6`) there is no `mobile/` directory, and `dd8420b` isn't in this repository's history. This document is the target design. Update the paths below when the code lands.

## Architecture

```
Mobile app ──POST /api/v1/ai/jobs──▶ API (backend/services/api, Rust)
    ▲                                   │ 1. auth + quota check (Redis)
    │                                   │ 2. presigned upload URL
    │                                   │ 3. enqueue job
    │                                   ▼
    │                           Job queue (Redis Streams)
    │                                   │
    │                                   ▼
    │                       AI workers (GPU pool, autoscaled)
    │                                   │ partial results + cost events
    └──SSE /api/v1/ai/jobs/:id/events◀──┘
```

The client never holds an inference API key. All provider credentials live in the worker's secret store.

## Design

### 1. Server-side job queue with quotas

**API**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/ai/jobs` | `{ kind: "upscale" \| "subtitle", inputBytes, durationSec?, params }` → `{ jobId, uploadUrl, estimate }` |
| `POST` | `/api/v1/ai/jobs/:id/start` | Called after the upload completes; enqueues the job |
| `GET` | `/api/v1/ai/jobs/:id` | Status and final result URLs |
| `GET` | `/api/v1/ai/jobs/:id/events` | SSE stream of progress and partial results |
| `DELETE` | `/api/v1/ai/jobs/:id` | Cancel; unused quota is refunded |
| `GET` | `/api/v1/ai/usage` | Current period usage vs quota |

**Data model (Prisma)**

```prisma
model AiJob {
  id          String   @id @default(cuid())
  userId      String
  kind        AiJobKind
  status      AiJobStatus  // queued | running | partial | done | failed | cancelled
  inputKey    String
  outputKeys  String[]
  estimateUsd Decimal  @db.Decimal(10, 4)
  costUsd     Decimal? @db.Decimal(10, 4)
  error       String?
  createdAt   DateTime @default(now())
  finishedAt  DateTime?
  @@index([userId, createdAt])
}

model AiUsage {
  userId     String
  period     String   // "2026-11"
  units      Int      // upscale megapixels or subtitle seconds
  costUsd    Decimal  @db.Decimal(10, 4)
  @@id([userId, period])
}
```

**Quotas**

- Quotas are per plan, for example Free: 20 upscales/month and 30 min subtitling/month; Pro: 10× that.
- A check-and-reserve runs atomically in a Redis Lua script against the `estimate`. Usage is reconciled to actual cost when the job finishes.
- Concurrency limit per user (Free: 1 running, Pro: 3). Further jobs wait in `queued`.
- Requests are rejected up front for file size, resolution and duration limits, before any upload happens.
- A global daily spend ceiling acts as a circuit breaker. When it trips, new jobs return `503` with `Retry-After`.

**Queue**

- Redis Streams with a consumer group per job kind. Redis is already a dependency (`ioredis`).
- At-least-once delivery. Workers are idempotent on `jobId`. A job that fails 3 times goes to a dead-letter stream.
- Visibility timeout and heartbeat: a job whose worker stops heartbeating is reclaimed by `XAUTOCLAIM`.

### 2. Progressive results

- **Upscaling:** tile-based processing. The worker emits a low-res preview first (fast 2× bilinear plus a light model), then replaces tiles as they finish. SSE events: `progress { pct }`, `preview { url }`, `tile { index, url }`, `done { url }`.
- **Subtitling:** chunked transcription in 30 s windows with overlap. Each window emits `segment { start, end, text, final: false }` and then a `final: true` revision. The client renders WebVTT incrementally.
- The client reconnects with `Last-Event-ID`, and the server replays events from the job's event log (a Redis stream with a 24 h TTL).
- Background handling: if the app is backgrounded, the job keeps running and a push notification fires on `done`.

### 3. Cost tracking per user

- Workers emit `cost { provider, units, usd }` per call. Unit prices live in config (`ai_pricing.toml`) so changes don't need a deploy.
- `AiJob.costUsd` is the sum of the job's cost events. `AiUsage` is upserted on completion.
- Admin dashboard: spend by day, by kind, top-N users, and estimate vs actual drift.
- Alerts: a user above 3× their plan's expected monthly cost, global spend above 80% of the daily ceiling, and estimate error above 25% over 24 h.
- The user-facing usage screen in Settings shows the remaining quota and resets on a calendar month.

### 4. Fallbacks

| Condition | Behaviour |
|---|---|
| Over quota | Clear upsell/limit message. No job is created. The original media stays usable. |
| Service unavailable / circuit open | Show a "Try again later" message with the retry time. Optionally offer a **lightweight on-device fallback** (bicubic upscale; OS speech recognizer on supported devices), only while charging or above 50% battery and never automatically. |
| Job fails after retries | Refund the reserved quota and show the error with a retry option. |
| Offline | Queue the request locally and submit it when the connection returns, with the user's confirmation. |
| Provider outage | Workers fail over to a secondary provider/model where configured. The cost is recorded under the actual provider. |

Feature flags `ai.upscale.enabled` and `ai.subtitle.enabled` allow a remote kill switch.

## Migration

1. Ship the backend endpoints and workers behind flags.
2. Mobile release that calls the server path when the flag is on and keeps the old on-device path as the fallback.
3. Raise the flag to 100% and watch battery and crash metrics.
4. Remove the heavy on-device models from the bundle (smaller app size), keeping only the lightweight fallback.
5. Rotate and revoke any API keys that previously shipped in the client.

## Test plan

| Test | Type |
|---|---|
| Quota reserve/commit/refund is atomic under concurrent requests (100 parallel requests, no overspend) | Integration (Redis) |
| Rejects oversize/over-duration input before issuing an upload URL | Unit |
| Worker idempotency: redelivering the same `jobId` doesn't double-charge | Integration |
| Dead-lettering after 3 failures; refund issued | Integration |
| SSE replay from `Last-Event-ID` returns only the missed events | Integration |
| Circuit breaker returns 503 once the global ceiling is reached | Unit |
| Cost aggregation: `AiUsage` equals the sum of `AiJob.costUsd` | Unit |
| Client: progressive rendering, reconnect, fallback UI per row of the table above | Component + E2E |
| No provider API keys in the mobile bundle (CI grep/secret scan of the build artifact) | CI |

## Docs to update

- `backend/README.md`: AI worker setup, env vars (`AI_PROVIDER_*`, `AI_DAILY_CEILING_USD`) and running workers locally.
- API reference: the endpoints and SSE event schema above.
- Pricing/plan page: quota numbers.

## Acceptance criteria

- [ ] No inference runs on-device by default, and no provider keys ship in the app.
- [ ] Per-user quotas and concurrency limits are enforced server-side.
- [ ] Partial results stream for both upscaling and subtitling.
- [ ] Per-job and per-user cost is recorded; alerts are configured.
- [ ] Every fallback in the table has a tested UI path.
