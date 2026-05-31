import { checkRate } from "./rateLimit";
import type { Request, Response, NextFunction } from "express";

// Express-style middleware. Applies stricter limits for unauthenticated users.
export function rateLimitMiddleware(opts?: { unauthenticatedLimit?: number; authenticatedLimit?: number }) {
  const unauthenticatedLimit = opts?.unauthenticatedLimit ?? 30; // per minute
  const authenticatedLimit = opts?.authenticatedLimit ?? 300; // per minute

  return function (req: Request, res: Response, next: NextFunction) {
    try {
      const identifier = (req.ip || req.headers['x-forwarded-for'] || 'unknown') as string;
      const isAuthed = !!(req as any).user;
      const limit = isAuthed ? authenticatedLimit : unauthenticatedLimit;
      const result = checkRate(identifier, limit, 60);

      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      if (!result.allowed) {
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
