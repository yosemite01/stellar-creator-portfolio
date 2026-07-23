/**
 * tRPC Server Setup with Authentication and Tracing
 * 
 * Provides type-safe procedures with automatic context injection,
 * authentication middleware, and distributed tracing integration.
 *
 * Circuit breaker:
 *   A `circuitBreakerMiddleware` is applied to all procedures.  When the
 *   Stellar RPC circuit is OPEN, procedures that call the Stellar client will
 *   surface a `CircuitOpenError` which is caught here and converted to a
 *   tRPC `SERVICE_UNAVAILABLE` error (HTTP 503) with a `Retry-After: 30`
 *   header so clients know exactly when to retry.
 */

import { TRPCError, initTRPC } from '@trpc/server';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { tracingMiddleware } from '@/backend/services/tracing';
import { CircuitOpenError } from '@/services/api/stellar/client';
import jwt from 'jsonwebtoken';

// ─── Context Creation ─────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  name: string;
}

interface Context {
  req: NextRequest;
  headers?: Headers;
  user?: User;
  prisma: typeof prisma;
}

export async function createContext(req: NextRequest): Promise<Context> {
  const headers = req.headers;
  
  // Extract user from auth token if present
  let user: User | undefined;
  const authorization = headers.get('authorization');
  
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7);
    try {
      const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      // Fetch user from database
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, name: true },
      });
      
      if (dbUser) {
        user = dbUser;
      }
    } catch (error) {
      // Invalid token - user stays undefined
      console.warn('Invalid JWT token:', error);
    }
  }

  return {
    req,
    headers,
    user,
    prisma,
  };
}

// ─── tRPC Initialization ──────────────────────────────────────────────────────

const t = initTRPC.context<Context>().create({
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError: 
        error.cause instanceof Error && error.cause.name === 'ZodError'
          ? error.cause.flatten()
          : null,
    },
  }),
});

// ─── Middleware ───────────────────────────────────────────────────────────────

const tracingMw = t.middleware(({ next, path, type, ctx }) => {
  return tracingMiddleware({
    ctx: { headers: ctx.headers },
    next,
    path,
    type,
  });
});

const authMiddleware = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/**
 * Circuit breaker middleware.
 *
 * Catches `CircuitOpenError` thrown by any Stellar RPC call inside a procedure
 * and converts it into a tRPC `SERVICE_UNAVAILABLE` (HTTP 503).
 *
 * The `Retry-After: 30` header is injected into the response headers so HTTP
 * clients and proxies know the exact back-off window.  tRPC itself doesn't
 * expose a first-class header API in middleware, so we attach it to the raw
 * Next.js response via `ctx.req` when available.
 */
const circuitBreakerMw = t.middleware(async ({ ctx, next }) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof CircuitOpenError) {
      // Attach Retry-After to the underlying Next.js response when we can
      // reach it (tRPC Next.js adapter exposes the response object via context
      // in some configurations; we guard with a type-safe check).
      const res = (ctx as any).res as NextResponse | undefined;
      if (res && typeof res.headers?.set === 'function') {
        res.headers.set('Retry-After', String(err.retryAfterSeconds));
      }

      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: err.message,
        cause: err,
      });
    }
    throw err;
  }
});

// ─── Base Procedures ──────────────────────────────────────────────────────────

export const router = t.router;

// Every public procedure: tracing → circuit breaker
export const publicProcedure = t.procedure
  .use(tracingMw)
  .use(circuitBreakerMw);

// Every protected procedure: tracing → circuit breaker → auth
export const protectedProcedure = t.procedure
  .use(tracingMw)
  .use(circuitBreakerMw)
  .use(authMiddleware);