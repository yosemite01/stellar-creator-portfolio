/**
 * Audit Logging & Telemetry Service  (#508)
 *
 * Provides:
 *  - writeAuditLog()       — persist a structured audit record
 *  - withAuditLog()        — higher-order wrapper that auto-logs any mutation
 *  - createAuditInterceptor() — Next.js middleware-compatible interceptor
 *  - hashIp()              — one-way IP hashing (no raw PII stored)
 *  - extractTelemetryMeta() — pull trace-id / headers silently from a request
 *
 * Design principles
 *  • Non-blocking: audit writes never throw to the caller; failures are
 *    captured to console (or a future dead-letter queue).
 *  • No raw PII: IP addresses are SHA-256 hashed before persistence.
 *  • Trace correlation: W3C traceparent header is parsed so every audit row
 *    can be joined with distributed traces.
 *  • Payload sanitisation: known secret fields are stripped before storage.
 */

import { prisma } from '@/lib/prisma';
import type { AuditStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TelemetryMeta {
  traceId: string;
  ipHash: string | null;
  userAgent: string | null;
  geoCountry: string | null;
  httpMethod: string | null;
  requestPath: string | null;
}

export interface AuditLogInput {
  /** Authenticated user ID (undefined = unauthenticated attempt). */
  userId?: string | null;
  /** High-level resource category: "bounty" | "application" | "escrow" | … */
  resource: string;
  /** Specific action: "create" | "update" | "delete" | "accept" | … */
  action: string;
  /** Primary key of the affected record. */
  resourceId?: string | null;
  /**
   * Sanitised mutation payload snapshot.
   * Sensitive fields are stripped automatically — see sanitisePayload().
   */
  payload?: Record<string, unknown> | null;
  /** Outcome; defaults to SUCCESS. */
  status?: AuditStatus;
  /** Error message captured on failure. */
  errorMessage?: string | null;
  /** Telemetry headers extracted from the originating request. */
  meta?: Partial<TelemetryMeta>;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Fields that must never be persisted in the audit payload. */
const SECRET_FIELDS = new Set([
  'password',
  'passwordHash',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'privateKey',
  'apiKey',
  'creditCard',
  'cvv',
  'ssn',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash of a raw IP address so we can detect abuse patterns without
 * storing the PII value itself.
 * Returns null when ip is falsy (e.g. behind a proxy that strips headers).
 */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // Normalise IPv6 mapped IPv4 (e.g. "::ffff:192.168.1.1" → "192.168.1.1")
  const normalised = ip.replace(/^::ffff:/, '').trim();
  return createHash('sha256').update(normalised).digest('hex');
}

/**
 * Recursively strip secret fields from an object before persisting it.
 * Returns a plain JSON-serialisable value.
 */
export function sanitisePayload(
  payload: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || depth > 5) return null;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SECRET_FIELDS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitisePayload(value, depth + 1);
    } else if (Array.isArray(value)) {
      // Shallow-sanitise array items
      result[key] = value.map((item) =>
        typeof item === 'object' ? sanitisePayload(item, depth + 1) : item,
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Parse the W3C `traceparent` header and return just the trace-id segment.
 * Format: `00-<traceId>-<parentId>-<flags>`
 * Falls back to a freshly generated UUID so every audit row always has a traceId.
 */
export function parseTraceId(traceparent: string | null | undefined): string {
  if (traceparent) {
    const parts = traceparent.split('-');
    // parts[1] is the 32-hex-char trace-id
    if (parts.length >= 2 && /^[0-9a-f]{32}$/i.test(parts[1])) {
      return parts[1];
    }
  }
  // Generate a fallback trace-id in W3C format
  return randomUUID().replace(/-/g, '');
}

/**
 * Extract telemetry metadata silently from a standard Request / NextRequest.
 * Never throws — returns safe defaults on any error.
 */
export function extractTelemetryMeta(
  request: Request | { headers: Headers | { get(name: string): string | null } },
): TelemetryMeta {
  try {
    const headers =
      'headers' in request ? (request.headers as Headers) : new Headers();

    const rawIp =
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headers.get('x-real-ip') ??
      headers.get('cf-connecting-ip') ?? // Cloudflare
      null;

    const traceparent = headers.get('traceparent');
    // Vercel / Cloudflare may inject their own trace header
    const vercelTraceId = headers.get('x-vercel-id') ?? headers.get('cf-ray');

    const traceId = parseTraceId(traceparent ?? vercelTraceId);

    const url = 'url' in request ? (request as Request).url : '';
    const method = 'method' in request ? (request as Request).method : null;

    let requestPath: string | null = null;
    if (url) {
      try {
        requestPath = new URL(url).pathname;
      } catch {
        requestPath = url;
      }
    }

    return {
      traceId,
      ipHash: hashIp(rawIp),
      userAgent: headers.get('user-agent'),
      geoCountry:
        headers.get('cf-ipcountry') ?? // Cloudflare
        headers.get('x-vercel-ip-country') ?? // Vercel
        null,
      httpMethod: method?.toUpperCase() ?? null,
      requestPath,
    };
  } catch {
    return {
      traceId: parseTraceId(null),
      ipHash: null,
      userAgent: null,
      geoCountry: null,
      httpMethod: null,
      requestPath: null,
    };
  }
}

// ── Core write ───────────────────────────────────────────────────────────────

/**
 * Persist one audit log entry.
 *
 * This function is intentionally fire-and-forget safe: it never throws.
 * Callers that need to await persistence for compliance purposes should
 * `await` the returned promise and handle the null-on-failure return.
 *
 * @returns The created AuditLog record, or null on write failure.
 */
export async function writeAuditLog(
  input: AuditLogInput,
): Promise<{ id: string } | null> {
  try {
    const sanitised = input.payload ? sanitisePayload(input.payload) : null;

    const record = await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        resource: input.resource,
        action: input.action,
        resourceId: input.resourceId ?? null,
        payload: sanitised ?? undefined,
        status: input.status ?? 'SUCCESS',
        errorMessage: input.errorMessage ?? null,
        traceId: input.meta?.traceId ?? parseTraceId(null),
        ipHash: input.meta?.ipHash ?? null,
        userAgent: input.meta?.userAgent ?? null,
        geoCountry: input.meta?.geoCountry ?? null,
        httpMethod: input.meta?.httpMethod ?? null,
        requestPath: input.meta?.requestPath ?? null,
      },
      select: { id: true },
    });

    return record;
  } catch (err) {
    // Audit failures must never break the primary request path.
    console.error('[AuditLog] Failed to write audit log:', err);
    return null;
  }
}

// ── Mutation interceptor / wrapper ───────────────────────────────────────────

export interface MutationContext {
  userId?: string | null;
  resource: string;
  action: string;
  resourceId?: string | null;
  request?: Request | { headers: Headers | { get(name: string): string | null } };
}

/**
 * Higher-order wrapper that:
 *  1. Executes the provided mutation function.
 *  2. Extracts telemetry metadata from the optional request.
 *  3. Writes an audit log entry reflecting success or failure.
 *  4. Re-throws the original error so the caller still handles it.
 *
 * @example
 * ```ts
 * const bounty = await withAuditLog(
 *   { userId: session.user.id, resource: 'bounty', action: 'create', request: req },
 *   () => prisma.bounty.create({ data: { ...input } }),
 * );
 * ```
 */
export async function withAuditLog<T>(
  context: MutationContext,
  mutation: () => Promise<T>,
  /** Optional payload snapshot to record (before the mutation). */
  payloadSnapshot?: Record<string, unknown> | null,
): Promise<T> {
  const meta = context.request
    ? extractTelemetryMeta(context.request)
    : undefined;

  try {
    const result = await mutation();

    // Best-effort — do not await to keep the hot path fast.
    void writeAuditLog({
      userId: context.userId,
      resource: context.resource,
      action: context.action,
      resourceId: context.resourceId,
      payload: payloadSnapshot,
      status: 'SUCCESS',
      meta,
    });

    return result;
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    void writeAuditLog({
      userId: context.userId,
      resource: context.resource,
      action: context.action,
      resourceId: context.resourceId,
      payload: payloadSnapshot,
      status: 'FAILURE',
      errorMessage,
      meta,
    });

    throw err;
  }
}

// ── Next.js route-level interceptor ─────────────────────────────────────────

export type MutationHandler<T = unknown> = (
  request: Request,
  context?: unknown,
) => Promise<Response>;

/**
 * createAuditInterceptor wraps a Next.js App Router route handler (POST / PUT /
 * PATCH / DELETE) to automatically emit an audit log for every invocation.
 *
 * Usage in route.ts:
 * ```ts
 * import { createAuditInterceptor } from '@/backend/services/audit';
 *
 * async function handler(req: Request) { ... }
 *
 * export const POST = createAuditInterceptor('bounty', 'create', handler);
 * ```
 *
 * The interceptor:
 *  - Extracts telemetry headers (IP hash, trace-id, user-agent, country).
 *  - Reads userId from the `x-user-id` header set by upstream auth middleware.
 *  - Logs the resource, action, HTTP method, path, and outcome.
 *  - Never swallows or alters the handler's response.
 */
export function createAuditInterceptor(
  resource: string,
  action: string,
  handler: MutationHandler,
): MutationHandler {
  return async (request: Request, context?: unknown): Promise<Response> => {
    const meta = extractTelemetryMeta(request);
    // Prefer an explicit user-id header injected by the auth middleware;
    // callers may also set it via the x-user-id convenience header.
    const userId =
      (request.headers as Headers).get('x-user-id') ?? null;

    let status: AuditStatus = 'SUCCESS';
    let errorMessage: string | null = null;
    let resourceId: string | null = null;

    try {
      const response = await handler(request, context);

      // Attempt to read resourceId from the JSON response body (best-effort).
      // We clone to avoid consuming the body stream.
      try {
        const clone = response.clone();
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const body = await clone.json();
          if (body?.id) resourceId = String(body.id);
          else if (body?.data?.id) resourceId = String(body.data.id);
        }
      } catch {
        // Non-JSON or body already consumed — skip.
      }

      if (!response.ok) {
        status = 'FAILURE';
      }

      void writeAuditLog({
        userId,
        resource,
        action,
        resourceId,
        status,
        meta,
      });

      return response;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);

      void writeAuditLog({
        userId,
        resource,
        action,
        status: 'FAILURE',
        errorMessage,
        meta,
      });

      throw err;
    }
  };
}
