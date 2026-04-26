/**
 * Rate Limiting Middleware
 * Implements sliding window rate limiting with DDoS protection
 */

import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetTime: number;
  blockedUntil?: number;
}

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyGenerator?: (req: Request) => string; // Custom key generator
  skip?: (req: Request) => boolean; // Skip rate limiting for certain requests
  onLimitReached?: (req: Request, res: Response) => void; // Callback when limit reached
  blockDurationMs?: number; // Block duration for DDoS protection
}

interface RateLimitStore {
  [key: string]: RateLimitEntry;
}

/**
 * Sliding Window Rate Limiter Implementation
 */
export class RateLimiter {
  private store: RateLimitStore = {};
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout;

  constructor(config: RateLimitConfig) {
    this.config = {
      windowMs: 60000, // Default: 1 minute
      maxRequests: 100,
      blockDurationMs: 300000, // Default: 5 minutes block
      ...config,
    };

    // Cleanup old entries every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 600000);
  }

  /**
   * Generate rate limit key from request
   */
  private getKey(req: Request): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(req);
    }

    // Use API key if available, fallback to IP address
    const apiKey = req.headers["x-api-key"] as string;
    if (apiKey) {
      return `api-key:${apiKey}`;
    }

    const ip = req.ip || req.socket.remoteAddress || "unknown";
    return `ip:${ip}`;
  }

  /**
   * Check if request is within rate limit
   */
  public isLimited(req: Request): {
    limited: boolean;
    remaining: number;
    reset: number;
  } {
    const key = this.getKey(req);
    const now = Date.now();

    // Get or initialize entry
    let entry = this.store[key];
    if (!entry) {
      entry = this.store[key] = {
        count: 0,
        resetTime: now + this.config.windowMs,
      };
    }

    // Check if blocked (DDoS protection)
    if (entry.blockedUntil && now < entry.blockedUntil) {
      return { limited: true, remaining: 0, reset: entry.blockedUntil };
    }

    // Reset if window expired
    if (now >= entry.resetTime) {
      entry.count = 0;
      entry.resetTime = now + this.config.windowMs;
      delete entry.blockedUntil;
    }

    // Check limit
    const isLimited = entry.count >= this.config.maxRequests;

    if (isLimited) {
      // Enable DDoS protection: block for blockDurationMs
      if (!entry.blockedUntil) {
        entry.blockedUntil = now + (this.config.blockDurationMs || 300000);
      }
    }

    entry.count++;

    return {
      limited: isLimited,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      reset: entry.resetTime,
    };
  }

  /**
   * Middleware function
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Skip if configured
      if (this.config.skip && this.config.skip(req)) {
        return next();
      }

      const status = this.isLimited(req);

      // Set rate limit headers
      res.set("X-RateLimit-Limit", this.config.maxRequests.toString());
      res.set("X-RateLimit-Remaining", status.remaining.toString());
      res.set("X-RateLimit-Reset", Math.ceil(status.reset / 1000).toString());

      if (status.limited) {
        res.set(
          "Retry-After",
          Math.ceil((status.reset - Date.now()) / 1000).toString(),
        );

        if (this.config.onLimitReached) {
          this.config.onLimitReached(req, res);
        }

        return res.status(429).json({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please try again later.",
          retryAfter: Math.ceil((status.reset - Date.now()) / 1000),
        });
      }

      next();
    };
  }

  /**
   * Reset specific key
   */
  public reset(key?: string): void {
    if (key) {
      delete this.store[key];
    } else {
      this.store = {};
    }
  }

  /**
   * Cleanup old entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keys = Object.keys(this.store);

    keys.forEach((key) => {
      const entry = this.store[key];
      if (entry && now > entry.resetTime + this.config.windowMs) {
        delete this.store[key];
      }
    });
  }

  /**
   * Destroy cleanup interval
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Get stats for monitoring
   */
  public getStats() {
    return {
      totalKeys: Object.keys(this.store).length,
      config: this.config,
      entries: this.store,
    };
  }
}

/**
 * Request Queuing System
 * Handles request throttling and prioritization
 */
export class RequestQueue {
  private queue: Array<{
    req: Request;
    res: Response;
    next: NextFunction;
    priority: number;
    timestamp: number;
  }> = [];
  private processing = 0;
  private maxConcurrent: number = 10;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Enqueue request
   */
  public enqueue(
    req: Request,
    res: Response,
    next: NextFunction,
    priority: number = 0,
  ): void {
    this.queue.push({
      req,
      res,
      next,
      priority,
      timestamp: Date.now(),
    });

    // Sort by priority and timestamp
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.timestamp - b.timestamp;
    });

    this.processNext();
  }

  /**
   * Process next request in queue
   */
  private processNext(): void {
    if (this.processing >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.processing++;
    const item = this.queue.shift();

    if (item) {
      // Track when request completes
      const originalSend = item.res.send;
      item.res.send = function (data: any) {
        this.processing = Math.max(0, this.processing - 1);
        this.processNext();
        return originalSend.call(this, data);
      }.bind(this);

      item.next();
      this.processNext();
    }
  }

  /**
   * Get queue stats
   */
  public getStats() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

/**
 * Adaptive Rate Limiter
 * Adjusts limits based on server load
 */
export class AdaptiveRateLimiter extends RateLimiter {
  private baseMaxRequests: number;
  private minMemoryPercent: number = 10;
  private maxMemoryPercent: number = 90;

  constructor(config: RateLimitConfig & { baseMaxRequests?: number } = {}) {
    super(config);
    this.baseMaxRequests = config.baseMaxRequests || config.maxRequests || 100;
  }

  /**
   * Get adjusted rate limit based on memory usage
   */
  private getAdjustedLimit(): number {
    const memUsage = process.memoryUsage();
    const heapPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    if (heapPercent > this.maxMemoryPercent) {
      // Under high memory pressure, reduce limits to 50%
      return Math.floor(this.baseMaxRequests * 0.5);
    } else if (heapPercent < this.minMemoryPercent) {
      // Low memory usage, increase limits to 150%
      return Math.floor(this.baseMaxRequests * 1.5);
    }

    return this.baseMaxRequests;
  }

  /**
   * Override middleware to use adaptive limits
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Temporarily adjust max requests
      const originalMax = (this as any).config.maxRequests;
      (this as any).config.maxRequests = this.getAdjustedLimit();

      const middleware = super.middleware();
      middleware(req, res, next);

      // Restore original max
      (this as any).config.maxRequests = originalMax;
    };
  }
}

/**
 * Create default rate limiter middleware
 */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const limiter = new RateLimiter({
    windowMs: 60000,
    maxRequests: 100,
    ...config,
  });

  return limiter.middleware();
}

/**
 * Create API-specific rate limiter
 */
export function createApiRateLimiter(config: Partial<RateLimitConfig> = {}) {
  const limiter = new RateLimiter({
    windowMs: 60000,
    maxRequests: 30,
    keyGenerator: (req: Request) => {
      return `${req.method}:${req.path}:${req.ip}`;
    },
    ...config,
  });

  return limiter.middleware();
}

/**
 * Create endpoint-specific rate limiter
 */
export function createEndpointRateLimiter(
  endpoint: string,
  config: Partial<RateLimitConfig> = {},
) {
  const limiter = new RateLimiter({
    windowMs: 60000,
    maxRequests: 20,
    keyGenerator: (req: Request) => {
      const apiKey = req.headers["x-api-key"] as string;
      return apiKey ? `${endpoint}:${apiKey}` : `${endpoint}:${req.ip}`;
    },
    ...config,
  });

  return limiter.middleware();
}
