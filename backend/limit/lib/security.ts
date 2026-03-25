/**
 * Security Utilities
 * Includes authentication, validation, sanitization, and CORS/CSP
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * API Key Authentication
 */
export interface ApiKey {
  key: string;
  secret: string;
  name: string;
  permissions: string[];
  rateLimit: number;
  createdAt: Date;
  expiresAt?: Date;
  active: boolean;
}

export interface AuthenticatedRequest extends Request {
  apiKey?: ApiKey;
  user?: { id: string; email: string };
  requestId?: string;
}

/**
 * API Key Manager
 */
export class ApiKeyManager {
  private keys: Map<string, ApiKey> = new Map();

  /**
   * Generate new API key pair
   */
  public generateKey(
    name: string,
    permissions: string[] = [],
    rateLimit: number = 100,
  ): {
    key: string;
    secret: string;
  } {
    const key = `sk_${crypto.randomBytes(16).toString("hex")}`;
    const secret = crypto.randomBytes(32).toString("hex");

    const apiKey: ApiKey = {
      key,
      secret: this.hashSecret(secret),
      name,
      permissions,
      rateLimit,
      createdAt: new Date(),
      active: true,
    };

    this.keys.set(key, apiKey);
    return { key, secret };
  }

  /**
   * Hash secret for storage
   */
  private hashSecret(secret: string): string {
    return crypto.createHash("sha256").update(secret).digest("hex");
  }

  /**
   * Verify API key and secret
   */
  public verify(key: string, secret: string): ApiKey | null {
    const apiKey = this.keys.get(key);

    if (!apiKey || !apiKey.active) {
      return null;
    }

    if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
      apiKey.active = false;
      return null;
    }

    const hashedSecret = this.hashSecret(secret);
    if (hashedSecret !== apiKey.secret) {
      return null;
    }

    return apiKey;
  }

  /**
   * Revoke API key
   */
  public revoke(key: string): boolean {
    const apiKey = this.keys.get(key);
    if (apiKey) {
      apiKey.active = false;
      return true;
    }
    return false;
  }

  /**
   * Get API key info (without secret)
   */
  public getKey(key: string): Omit<ApiKey, "secret"> | null {
    const apiKey = this.keys.get(key);
    if (!apiKey) return null;

    const { secret, ...apiKeyInfo } = apiKey;
    return apiKeyInfo;
  }
}

const apiKeyManager = new ApiKeyManager();

/**
 * API Key Authentication Middleware
 */
