import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface GraphQLContext {
  req: NextRequest;
  userId?: string;
  apiKeyId?: string;
  isAuthenticated: boolean;
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
      const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true },
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
      const [keyId, secret] = apiKeyHeader.split(':');
      if (!keyId || !secret) {
        throw new Error('Invalid API key format');
      }

      // Find the API key
      const apiKey = await prisma.apiKey.findUnique({
        where: { key: keyId },
        select: { id: true, secretHash: true, userId: true, active: true, expiresAt: true },
      });

      if (!apiKey || !apiKey.active) {
        throw new Error('API key not found or inactive');
      }

      // Check expiration
      if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
        throw new Error('API key expired');
      }

      // Verify secret hash
      const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
      if (secretHash !== apiKey.secretHash) {
        throw new Error('Invalid API key secret');
      }

      userId = apiKey.userId;
      apiKeyId = apiKey.id;
    } catch (error) {
      console.warn('Invalid API key:', error);
    }
  }

  return {
    req,
    userId,
    apiKeyId,
    isAuthenticated: !!userId,
  };
}
