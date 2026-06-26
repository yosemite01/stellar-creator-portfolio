import { prisma } from '@/lib/prisma';
import { GraphQLContext } from './context';

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_QUOTA = 100; // queries per minute

export class RateLimitError extends Error {
  constructor(public retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s`);
  }
}

export async function checkRateLimit(
  ctx: GraphQLContext,
  operationName?: string
): Promise<{ remaining: number; resetAt: Date }> {
  // Only rate limit API key requests (not JWT auth)
  if (!ctx.apiKeyId) {
    return { remaining: RATE_LIMIT_QUOTA, resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS) };
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

  // Count queries in the current window
  const count = await prisma.apiKeyUsage.count({
    where: {
      apiKeyId: ctx.apiKeyId,
      timestamp: { gte: windowStart },
    },
  });

  if (count >= RATE_LIMIT_QUOTA) {
    const oldestQuery = await prisma.apiKeyUsage.findFirst({
      where: {
        apiKeyId: ctx.apiKeyId,
        timestamp: { gte: windowStart },
      },
      orderBy: { timestamp: 'asc' },
    });

    if (oldestQuery) {
      const resetAt = new Date(oldestQuery.timestamp.getTime() + RATE_LIMIT_WINDOW_MS);
      const retryAfter = Math.ceil((resetAt.getTime() - now.getTime()) / 1000);
      throw new RateLimitError(retryAfter);
    }
  }

  // Record this query
  await prisma.apiKeyUsage.create({
    data: {
      apiKeyId: ctx.apiKeyId,
      queryPath: operationName || 'unnamed',
    },
  });

  return {
    remaining: Math.max(0, RATE_LIMIT_QUOTA - count - 1),
    resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS),
  };
}
