// Rate limiter supporting per-identifier limits.
type Bucket = {
  tokens: number;
  last: number; // ms
  capacity: number;
  refillPerMs: number;
};

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

export function checkRate(identifier: string, limit = 60, windowSeconds = 60): RateLimitResult {
  const now = Date.now();
  const capacity = limit;
  const refillPerMs = capacity / (windowSeconds * 1000);

  let b = buckets.get(identifier);
  if (!b) {
    b = { tokens: capacity, last: now, capacity, refillPerMs };
    buckets.set(identifier, b);
  }

  // refill
  const elapsed = now - b.last;
  b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerMs);
  b.last = now;

  const resetAt = now + Math.ceil((1 - b.tokens) / b.refillPerMs);

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(b.tokens),
      resetAt,
      retryAfter: 0,
    };
  }

  return {
    allowed: false,
    remaining: 0,
    resetAt,
    retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

export function resetRate(identifier: string) {
  buckets.delete(identifier);
}

export function stats(identifier: string) {
  const b = buckets.get(identifier);
  if (!b) return null;
  return { capacity: b.capacity, tokens: Math.floor(b.tokens) };
}

// ─── Request-level helpers ──────────────────────────────────────────────────

/** Requests per minute allowed for callers with no user or API key. */
export const ANONYMOUS_LIMIT_PER_MINUTE = 30;
/** Requests per minute allowed for authenticated users and API keys. */
export const AUTHENTICATED_LIMIT_PER_MINUTE = 300;

export interface RateLimitIdentity {
  userId?: string;
  apiKeyId?: string;
  isAuthenticated?: boolean;
}

/** Best-effort client IP from proxy headers; 'unknown' when none is present. */
export function clientIp(headers?: Headers | null): string {
  const forwarded = headers?.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headers?.get('x-real-ip') ?? 'unknown';
}

/**
 * Stable bucket key for a caller: user id, then API key id, then IP.
 * `scope` keeps independent limits (e.g. per tRPC procedure) from sharing
 * a bucket.
 */
export function rateLimitKey(
  headers: Headers | null | undefined,
  identity: RateLimitIdentity,
  scope = 'global',
): string {
  if (identity.userId) return `${scope}:user:${identity.userId}`;
  if (identity.apiKeyId) return `${scope}:key:${identity.apiKeyId}`;
  return `${scope}:ip:${clientIp(headers)}`;
}

/**
 * Tiered check for a request: authenticated callers get the higher limit,
 * anonymous callers are limited per IP.  Pass a `scope` to give a route its
 * own bucket instead of sharing the global one.
 */
export function checkRateLimit(
  req: { headers: Headers },
  identity: RateLimitIdentity,
  scope = 'global',
): RateLimitResult {
  const authenticated = identity.isAuthenticated ?? Boolean(identity.userId || identity.apiKeyId);
  const limit = authenticated ? AUTHENTICATED_LIMIT_PER_MINUTE : ANONYMOUS_LIMIT_PER_MINUTE;
  return checkRate(rateLimitKey(req.headers, identity, scope), limit, 60);
}

/** Thrown when a caller has exhausted its bucket. */
export class RateLimitExceededError extends Error {
  constructor(public readonly retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s`);
    this.name = 'RateLimitExceededError';
  }
}

interface RateLimitMiddlewareArgs {
  req: { headers: Headers };
  headers?: Headers;
  user?: { id: string };
  path: string;
}

/**
 * Global limiter applied to every tRPC procedure. Rejects with
 * `RateLimitExceededError`; the tRPC layer maps that to TOO_MANY_REQUESTS.
 */
export async function rateLimitMiddleware({ req, headers, user }: RateLimitMiddlewareArgs): Promise<void> {
  const result = checkRateLimit(
    { headers: headers ?? req.headers },
    { userId: user?.id, isAuthenticated: Boolean(user) },
  );
  if (!result.allowed) {
    throw new RateLimitExceededError(result.retryAfter);
  }
}
