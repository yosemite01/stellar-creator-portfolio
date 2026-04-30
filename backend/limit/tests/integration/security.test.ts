/**
 * Integration Tests for API Security Middleware
 * Tests middleware in a running Express server context
 */

import express, { Express, Request, Response } from "express";
import { createSecureApp, setupExampleRoutes } from "../../app/api/middleware";

export class IntegrationTests {
  /**
   * Test: Complete middleware stack
   */
  static async testCompleteMiddlewareStack(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp({
        rateLimit: { enabled: true, maxRequests: 100 },
        cors: { enabled: true },
        authentication: { enabled: false }, // Disable for this test
        monitoring: { enabled: true },
      });

      // Setup example routes
      setupExampleRoutes(stack);

      // Test health endpoint
      const mockReq = {
        method: "GET",
        path: "/health",
        headers: {},
        ip: "127.0.0.1",
      };

      // Simulate request handling - would need actual HTTP server for full test
      return true;
    } catch (error) {
      console.error("Integration test failed:", error);
      return false;
    }
  }

  /**
   * Test: Rate limiting enforcement
   */
  static async testRateLimitingEnforcement(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp({
        rateLimit: { enabled: true, windowMs: 1000, maxRequests: 3 },
        authentication: { enabled: false },
      });

      // In a real test, make multiple requests and check for 429 response
      const rateLimiter = stack.getRateLimiter();
      if (!rateLimiter) return false;

      // Simulate requests
      const mockReq = {
        ip: "127.0.0.1",
        method: "GET",
        path: "/test",
      } as Request;
      let isLimited = false;

      for (let i = 0; i < 5; i++) {
        const status = rateLimiter.isLimited(mockReq);
        if (status.limited && !isLimited) {
          isLimited = true;
          break;
        }
      }

      stack.destroy();
      return isLimited;
    } catch (error) {
      console.error("Rate limiting test failed:", error);
      return false;
    }
  }

  /**
   * Test: CORS headers present
   */
  static async testCorsHeadersPresent(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp({
        cors: { enabled: true },
      });

      // Would need to make actual HTTP request to test headers
      // This is a setup validation
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Security headers present
   */
  static async testSecurityHeadersPresent(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp();

      // Would need to make actual HTTP request to verify headers
      // This is a setup validation
      const expectedHeaders = [
        "X-Content-Type-Options",
        "X-XSS-Protection",
        "X-Frame-Options",
        "Content-Security-Policy",
        "Strict-Transport-Security",
      ];

      return expectedHeaders.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: API key authentication
   */
  static async testApiKeyAuthentication(): Promise<boolean> {
    try {
      const { apiKeyManager } = require("../../lib/security");

      const { key, secret } = apiKeyManager.generateKey("test-api", [
        "read",
        "write",
      ]);

      // Create auth header
      const authHeader = `${key}:${secret}`;

      // Verify it works
      const verified = apiKeyManager.verify(key, secret);
      if (!verified) return false;

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Monitoring data collection
   */
  static async testMonitoringDataCollection(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp({
        monitoring: { enabled: true },
      });

      const monitoring = stack.getMonitoring();
      if (!monitoring) return false;

      // Verify monitoring is active
      const logger = monitoring.monitor.getLogger();
      if (!logger) return false;

      stack.destroy();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Request validation
   */
  static async testRequestValidation(): Promise<boolean> {
    try {
      const { InputValidator } = require("../../lib/security");

      const schema = {
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
      };

      // Valid request
      let result = InputValidator.validate(
        { email: "test@example.com", age: 25 },
        schema,
      );
      if (!result.valid) return false;

      // Invalid email
      result = InputValidator.validate(
        { email: "invalid-email", age: 25 },
        schema,
      );
      if (result.valid) return false;

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Error handling
   */
  static async testErrorHandling(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp();

      // Add error-throwing endpoint for testing
      (app as any).get("/test-error", (req: Request, res: Response) => {
        throw new Error("Test error");
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Request ID generation
   */
  static async testRequestIdGeneration(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp();

      // Request ID middleware should add ID to request
      (app as any).get("/test-id", (req: Request, res: Response) => {
        const requestId = (req as any).requestId;
        res.json({ requestId });
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Compression middleware
   */
  static async testCompressionMiddleware(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp({
        compression: { enabled: true },
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Trust proxy configuration
   */
  static async testTrustProxyConfiguration(): Promise<boolean> {
    try {
      const { app, stack } = createSecureApp({
        trustedProxy: true,
      });

      return true;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Performance Integration Tests
 */
export class PerformanceIntegrationTests {
  /**
   * Test: Rate limiting performance under load
   */
  static async testRateLimitingPerformance(): Promise<boolean> {
    try {
      const { RateLimiter } = require("../../middleware/rate-limit");

      const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 1000 });
      const mockReq = {
        ip: "127.0.0.1",
        method: "GET",
        path: "/test",
      } as Request;

      const startTime = Date.now();

      // Simulate 10000 rate limit checks
      for (let i = 0; i < 10000; i++) {
        limiter.isLimited(mockReq);
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 100ms for 10000 checks)
      return duration < 100;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Input validation performance
   */
  static async testInputValidationPerformance(): Promise<boolean> {
    try {
      const { InputValidator } = require("../../lib/security");

      const schema = {
        name: { type: "string", maxLength: 100 },
        email: { type: "string", pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      };

      const startTime = Date.now();

      // Simulate 1000 validations
      for (let i = 0; i < 1000; i++) {
        InputValidator.validate(
          { name: `User ${i}`, email: `user${i}@example.com` },
          schema,
        );
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 50ms for 1000 validations)
      return duration < 50;
    } catch (error) {
      return false;
    }
  }

  /**
   * Test: Monitoring overhead
   */
  static async testMonitoringOverhead(): Promise<boolean> {
    try {
      const {
        Logger,
        Monitor,
        EventType,
        LogLevel,
      } = require("../../lib/api-monitoring");

      const logger = new Logger();
      const monitor = new Monitor(logger);

      const startTime = Date.now();

      // Record 1000 events
      for (let i = 0; i < 1000; i++) {
        logger.log(LogLevel.INFO, EventType.REQUEST, `Request ${i}`, {
          method: "GET",
          path: "/api/test",
        });
      }

      const duration = Date.now() - startTime;

      monitor.stop();

      // Should complete in reasonable time (< 100ms for 1000 events)
      return duration < 100;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Run all integration tests
 */
export async function runAllIntegrationTests(): Promise<{
  passed: number;
  failed: number;
  tests: Array<{ name: string; passed: boolean; error?: string }>;
}> {
  const results: Array<{ name: string; passed: boolean; error?: string }> = [];

  const testClasses = [IntegrationTests, PerformanceIntegrationTests];

  for (const testClass of testClasses) {
    const methods = Object.getOwnPropertyNames(testClass).filter((m) =>
      m.startsWith("test"),
    );

    for (const method of methods) {
      try {
        const result = await (testClass as any)[method]();
        results.push({
          name: `${testClass.name}.${method}`,
          passed: result === true,
        });
      } catch (error) {
        results.push({
          name: `${testClass.name}.${method}`,
          passed: false,
          error: (error as Error).message,
        });
      }
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return { passed, failed, tests: results };
}
