/**
 * Simple in-memory rate limiter for export endpoints.
 * Tracks exports per user per hour: max 3 exports per admin per hour.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const HOUR_MS = 60 * 60 * 1000;
const MAX_EXPORTS_PER_HOUR = 3;

/**
 * Check if a user can export.
 * Returns true if under limit, false if rate limited.
 */
export function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const key = userId;

  let entry = rateLimitStore.get(key);

  // Clean up expired entries
  if (entry && now >= entry.resetAt) {
    rateLimitStore.delete(key);
    entry = undefined;
  }

  if (!entry) {
    // First export
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + HOUR_MS,
    });
    return true;
  }

  if (entry.count >= MAX_EXPORTS_PER_HOUR) {
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Get remaining exports for user.
 */
export function getRemainingExports(userId: string): number {
  const entry = rateLimitStore.get(userId);
  if (!entry || Date.now() >= entry.resetAt) {
    return MAX_EXPORTS_PER_HOUR;
  }
  return Math.max(0, MAX_EXPORTS_PER_HOUR - entry.count);
}
