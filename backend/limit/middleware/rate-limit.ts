/**
 * Rate Limiting Middleware
 * Implements sliding window rate limiting with DDoS protection, Redis backing, and Prometheus metrics
 */

import { Request, Response, NextFunction } from "express";
import { RedisClient } from "redis";

// ─── Per-Endpoint Rate Limit Constants ─────────────────────────────────────

/** Rate limits for specific API endpoints (endpoint_name: {limit, window_ms}). */
export const ENDPOINT_RATE_LIMITS = {
  "POST /api/messages": {
    limit: 30,
    windowMs: 60 * 1000, // 60 seconds
  },
  "POST /api/bounties": {
    limit: 5,
    windowMs: 60 * 60 * 1000, // 3600 seconds (1 hour)
  },
  "GET /api/search": {
    limit: 100,
    windowMs: 60 * 1000, // 60 seconds
  },
  "POST /api/relay/sponsor": {
    limit: 10,
    windowMs: 60 * 1000, // 60 seconds
  },
  "POST /api/ipfs/pin": {
    limit: 20,
    windowMs: 60 * 60 * 1000, // 3600 seconds (1 hour)
  },
} as const;

// ─── Prometheus Metrics ───────────────────────────────────────────────────

let prometheusMetrics: {
  rateLimitHitsTotal?: { inc: (labels: any) => void };
} = {};

/**
 * Initialize Prometheus metrics (called once during app setup)
 */
export function initPrometheusMetrics(register: any): void {
  try {
    // Import prometheus client if available
    const prometheus = require("prom-client");
    if (!prometheus) return;

    prometheusMetrics.rateLimitHitsTotal = new prometheus.Counter({
      name: "rate_limit_hits_total",
      help: "Total number of rate limit checks",
      labelNames: ["endpoint", "result"],
      registers: [register],
    });
  } catch {
    // Prometheus not installed; metrics will be no-ops
  }
}

/**
 * Record a rate limit hit in Prometheus
 */
function recordRateLimitMetric(
  endpoint: string,
  result: "allowed" | "blocked",
): void {
  if (prometheusMetrics.rateLimitHitsTotal) {
    prometheusMetrics.rateLimitHitsTotal.inc({ endpoint, result });
  }
}

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
  redisClient?: RedisClient; // Optional Redis client for distributed rate limiting
  endpointName?: string; // Name of endpoint for metrics and logging
}

interface RateLimitStore {
  [key: string]: RateLimitEntry;
}

/**
 * Sliding Window Rate Limiter Implementation
 * Supports both in-memory and Redis-backed storage.
 */
export class RateLimiter {
  private store: RateLimitStore = {};
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout;
  private redisClient?: RedisClient;

