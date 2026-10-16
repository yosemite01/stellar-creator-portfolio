/**
 * Sentry request-ID integration.
 *
 * Attaches the current request ID to the active Sentry scope so every event
 * captured during a request is tagged with `request_id`.  This makes it
 * trivial to jump from a Sentry issue directly to the corresponding server
 * log line.
 *
 * Called once per request by `withRequestId()` in lib/request-id-middleware.ts.
 * Safe to call when Sentry is not installed — the dynamic import resolves to
 * `null` and the function becomes a no-op.
 */

/** Minimal Sentry API surface this module uses. */
interface SentryLike {
  getCurrentScope(): { setTag(key: string, value: string): void };
  withScope?(callback: (scope: { setTag(key: string, value: string): void }) => void): void;
}

let sentryCache: SentryLike | null | undefined; // undefined = not yet loaded

async function getSentry(): Promise<SentryLike | null> {
  if (sentryCache !== undefined) return sentryCache;
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    sentryCache = null;
    return null;
  }
  const specifier = '@sentry/nextjs';
  sentryCache = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ specifier)
    .then((m) => m as SentryLike)
    .catch(() => null);
  return sentryCache;
}

/**
 * Tag the active Sentry scope with `request_id`.
 * Fire-and-forget; never throws.
 */
export function configureSentryRequestId(requestId: string): void {
  void getSentry().then((Sentry) => {
    if (!Sentry) return;
    try {
      Sentry.getCurrentScope().setTag('request_id', requestId);
    } catch {
      // Sentry not yet initialized — silently ignore.
    }
  });
}
