// Simple in-memory rate limiter supporting per-identifier limits.
type Bucket = {
  tokens: number;
  last: number; // ms
  capacity: number;
  refillPerMs: number;
};

const buckets = new Map<string, Bucket>();

export function checkRate(identifier: string, limit = 60, windowSeconds = 60) {
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

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, remaining: Math.floor(b.tokens) };
  }

  return { allowed: false, remaining: 0 };
}

export function resetRate(identifier: string) {
  buckets.delete(identifier);
}

export function stats(identifier: string) {
  const b = buckets.get(identifier);
  if (!b) return null;
  return { capacity: b.capacity, tokens: Math.floor(b.tokens) };
}
