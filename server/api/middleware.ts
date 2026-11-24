import { checkRate } from './rate-limit'
import { requireRole, requireAuth, requireOwnership, requireOwnerOrAdmin, NotAuthenticatedError, ForbiddenError } from '../services/authorization'
import type { Request, Response, NextFunction } from 'express'

// Express-style middleware. Applies stricter limits for unauthenticated users.
export function rateLimitMiddleware(opts?: { unauthenticatedLimit?: number; authenticatedLimit?: number }) {
  const unauthenticatedLimit = opts?.unauthenticatedLimit ?? 30; // per minute
  const authenticatedLimit = opts?.authenticatedLimit ?? 300; // per minute

  return function (req: Request, res: Response, next: NextFunction) {
    try {
      const ipAuthenticated = !!(req as any).user;
      const identifier = ipAuthenticated
        ? `user:${((req as any).user?.id || (req as any).user?.userId || 'unknown')} `
        : ((req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown') as string);
      const limit = ipAuthenticated ? authenticatedLimit : unauthenticatedLimit;
      const result = checkRate(identifier, limit, 60);

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfter));
        res.status(429).json({ error: 'Too many requests' });
        return;
      }
      next();
    } catch (e) {
      // Fail-open: do not block traffic if rate limiter crashes
      console.error('rateLimitMiddleware error', e);
      next();
    }
  };
}

// ── Authorization Middleware for Express/REST ─────────────────────────────────

export interface AuthorizationOptions {
  role?: string | string[]
  ownerField?: string
}

/**
 * Authorization middleware for Express/REST routes.
 * Usage:
 *   app.get('/api/resource', authorizationMiddleware({ role: 'ADMIN' }), handler)
 *   app.post('/api/resource', authorizationMiddleware({ ownerField: 'id' }), handler)
 */
export function authorizationMiddleware(options: AuthorizationOptions = {}) {
  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      // Extract user from session
      const session = (req as any).session
      const user = session?.user
      const role = (req as any).user?.role

      const authContext = { user, role }

      // Require authentication
      requireAuth(authContext)

      // Check role if specified
      if (options.role) {
        const allowedRoles = Array.isArray(options.role) ? options.role : [options.role]
        requireRole(authContext, allowedRoles as any)
      }

      // Check ownership if specified (for IDOR prevention)
      if (options.ownerField) {
        const resourceOwner = req.body?.[options.ownerField] || req.params?.[options.ownerField]
        const userId = authContext.user!.id
        requireOwnership(resourceOwner, userId)
      }

      next()
    } catch (error) {
      if (error instanceof NotAuthenticatedError) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      if (error instanceof ForbiddenError) {
        res.status(403).json({ error: 'Forbidden' })
        return
      }
      next(error)
    }
  }
}

// Re-export authorization errors and helpers
export { requireAuth, requireRole, requireOwnership, requireOwnerOrAdmin, NotAuthenticatedError, ForbiddenError }
