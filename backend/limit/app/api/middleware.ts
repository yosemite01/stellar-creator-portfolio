/**
 * Unified API Middleware Configuration
 * Combines all security, rate limiting, and monitoring middleware
 */

import express, { Express, Request, Response, NextFunction } from "express";
import {
  apiKeyAuthentication,
  corsMiddleware,
  securityHeadersMiddleware,
  validateInput,
  ValidationSchema,
  CorsConfig,
} from "../lib/security";
import { RateLimiter, RequestQueue } from "../middleware/rate-limit";
import { createMonitoring, Monitor } from "../lib/api-monitoring";

/**
 * Middleware Configuration Options
 */
export interface MiddlewareConfig {
  rateLimit?: {
    enabled: boolean;
    windowMs?: number;
    maxRequests?: number;
    blockDurationMs?: number;
  };
  cors?: {
    enabled: boolean;
    config?: Partial<CorsConfig>;
  };
  authentication?: {
    enabled: boolean;
    optional?: boolean;
  };
  monitoring?: {
    enabled: boolean;
    anomalyThreshold?: number;
  };
  compression?: {
    enabled: boolean;
  };
  bodySize?: string;
  trustedProxy?: boolean;
}

export const defaultConfig: MiddlewareConfig = {
  rateLimit: {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100,
    blockDurationMs: 300000,
  },
  cors: {
    enabled: true,
  },
  authentication: {
    enabled: true,
    optional: false,
  },
  monitoring: {
    enabled: true,
    anomalyThreshold: 10,
  },
  compression: {
    enabled: true,
  },
  bodySize: "10kb",
  trustedProxy: false,
};

/**
 * API Middleware Stack
 */
export class ApiMiddlewareStack {
  private app: Express;
  private config: MiddlewareConfig;
  private rateLimiter?: RateLimiter;
  private requestQueue?: RequestQueue;
  private monitoring?: { middleware: any; monitor: Monitor };

  constructor(app: Express, config: Partial<MiddlewareConfig> = {}) {
    this.app = app;
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Apply all middleware
   */
  public apply(): void {
    // Trust proxy if configured
    if (this.config.trustedProxy) {
      this.app.set("trust proxy", true);
    }

    // Parse JSON with size limit
    this.app.use(express.json({ limit: this.config.bodySize }));
    this.app.use(
      express.urlencoded({ limit: this.config.bodySize, extended: true }),
    );

    // Compression
    if (this.config.compression?.enabled) {
      const compression = require("compression");
      this.app.use(compression());
    }

    // Security Headers (apply early)
    this.app.use(securityHeadersMiddleware);

    // CORS
    if (this.config.cors?.enabled) {
      this.app.use(corsMiddleware(this.config.cors.config));
    }

    // Monitoring
    if (this.config.monitoring?.enabled) {
      this.monitoring = createMonitoring();
      this.app.use(this.monitoring.middleware);
    }

    // Rate Limiting
    if (this.config.rateLimit?.enabled) {
      this.rateLimiter = new RateLimiter({
        windowMs: this.config.rateLimit.windowMs || 60000,
        maxRequests: this.config.rateLimit.maxRequests || 100,
        blockDurationMs: this.config.rateLimit.blockDurationMs || 300000,
      });
      this.app.use(this.rateLimiter.middleware());
    }

    // Request Queuing
    this.requestQueue = new RequestQueue(10);

    // Authentication
    if (this.config.authentication?.enabled) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        // Skip authentication for health check and public endpoints
        const publicPaths = ["/health", "/status", "/metrics"];
        if (publicPaths.includes(req.path)) {
          return next();
        }

        apiKeyAuthentication(req as any, res, next);
      });
    }

    // Request ID middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId =
        (req.headers["x-request-id"] as string) ||
        require("crypto").randomUUID();
      (req as any).requestId = requestId;
      res.set("X-Request-ID", requestId);
      next();
    });

    // Error handling middleware
    this.app.use(this.errorHandler.bind(this));
  }

  /**
   * Get validation middleware
   */
  public validate(schema: ValidationSchema) {
    return validateInput(schema);
  }

  /**
   * Error handler middleware
   */
  private errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    console.error("Error:", err);

    // Log security event if applicable
    if (this.monitoring) {
      const severity =
        err.message.includes("Invalid") || err.message.includes("Unauthorized")
          ? "MEDIUM"
          : "HIGH";
      this.monitoring.monitor.recordSecurityEvent(
        "SUSPICIOUS_PATTERN",
        req.ip || "unknown",
        req.path,
        severity,
        err.message,
      );
    }

    const statusCode = (err as any).statusCode || 500;
    const message =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message;

    res.status(statusCode).json({
      error: true,
      message,
      requestId: (req as any).requestId,
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  }

  /**
   * Get monitoring instance
   */
  public getMonitoring() {
    return this.monitoring;
  }

  /**
   * Get rate limiter instance
   */
  public getRateLimiter() {
    return this.rateLimiter;
  }

  /**
   * Create route with rate limiting
   */
  public createRoute(
    path: string,
    method: "get" | "post" | "put" | "delete" | "patch",
    handler: (req: Request, res: Response) => Promise<void> | void,
    options?: {
      rateLimit?: { windowMs?: number; maxRequests?: number };
      validation?: ValidationSchema;
      requireAuth?: boolean;
    },
  ): void {
    const middleware: any[] = [];

    // Add validation if provided
    if (options?.validation) {
      middleware.push(validateInput(options.validation));
    }

    // Add route-specific rate limiting if provided
    if (options?.rateLimit) {
      const limiter = new RateLimiter(options.rateLimit);
      middleware.push(limiter.middleware());
    }

    // Add handler
    middleware.push(async (req: Request, res: Response, next: NextFunction) => {
      try {
        await handler(req, res);
      } catch (error) {
        next(error);
      }
    });

    this.app[method](path, ...middleware);
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.rateLimiter) {
      this.rateLimiter.destroy();
    }

    if (this.monitoring?.monitor) {
      this.monitoring.monitor.stop();
    }
  }
}

