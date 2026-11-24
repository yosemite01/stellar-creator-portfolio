# Frontend Observability: Error Tracking with Request-ID Correlation

**Issue:** [#1775](https://github.com/yosemite01/stellar-creator-portfolio/issues/1775)  
**Difficulty:** Hard · **Estimated size:** L (1–2 weeks)

---

## Background

Request IDs and Sentry error tracking both exist, but correlation across the full trace path — browser → Next.js route → structured log — is incomplete. The OpenTelemetry SDK is fully implemented but never bootstrapped in the Next.js app. This work wires everything together so a single request can be traced from the browser's error UI to the backend log line, with one ID tying them all together.

---

## Current State

### Component map

```
Browser
  └─ lib/error-tracking.ts     (ErrorTracker: Sentry client + POST /api/errors/log)
  └─ lib/api-with-tracking.ts  (fetchWithTracking: adds timeout, calls ErrorTracker on failure)

Next.js server
  └─ lib/request-context.ts       (AsyncLocalStorage for request ID)
  └─ lib/request-id-middleware.ts (withRequestId HOF: reads/generates ID, sets response header)
  └─ lib/sentry-request-id.ts     (tags active Sentry scope with request_id)
  └─ lib/logger.ts                (structured JSON logger: auto-includes requestId from context)
  └─ server/services/tracing.ts   (OpenTelemetry SDK: W3C traceparent, tRPC + Prisma spans)
```

### What is working

**`lib/request-context.ts`** stores a `{ requestId }` in `AsyncLocalStorage`. Any code in the same async call stack can call `getRequestId()` without prop-drilling — the Node.js ≥16 `AsyncLocalStorage` works in the Next.js Edge runtime too.

**`lib/request-id-middleware.ts`** — `withRequestId(handler)` wraps a Next.js Route Handler:
1. Reads `x-request-id` from the incoming request (or generates a UUID v4 substitute). Values are capped at 128 characters to prevent log injection.
2. Calls `runWithRequestId(id, fn)` to inject the ID into async context.
3. Tags the Sentry scope via `configureSentryRequestId(id)`.
4. Echoes the final `x-request-id` back in the response header so the browser can log it.

**`lib/logger.ts`** automatically includes `requestId` in every JSON log entry when called inside a `withRequestId()` context:
```json
{ "time": "2026-11-21T10:00:00Z", "level": "info", "msg": "KYC cleanup", "requestId": "abc-123" }
```

**`server/services/tracing.ts`** has a complete OpenTelemetry implementation:
- `initializeTracing()`: bootstraps the OTel `NodeSDK` with `W3CTraceContextPropagator`, `OTLPTraceExporter` (gRPC → Jaeger/Datadog), `BatchSpanProcessor` (512 spans, 5s flush), and auto-instrumentations.
- `tracingMiddleware`: a tRPC middleware that extracts `traceparent` from the request headers, starts a root span per procedure call, and runs the handler inside `context.with()`.
- `prismaTracingExtension`: Prisma `$extends` query extension (built on `createPrismaTracingMiddleware()`) that wraps every DB query in a child span.
- `getTraceparent()`: serialises the current span context to `00-traceId-spanId-flags` for outbound propagation.

### What is missing

| Gap | Location | Impact |
|---|---|---|
| `initializeTracing()` never called | No `instrumentation.ts` exists | OTel SDK never starts; zero spans exported |
| No global `withRequestId` middleware | No `middleware.ts` applying it to all routes | Only routes that explicitly wrap their handler carry a request ID |
| Sentry and OTel are disconnected | No bridge between `traceId` and `request_id` Sentry tag | Cannot join a Sentry issue to a Jaeger trace |
| `traceparent` not injected from browser | `ErrorTracker` does not read or forward a `traceparent` | Browser-generated errors cannot link to a server span |
| `/api/errors/log` route handler missing | Referenced by `error-tracking.ts` but file not found | Backend log forwarding silently fails |
| Error IDs are not crypto-random | `generateErrorId()` uses `Math.random()` | Weak uniqueness guarantees |

---

## Proposed Implementation

### 1. Bootstrap OpenTelemetry in Next.js

Create `instrumentation.ts` at the project root (Next.js 13.4+ hook, runs once per server process):

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeTracing } = await import('./server/services/tracing');
    initializeTracing();
  }
}
```

Add to `next.config.js`:
```js
experimental: { instrumentationHook: true }
```

### 2. Apply `withRequestId` globally via Next.js middleware

Create `middleware.ts` (or extend the existing one) so every route receives a request ID without per-handler opt-in:

```ts
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestId } from '@/lib/request-id-middleware';

export function middleware(req: NextRequest) {
  const requestId = resolveRequestId(req.headers.get('x-request-id'));
  const res = NextResponse.next({
    request: { headers: new Headers({ ...Object.fromEntries(req.headers), 'x-request-id': requestId }) },
  });
  res.headers.set('x-request-id', requestId);
  return res;
}

export const config = { matcher: '/api/:path*' };
```

Route handlers that use `withRequestId()` will continue to work as-is. New handlers that don't wrap explicitly will still receive the header from the middleware and can read it directly.

### 3. Propagate W3C `traceparent` from the browser

When the browser makes an API call, attach the current OTel trace context (or a generated span context) as the `traceparent` header:

```ts
// lib/api-with-tracking.ts — extend fetchWithTracking
import { getActivePropagationHeaders } from '@/lib/browser-trace';

