/**
 * Rate Limiting Utility
 * Token bucket algorithm with configurable limits
 */

interface RateLimitOptions {
  limit: number;
  window: number; // seconds
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(capacity: number, refillRate: number) {
    this.tokens = capacity;
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.lastRefill = Date.now();
  }

  consume(amount: number = 1): boolean {
    this.refill();

    if (this.tokens >= amount) {
      this.tokens -= amount;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getRemainingTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private readonly defaultCapacity: number = 30; // per minute
  private readonly defaultRefillRate: number = 30 / 60; // tokens per second

  check(identifier: string, options?: RateLimitOptions): RateLimitResult {
    const capacity = options?.limit || this.defaultCapacity;
    const window = options?.window || 60;
    const refillRate = capacity / window;

    if (!this.buckets.has(identifier)) {
      this.buckets.set(identifier, new TokenBucket(capacity, refillRate));
    }

    const bucket = this.buckets.get(identifier)!;
    const allowed = bucket.consume(1);
    const remaining = bucket.getRemainingTokens();

    return {
      allowed,
      remaining,
      resetIn: window,
    };
  }

  reset(identifier: string): void {
    this.buckets.delete(identifier);
  }

  resetAll(): void {
    this.buckets.clear();
  }

  getStats(identifier: string): { capacity: number; remaining: number } | null {
    const bucket = this.buckets.get(identifier);
    if (!bucket) return null;

    return {
      capacity: this.defaultCapacity,
      remaining: bucket.getRemainingTokens(),
    };
  }
}

const limiter = new RateLimiter();

export async function rateLimit(
  identifier: string,
  options?: RateLimitOptions,
): Promise<RateLimitResult> {
  return Promise.resolve(limiter.check(identifier, options));
}

export function resetRateLimit(identifier: string): void {
  limiter.reset(identifier);
}

export function resetAllRateLimits(): void {
  limiter.resetAll();
}

export function getRateLimitStats(identifier: string) {
  return limiter.getStats(identifier);
}