/**
 * Create configured Express app
 */
export function createSecureApp(config: Partial<MiddlewareConfig> = {}): {
  app: Express;
  stack: ApiMiddlewareStack;
} {
  const app = express();
  const stack = new ApiMiddlewareStack(app, config);
  stack.apply();

  return { app, stack };
}

/**
 * Example usage
 */
export function setupExampleRoutes(stack: ApiMiddlewareStack): void {
  // Health check endpoint (public)
  (stack as any).app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "healthy", timestamp: new Date() });
  });

  // Status endpoint with full monitoring
  (stack as any).app.get("/status", (req: Request, res: Response) => {
    const monitoring = stack.getMonitoring();
    const rateLimiter = stack.getRateLimiter();

    if (!monitoring) {
      return res.status(503).json({ error: "Monitoring not available" });
    }

    const metrics = monitoring.monitor.getMetrics();
    const alerts = monitoring.monitor.getAlerts({ limit: 10 });

    res.json({
      status: "operational",
      metrics,
      recentAlerts: alerts,
      rateLimiterStats: rateLimiter?.getStats(),
    });
  });

  // Example protected API endpoint
  stack.createRoute(
    "/api/users",
    "get",
    async (req: Request, res: Response) => {
      res.json({ users: [] });
    },
    {
      requireAuth: true,
      rateLimit: {
        windowMs: 60000,
        maxRequests: 30,
      },
    },
  );

  // Example POST endpoint with validation
  stack.createRoute(
    "/api/data",
    "post",
    async (req: Request, res: Response) => {
      res.json({ success: true, data: req.body });
    },
    {
      requireAuth: true,
      validation: {
        name: {
          type: "string",
          required: true,
          minLength: 1,
          maxLength: 100,
        },
        email: {
          type: "string",
          required: true,
          pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        },
        age: {
          type: "number",
          min: 0,
          max: 150,
        },
      },
      rateLimit: {
        windowMs: 60000,
        maxRequests: 20,
      },
    },
  );
}
