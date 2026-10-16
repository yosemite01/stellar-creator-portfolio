/**
 * Request-ID middleware for Next.js API routes.
 *
 * Behaviour:
 *  1. Reads `x-request-id` from the incoming request headers.
 *     Accepts any non-empty value sent by a trusted upstream proxy.
 *  2. If absent or empty, generates a new UUID v4.
 *  3. Echoes the final ID back in the `x-request-id` response header so
 *     clients can correlate their error reports with server logs.
 *  4. Runs the handler inside `runWithRequestId()` so the ID is available
 *     to the structured logger and Sentry scope without any prop-drilling.
 *
 * Usage — wrap any Next.js Route Handler:
 *
 *   import { withRequestId } from '@/lib/request-id-middleware';
 *
 *   export const GET = withRequestId(async (req) => {
 *     return NextResponse.json({ ok: true });
 *   });
 *
 * Or use the lower-level helper in custom middleware / tRPC context:
 *
 *   import { resolveRequestId } from '@/lib/request-id-middleware';
 *   const requestId = resolveRequestId(req.headers.get('x-request-id'));
 */

import { NextRequest, NextResponse } from 'next/server';
import { runWithRequestId } from '@/lib/request-context';
import { configureSentryRequestId } from '@/lib/sentry-request-id';

/** Generate a UUID-v4-like ID without importing the `uuid` package. */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Resolve or generate a request ID from an incoming header value.
 * Exported so tRPC context / Express middleware can reuse the same logic.
 */
export function resolveRequestId(headerValue: string | null | undefined): string {
  if (headerValue && headerValue.trim().length > 0) {
    // Accept upstream IDs but cap length to prevent log injection.
    return headerValue.trim().slice(0, 128);
  }
  return generateId();
}

type RouteHandler = (
  req: NextRequest,
  ctx?: unknown,
) => Promise<NextResponse> | NextResponse;

/**
 * Higher-order function that wraps a Next.js Route Handler with request-ID
 * propagation. The handler receives the original request unmodified; the ID
 * is injected into the response header and async context automatically.
 */
export function withRequestId(handler: RouteHandler): RouteHandler {
  return async (req: NextRequest, ctx?: unknown): Promise<NextResponse> => {
    const requestId = resolveRequestId(req.headers.get('x-request-id'));

    return runWithRequestId(requestId, async () => {
      // Attach to Sentry scope for this request so every captured event
      // carries the request ID as a tag.
      configureSentryRequestId(requestId);

      const response = await handler(req, ctx);

      // Echo the ID back so clients can log it alongside any error UI.
      response.headers.set('x-request-id', requestId);

      return response;
    });
  };
}