const headers = {
  ...options?.headers,
  ...getActivePropagationHeaders(), // adds traceparent + tracestate if available
  'x-request-id': getCurrentRequestId(), // propagate browser-side session trace
};
```

Create `lib/browser-trace.ts`:
```ts
// Generates a W3C-compatible traceparent for outgoing browser requests.
// In browsers without the OTel JS SDK, synthesises a trace ID from crypto.randomUUID.
export function getActivePropagationHeaders(): Record<string, string> {
  const traceId = crypto.randomUUID().replace(/-/g, '');
  const spanId = crypto.getRandomValues(new Uint8Array(8))
    .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  return { traceparent: `00-${traceId}-${spanId}-01` };
}
```

This synthesised ID will be accepted by `tracingMiddleware` on the server side via `W3CTraceContextPropagator.extract()`, creating a parent-child relationship between the browser request and the server span.

### 4. Attach request ID to all log and error events

**Server logs** already include `requestId` via `lib/logger.ts`. Ensure all API routes use `withRequestId()` (or the global middleware injects the header) so the logger always has an ID in context.

**Sentry events** already receive a `request_id` tag from `configureSentryRequestId()`. Extend this to also tag the OTel `traceId`:

```ts
// lib/sentry-request-id.ts — add traceId tagging
import { getTraceparent } from '@/server/services/tracing';

export function configureSentryRequestId(requestId: string): void {
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    try {
      const scope = Sentry.getCurrentScope();
      scope.setTag('request_id', requestId);
      const tp = getTraceparent();
      if (tp) scope.setTag('trace_id', tp.split('-')[1]); // extract traceId segment
    } catch { /* Sentry not yet initialized */ }
  });
}
```

### 5. Create the `/api/errors/log` route handler

```ts
// app/api/errors/log/route.ts
import { withRequestId } from '@/lib/request-id-middleware';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const ErrorReportSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  level: z.enum(['error', 'warning', 'info']),
  message: z.string().max(2000),
  stack: z.string().max(10000).optional(),
  context: z.object({
    userId: z.string().optional(),
    component: z.string().optional(),
    action: z.string().optional(),
  }),
  url: z.string().url().optional(),
});

export const POST = withRequestId(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const parsed = ErrorReportSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  const { data } = parsed;
  logger[data.level === 'error' ? 'error' : data.level === 'warning' ? 'warn' : 'info'](
    `[client-error] ${data.message}`,
    { errorId: data.id, component: data.context.component, url: data.url },
  );
  return NextResponse.json({ ok: true });
});
```

### 6. Dashboards

Configure two views in your observability backend (Datadog / Grafana / Jaeger):

**Error correlation panel:**  
Query logs and Sentry events by `request_id`. A single search like `request_id:abc-123` should surface both the structured log line from the Next.js route and the corresponding Sentry event.

**Trace waterfall:**  
In Jaeger, search by `traceId` from the `traceparent` header. This shows the full span tree: `trpc.query.*` → `prisma.User.findUnique` → downstream HTTP.

Minimum set of env-vars to configure:
```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317   # or Datadog agent
OTEL_TRACE_SAMPLE_RATE=0.1                          # 10% in production
NEXT_PUBLIC_SENTRY_DSN=https://...
LOG_LEVEL=info
```

---

## Data Flow After This Work

```
Browser
  │  generates traceparent (lib/browser-trace.ts)
  │  sends x-request-id + traceparent headers
  ▼
Next.js middleware.ts
  │  resolves / echoes x-request-id
  ▼
Route Handler (withRequestId)
  │  runWithRequestId → AsyncLocalStorage
  │  configureSentryRequestId → Sentry scope: request_id + trace_id tag
  │  tracingMiddleware → OTel span (parent = browser traceparent)
  ▼
lib/logger.ts
  │  emits JSON: { requestId, traceId, ... }
  ▼
OTLP exporter → Jaeger / Datadog
Sentry event → tagged with request_id + trace_id
```

---

## Failure Modes

| Scenario | Behaviour |
|---|---|
| Sentry DSN not configured | `getSentry()` returns null; no Sentry calls; request ID still in logs |
| OTel endpoint unreachable | `BatchSpanProcessor` buffers and retries; app keeps serving requests |
| `instrumentation.ts` not loaded (Node.js runtime mismatch) | OTel disabled; logs still carry request ID via AsyncLocalStorage |
| Browser does not support `crypto.getRandomValues` | `getActivePropagationHeaders` returns empty object; no `traceparent` sent |

---

## Test Plan

| Test | What to verify |
|---|---|
| `withRequestId` unit test | Generated ID appears in `x-request-id` response header |
| Logger unit test | `requestId` field present in emitted JSON when called inside `runWithRequestId` |
| `tracingMiddleware` unit test | Span is created and ended; parent span context is extracted from `traceparent` header |
| `/api/errors/log` integration test | Valid payload → 200 + log line emitted; invalid payload → 400 |
| End-to-end (Playwright) | Browser error triggers `ErrorTracker`; logged `request_id` matches the one in the server log |

---

## Acceptance Criteria

- [ ] One OTel trace spans browser request → Next.js route → Prisma query.
- [ ] Every server log line emitted during a request includes `requestId`.
- [ ] Every Sentry event captured during a request is tagged with both `request_id` and `trace_id`.
- [ ] `/api/errors/log` accepts and logs client-side error reports.
- [ ] CI is green (lint, type-check, tests).
- [ ] No new TODOs without a linked issue.

---

## Definition of Done

- Code merged to `main` with tests.
- Acceptance criteria above all checked.
- PR description explains the change, links this issue (`Closes #1775`), and lists anything deferred.
- Docs updated where user-facing or integrator-facing behaviour changed.

---

## Getting Started

```bash
git clone https://github.com/yosemite01/stellar-creator-portfolio.git
cd stellar-creator-portfolio
pnpm install
cp .env.example .env.local
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```

Write a short design note in the PR (which spans are created, what fields are indexed in the log sink, how Sentry and OTel trace IDs are joined) before the bulk of the implementation.
