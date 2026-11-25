import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '@/server/api/jwt-secret';
import { hashApiKey, isApiKeyExpired, parseApiKey } from '@/lib/api-keys';
import { checkRateLimit, RateLimitResult } from '@/server/api/rate-limit';

export interface GraphQLContext {
  req: NextRequest;
  userId?: string;
  apiKeyId?: string;
  isAuthenticated: boolean;
  rateLimit?: RateLimitResult;
}

export async function createGraphQLContext(req: NextRequest): Promise<GraphQLContext> {
  const headers = req.headers;
  let userId: string | undefined;
  let apiKeyId: string | undefined;

  // Try JWT auth first
  const authorization = headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7);
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & { userId: string };

      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {id: true},
      });

      if (dbUser) {
        userId = dbUser.id;
      }
    } catch (error) {
      console.warn('Invalid JWT token:', error);
    }
  }

  // Fall back to API key auth if JWT not provided
  const apiKeyHeader = headers.get('x-api-key');
  if (!userId && apiKeyHeader) {
    try {
      // Keys are `sk_live_<prefix>_<secret>` and only the secret's hash is
      // stored (lib/api-keys.ts), so hashing the whole header never matched.
      const parsed = parseApiKey(apiKeyHeader);
      if (!parsed) {
        throw new Error('Malformed API key');
      }
      const keyHash = hashApiKey(parsed.secret);

      // Find the API key by its hash
      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash },
        select: { id: true, userId: true, prefix: true, revokedAt: true, expiresAt: true },
      });

      if (!apiKey || (apiKey.prefix && apiKey.prefix !== parsed.prefix)) {
        throw new Error('API key not found');
      }

      if (apiKey.revokedAt) {
        throw new Error('API key has been revoked');
      }

      if (isApiKeyExpired(apiKey.expiresAt)) {
        throw new Error('API key expired');
      }

      userId = apiKey.userId;
      apiKeyId = apiKey.id;
    } catch (error) {
      console.warn('Invalid API key:', error);
    }
  }

  const isAuthenticated = !!userId;

  // Apply rate limiting: higher tier for authenticated profile actions,
  // stricter limits for unauthenticated endpoint structures.
  const rateLimit = checkRateLimit(req, {
    userId,
    apiKeyId,
    isAuthenticated,
  });

  return {
    req,
    userId,
    apiKeyId,
    isAuthenticated,
    rateLimit,
  };
}