  constructor(config: RateLimitConfig) {
    this.config = {
      windowMs: 60000, // Default: 1 minute
      maxRequests: 100,
      blockDurationMs: 300000, // Default: 5 minutes block
      ...config,
    };

    this.redisClient = config.redisClient;

    // Cleanup old entries every 10 minutes (only for in-memory store)
    if (!this.redisClient) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, 600000);
    }
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
   * Check if user has admin role (to bypass rate limits)
   */
  private isAdmin(req: Request): boolean {
    const userRole = (req as any).user?.role || (req as any).role;
    return userRole === "admin" || userRole === "ADMIN";
  }

  /**
   * Check if request is within rate limit
   * Supports both in-memory and Redis-backed sliding window.
   */
  public async isLimited(req: Request): Promise<{
    limited: boolean;
    remaining: number;
    reset: number;
  }> {
    // Admin role always bypasses rate limits
    if (this.isAdmin(req)) {
      return { limited: false, remaining: this.config.maxRequests, reset: Date.now() + this.config.windowMs };
    }

    const key = this.getKey(req);
    const now = Date.now();

    if (this.redisClient) {
      return this.checkLimitRedis(key, now);
    } else {
      return this.checkLimitMemory(key, now);
    }
  }

  /**
   * Check rate limit using in-memory store (non-distributed)
   */
  private checkLimitMemory(key: string, now: number): {
    limited: boolean;
    remaining: number;
    reset: number;
  } {
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
   * Check rate limit using Redis-backed sliding window
   */
  private async checkLimitRedis(key: string, now: number): Promise<{
    limited: boolean;
    remaining: number;
    reset: number;
  }> {
    if (!this.redisClient) {
      throw new Error("Redis client not configured");
    }

    try {
      const windowStart = now - this.config.windowMs;

      // Remove old entries outside the window
      await this.redisClient.zRemRangeByScore(key, "-inf", windowStart);

      // Count requests in current window
      const count = await this.redisClient.zCard(key);
      const isLimited = count >= this.config.maxRequests;

      // Add current request
      await this.redisClient.zAdd(key, { score: now, member: String(now) });

      // Set expiration (window + extra time for safety)
      await this.redisClient.expire(key, Math.ceil((this.config.windowMs + 10000) / 1000));

      return {
        limited: isLimited,
        remaining: Math.max(0, this.config.maxRequests - count),
        reset: now + this.config.windowMs,
      };
    } catch (error) {
      console.error("Redis rate limit check failed:", error);
      // Fall back to in-memory on Redis error
      return this.checkLimitMemory(key, now);
    }
  }

  /**
   * Middleware function (async-aware)
   */
  public middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Skip if configured
      if (this.config.skip && this.config.skip(req)) {
        return next();
      }

      try {
        const status = await this.isLimited(req);
        const endpointName = this.config.endpointName || req.path;

        // Set rate limit headers
        res.set("X-RateLimit-Limit", this.config.maxRequests.toString());
        res.set("X-RateLimit-Remaining", status.remaining.toString());
        res.set("X-RateLimit-Reset", Math.ceil(status.reset / 1000).toString());

        if (status.limited) {
          const retryAfterSeconds = Math.ceil((status.reset - Date.now()) / 1000);
          res.set("Retry-After", retryAfterSeconds.toString());

          // Record Prometheus metric
          recordRateLimitMetric(endpointName, "blocked");

          if (this.config.onLimitReached) {
            this.config.onLimitReached(req, res);
          }

          return res.status(429).json({
            error: "Rate limit exceeded",
            retryAfter: retryAfterSeconds,
          });
        }

        // Record Prometheus metric
        recordRateLimitMetric(endpointName, "allowed");

        next();
      } catch (error) {
        console.error("Rate limit check error:", error);
        // On error, allow the request through
        next();
      }
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
 * Create endpoint-specific rate limiter using named constants from ENDPOINT_RATE_LIMITS
 */
export function createEndpointRateLimiter(
  endpoint: keyof typeof ENDPOINT_RATE_LIMITS,
  config: Partial<RateLimitConfig> = {},
  redisClient?: RedisClient,
) {
  const limitConfig = ENDPOINT_RATE_LIMITS[endpoint];
  const limiter = new RateLimiter({
    windowMs: limitConfig.windowMs,
    maxRequests: limitConfig.limit,
    endpointName: endpoint,
    keyGenerator: (req: Request) => {
      // Use authenticated user ID if available, otherwise use IP + API key
      const userId = (req as any).user?.id || (req as any).userId;
      const apiKey = req.headers["x-api-key"] as string;
      if (userId) {
        return `${endpoint}:${userId}`;
      }
      return apiKey ? `${endpoint}:${apiKey}` : `${endpoint}:${req.ip}`;
    },
    redisClient,
    ...config,
  });

  return limiter.middleware();
}

/**
 * Create rate limiter factory that uses ENDPOINT_RATE_LIMITS constants
 * Returns a function that can be used as Express middleware
 */
export function createPerEndpointRateLimiter(
  endpoint: keyof typeof ENDPOINT_RATE_LIMITS,
  redisClient?: RedisClient,
) {
  return createEndpointRateLimiter(endpoint, {}, redisClient);
}
