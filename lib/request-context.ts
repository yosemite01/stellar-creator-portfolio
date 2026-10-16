/**
 * Request-scoped async context (Node.js AsyncLocalStorage).
 *
 * The request-ID middleware (lib/request-id-middleware.ts) stores the
 * current request's ID here so that any code called within the same async
 * call-stack — logger, Sentry scope, tracing spans — can read it without
 * having the ID threaded through every function signature.
 *
 * Works in Node.js ≥ 16 and in the Next.js Edge runtime (which also ships
 * AsyncLocalStorage since Next 13.4).
 */

import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
}

const store = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` inside a new request context that carries `requestId`.
 * Called once per incoming request by the middleware.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return store.run({ requestId }, fn);
}

/**
 * Read the request ID from the current async context.
 * Returns `undefined` when called outside a request (e.g. background jobs).
 */
export function getRequestId(): string | undefined {
  return store.getStore()?.requestId;
}