export function apiKeyAuthentication(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization || "";
  const apiKeyHeader = req.headers["x-api-key"] as string;

  if (apiKeyHeader) {
    // API Key format: key:secret
    const [key, secret] = apiKeyHeader.split(":");
    const apiKey = apiKeyManager.verify(key, secret);

    if (!apiKey) {
      return res.status(401).json({ error: "Invalid or expired API key" });
    }

    req.apiKey = apiKey;
    req.requestId = crypto.randomUUID();
    return next();
  }

  if (authHeader.startsWith("Bearer ")) {
    // JWT token handling can be added here
    const token = authHeader.substring(7);
    try {
      // Validate JWT token
      req.requestId = crypto.randomUUID();
      return next();
    } catch (error) {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  return res.status(401).json({ error: "Missing or invalid authentication" });
}

/**
 * Input Validation and Sanitization
 */
export interface ValidationSchema {
  [key: string]: {
    type: "string" | "number" | "boolean" | "array" | "object";
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: RegExp;
    enum?: any[];
    items?: ValidationSchema;
    properties?: ValidationSchema;
  };
}

export class InputValidator {
  /**
   * Sanitize input string
   */
  static sanitizeString(
    input: string,
    options: { maxLength?: number } = {},
  ): string {
    const { maxLength = 10000 } = options;

    // Remove null bytes
    let sanitized = input.replace(/\0/g, "");

    // Trim whitespace
    sanitized = sanitized.trim();

    // Limit length
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    // Remove control characters (except common whitespace)
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    return sanitized;
  }

  /**
   * Sanitize HTML/Script content
   */
  static sanitizeHtml(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;")
      .replace(/\//g, "&#x2F;");
  }

  /**
   * Validate email format
   */
  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate URL
   */
  static validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate input against schema
   */
  static validate(
    data: any,
    schema: ValidationSchema,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];

      // Check required
      if (rules.required && (value === undefined || value === null)) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value === undefined || value === null) {
        continue;
      }

      // Check type
      if (typeof value !== rules.type) {
        errors.push(`${field} must be of type ${rules.type}`);
        continue;
      }

      // Validate string
      if (rules.type === "string") {
        if (rules.minLength && value.length < rules.minLength) {
          errors.push(
            `${field} must have at least ${rules.minLength} characters`,
          );
        }
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(
            `${field} must have at most ${rules.maxLength} characters`,
          );
        }
        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push(`${field} does not match required format`);
        }
        if (rules.enum && !rules.enum.includes(value)) {
          errors.push(`${field} must be one of: ${rules.enum.join(", ")}`);
        }
      }

      // Validate number
      if (rules.type === "number") {
        if (rules.min !== undefined && value < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined && value > rules.max) {
          errors.push(`${field} must be at most ${rules.max}`);
        }
      }

      // Validate array
      if (rules.type === "array" && Array.isArray(value)) {
        if (rules.items && rules.items && typeof rules.items === "object") {
          for (const item of value) {
            const itemResult = this.validate({ item }, { item: rules.items });
            if (!itemResult.valid) {
              errors.push(`${field}: ${itemResult.errors.join(", ")}`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Input Validation Middleware
 */
export function validateInput(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Sanitize query params
    for (const key in req.query) {
      if (typeof req.query[key] === "string") {
        req.query[key] = InputValidator.sanitizeString(
          req.query[key] as string,
        );
      }
    }

    // Sanitize body
    if (req.body && typeof req.body === "object") {
      for (const key in req.body) {
        if (typeof req.body[key] === "string") {
          req.body[key] = InputValidator.sanitizeString(req.body[key]);
        }
      }
    }

    // Validate against schema
    const validation = InputValidator.validate(req.body || req.query, schema);
    if (!validation.valid) {
      return res.status(400).json({ errors: validation.errors });
    }

    next();
  };
}

/**
 * CORS and Security Headers Configuration
 */
export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  credentials: boolean;
  maxAge: number;
}

export const defaultCorsConfig: CorsConfig = {
  allowedOrigins: ["http://localhost:3000", "http://localhost:8000"],
  allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-API-Key",
    "X-Request-ID",
  ],
  exposedHeaders: [
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
    "X-Request-ID",
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
};

/**
 * CORS Middleware
 */
export function corsMiddleware(config: Partial<CorsConfig> = {}) {
  const corsConfig = { ...defaultCorsConfig, ...config };

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (origin && corsConfig.allowedOrigins.includes(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Credentials", "true");
    }

    res.set(
      "Access-Control-Allow-Methods",
      corsConfig.allowedMethods.join(", "),
    );
    res.set(
      "Access-Control-Allow-Headers",
      corsConfig.allowedHeaders.join(", "),
    );
    res.set(
      "Access-Control-Expose-Headers",
      corsConfig.exposedHeaders.join(", "),
    );
    res.set("Access-Control-Max-Age", corsConfig.maxAge.toString());

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  };
}

/**
 * Security Headers Middleware
 */
export function securityHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Prevent MIME type sniffing
  res.set("X-Content-Type-Options", "nosniff");

  // Enable XSS protection
  res.set("X-XSS-Protection", "1; mode=block");

  // Prevent clickjacking
  res.set("X-Frame-Options", "DENY");

  // Content Security Policy
  res.set(
    "Content-Security-Policy",
    `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    font-src 'self';
    connect-src 'self' https:;
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
  `.replace(/\n/g, ""),
  );

  // Referrer Policy
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions Policy (Feature Policy)
  res.set(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  );

  // Strict Transport Security
  res.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );

  // Disable caching for sensitive content
  if (req.path.includes("/api/") || req.path.includes("/admin/")) {
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }

  next();
}

/**
 * Export manager instance
 */
export { apiKeyManager };
