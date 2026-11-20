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
import { ZodError } from 'zod';
import { prisma } from '@/lib/prisma';
import { tracingMiddleware } from '@/server/services/tracing';
import { CircuitOpenError } from '@/server/stellar/client';
import {
  checkRate,
  rateLimitKey,
  rateLimitMiddleware,
  RateLimitExceededError,
} from '@/server/api/rate-limit';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './jwt-secret';

// ─── Context Creation ─────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string | null;
  name: string | null;
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
      const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload & { userId: string };
      
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
        error.cause instanceof ZodError
          ? error.cause.flatten()
          : null,
    },
  }),
});

// ─── Middleware ───────────────────────────────────────────────────────────────

// tracingMiddleware's `next` param is typed generically (() => Promise<unknown>)
// so it can be shared across frameworks, but its implementation always
// resolves to exactly whatever `next()` itself resolved to - it never
// transforms the result. That means casting through `next`'s own real
// return type here reflects actual runtime behavior, not a false claim.
const tracingMw = t.middleware(({ next, path, type, ctx }) => {
  return tracingMiddleware({
    ctx: { headers: ctx.headers },
    next: next as unknown as () => Promise<unknown>,
    path,
    type,
  }) as ReturnType<typeof next>;
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
      const res = (ctx as Context & { res?: NextResponse }).res;
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

/**
 * Rate limiting middleware.
 *
 * Applies tiered limits based on authentication state:
 *   - Unauthenticated requests: strict limit (e.g. 30 req/min per IP)
 *   - Authenticated requests: higher-tier limit (e.g. 300 req/min per user)
 *
 * The actual limiter implementation (Redis vs in-memory) is selected at
 * runtime by `rateLimitMiddleware` based on deployment topology.
 */
const rateLimitMw = t.middleware(async ({ ctx, next, path }) => {
  try {
    await rateLimitMiddleware({
      req: ctx.req,
      headers: ctx.headers,
      user: ctx.user,
      path,
    });
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: err.message });
    }
    throw err;
  }
  return next();
});

/**
 * Per-procedure limiter, layered on top of the global one for endpoints
 * that need a tighter (or looser) budget than the tier default:
 *
 *   publicProcedure.use(rateLimit({ windowMs: 60_000, max: 60 }))
 *
 * Buckets are keyed by procedure path plus user id (or client IP when
 * unauthenticated), so one hot endpoint can't starve another.
 */
export function rateLimit({ windowMs, max }: { windowMs: number; max: number }) {
  return t.middleware(async ({ ctx, next, path }) => {
    const key = rateLimitKey(ctx.headers ?? ctx.req.headers, { userId: ctx.user?.id }, path);
    const result = checkRate(key, max, windowMs / 1000);
    if (!result.allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Rate limit exceeded. Retry after ${result.retryAfter}s`,
      });
    }
    return next();
  });
}

// ─── Base Procedures ──────────────────────────────────────────────────────────

export const router = t.router;

// Every public procedure: tracing → circuit breaker
export const publicProcedure = t.procedure
  .use(tracingMw)
  .use(circuitBreakerMw)
  .use(rateLimitMw);

// Every protected procedure: tracing → circuit breaker → rate limit → auth
export const protectedProcedure = t.procedure
  .use(tracingMw)
  .use(circuitBreakerMw)
  .use(rateLimitMw)
  .use(authMiddleware);