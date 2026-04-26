/**
 * Unit Tests for Rate Limiting
 * Tests rate limiting logic, sliding window, and DDoS protection
 */

import {
  RateLimiter,
  AdaptiveRateLimiter,
  RequestQueue,
} from "../../middleware/rate-limit";
import { Request } from "express";

export class RateLimiterTests {
  /**
   * Test: Basic rate limiting
   */
  static testBasicRateLimiting(): boolean {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
    const mockReq = {
      ip: "127.0.0.1",
      method: "GET",
      path: "/api/test",
    } as Request;

    // First 3 requests should pass
    for (let i = 0; i < 3; i++) {
      const status = limiter.isLimited(mockReq);
      if (status.limited) return false;
    }

    // 4th request should be limited
    const status = limiter.isLimited(mockReq);
    if (!status.limited) return false;

    return true;
  }

  /**
   * Test: Sliding window reset
   */
  static testSlidingWindowReset(): boolean {
    const limiter = new RateLimiter({ windowMs: 100, maxRequests: 1 });
    const mockReq = {
      ip: "127.0.0.1",
      method: "GET",
      path: "/api/test",
    } as Request;

    // First request passes
    let status = limiter.isLimited(mockReq);
    if (status.limited) return false;

    // Second request fails
    status = limiter.isLimited(mockReq);
    if (!status.limited) return false;

    // Wait for window to reset
    const waitMs = 110;
    const now = Date.now();
    while (Date.now() - now < waitMs) {
      // Busy wait
    }

    // Request should pass now
    status = limiter.isLimited(mockReq);
    if (status.limited) return false;

    return true;
  }

  /**
   * Test: Per-IP rate limiting
   */
  static testPerIpRateLimiting(): boolean {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2 });
    const req1 = {
      ip: "192.168.1.1",
      method: "GET",
      path: "/api/test",
    } as Request;
    const req2 = {
      ip: "192.168.1.2",
      method: "GET",
      path: "/api/test",
    } as Request;

    // IP1: 2 requests pass
    for (let i = 0; i < 2; i++) {
      if (limiter.isLimited(req1).limited) return false;
    }

    // IP1: 3rd request fails
    if (!limiter.isLimited(req1).limited) return false;

    // IP2: Should still have requests
    if (limiter.isLimited(req2).limited) return false;

    return true;
  }

  /**
   * Test: DDoS protection (blocking)
   */
  static testDdosProtection(): boolean {
    const limiter = new RateLimiter({
      windowMs: 1000,
      maxRequests: 2,
      blockDurationMs: 1000,
    });
    const mockReq = {
      ip: "192.168.1.1",
      method: "GET",
      path: "/api/test",
    } as Request;

    // Make 3 requests to exceed limit
    for (let i = 0; i < 3; i++) {
      limiter.isLimited(mockReq);
    }

    // Should be blocked now
    let status = limiter.isLimited(mockReq);
    if (!status.limited) return false;

    // BlockedUntil should be set
    if (!status.reset || status.reset <= Date.now()) return false;

    return true;
  }

  /**
   * Test: Request remaining count
   */
  static testRemainingCount(): boolean {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 5 });
    const mockReq = {
      ip: "127.0.0.1",
      method: "GET",
      path: "/api/test",
    } as Request;

    let status = limiter.isLimited(mockReq);
    if (status.remaining !== 4) return false; // 5 - 1

    status = limiter.isLimited(mockReq);
    if (status.remaining !== 3) return false; // 5 - 2

    return true;
  }

  /**
   * Test: Adaptive rate limiting
   */
  static testAdaptiveRateLimiting(): boolean {
    const limiter = new AdaptiveRateLimiter({
      windowMs: 1000,
      maxRequests: 100,
      baseMaxRequests: 100,
    });

    const mockReq = {
      ip: "127.0.0.1",
      method: "GET",
      path: "/api/test",
    } as Request;

    // Should work even if limits are adjusted based on memory
    const status = limiter.isLimited(mockReq);
    if (status.limited) return false;

    return true;
  }

  /**
   * Test: Custom key generator
   */
  static testCustomKeyGenerator(): boolean {
    const limiter = new RateLimiter({
      windowMs: 1000,
      maxRequests: 2,
      keyGenerator: (req: Request) => `${req.method}:${req.path}`,
    });

    const req1 = {
      ip: "192.168.1.1",
      method: "GET",
      path: "/api/users",
    } as Request;
    const req2 = {
      ip: "192.168.1.1",
      method: "POST",
      path: "/api/users",
    } as Request;

    // Different methods should have separate limits
    limiter.isLimited(req1);
    limiter.isLimited(req1);
    if (!limiter.isLimited(req1).limited) return false;

    // Different method should pass
    if (limiter.isLimited(req2).limited) return false;

    return true;
  }

  /**
   * Test: Request Queue
   */
  static testRequestQueue(): boolean {
    const queue = new RequestQueue(2);
    const stats = queue.getStats();

    if (stats.maxConcurrent !== 2) return false;
    if (stats.queueLength !== 0) return false;
    if (stats.processing !== 0) return false;

    return true;
  }
}

/**
 * Unit Tests for Security Utilities
 */
export class SecurityUtilityTests {
  /**
   * Test: Input sanitization
   */
  static testInputSanitization(): boolean {
    const { InputValidator } = require("../../lib/security");

    // Test string sanitization
    let result = InputValidator.sanitizeString("  hello world  ");
    if (result !== "hello world") return false;

    // Test max length
    result = InputValidator.sanitizeString("a".repeat(1000), {
      maxLength: 100,
    });
    if (result.length !== 100) return false;

    // Test null byte removal
    result = InputValidator.sanitizeString("hello\x00world");
    if (result.includes("\x00")) return false;

    return true;
  }

  /**
   * Test: HTML sanitization
   */
  static testHtmlSanitization(): boolean {
    const { InputValidator } = require("../../lib/security");

    const result = InputValidator.sanitizeHtml('<script>alert("xss")</script>');
    if (result.includes("<script>") || result.includes("</script>"))
      return false;

    return true;
  }

  /**
   * Test: Email validation
   */
  static testEmailValidation(): boolean {
    const { InputValidator } = require("../../lib/security");

    if (!InputValidator.validateEmail("test@example.com")) return false;
    if (InputValidator.validateEmail("invalid-email")) return false;
    if (InputValidator.validateEmail("")) return false;

    return true;
  }

  /**
   * Test: URL validation
   */
  static testUrlValidation(): boolean {
    const { InputValidator } = require("../../lib/security");

    if (!InputValidator.validateUrl("https://example.com")) return false;
    if (InputValidator.validateUrl("not-a-url")) return false;

    return true;
  }

  /**
   * Test: Input validation against schema
   */
  static testInputValidation(): boolean {
    const { InputValidator } = require("../../lib/security");

    const schema = {
      name: {
        type: "string",
        required: true,
        minLength: 1,
        maxLength: 100,
      },
      age: {
        type: "number",
        min: 0,
        max: 150,
      },
    };

    // Valid data
    let result = InputValidator.validate({ name: "John", age: 30 }, schema);
    if (!result.valid) return false;

    // Missing required field
    result = InputValidator.validate({ age: 30 }, schema);
    if (result.valid) return false;

    // Invalid type
    result = InputValidator.validate({ name: "John", age: "thirty" }, schema);
    if (result.valid) return false;

    // Out of range
    result = InputValidator.validate({ name: "John", age: 200 }, schema);
    if (result.valid) return false;

    return true;
  }

  /**
   * Test: API Key generation
   */
  static testApiKeyGeneration(): boolean {
    const { apiKeyManager } = require("../../lib/security");

    const { key, secret } = apiKeyManager.generateKey(
      "test-key",
      ["read", "write"],
      100,
    );

    if (!key.startsWith("sk_")) return false;
    if (secret.length !== 64) return false; // 32 bytes as hex

    return true;
  }

  /**
   * Test: API Key verification
   */
  static testApiKeyVerification(): boolean {
    const { apiKeyManager } = require("../../lib/security");

    const { key, secret } = apiKeyManager.generateKey("test-key");

    // Correct secret should verify
    let verified = apiKeyManager.verify(key, secret);
    if (!verified) return false;

    // Wrong secret should fail
    verified = apiKeyManager.verify(key, "wrong-secret");
    if (verified) return false;

    return true;
  }

  /**
   * Test: API Key revocation
   */
  static testApiKeyRevocation(): boolean {
    const { apiKeyManager } = require("../../lib/security");

    const { key, secret } = apiKeyManager.generateKey("test-key");

    // Should work before revocation
    if (!apiKeyManager.verify(key, secret)) return false;

    // Revoke key
    apiKeyManager.revoke(key);

    // Should fail after revocation
    if (apiKeyManager.verify(key, secret)) return false;

    return true;
  }
}

/**
 * Unit Tests for Monitoring
 */
export class MonitoringTests {
  /**
   * Test: Logger basic logging
   */
  static testLoggerBasicLogging(): boolean {
    const { Logger, LogLevel, EventType } = require("../../lib/api-monitoring");

    const logger = new Logger();
    const entry = logger.log(LogLevel.INFO, EventType.REQUEST, "Test request", {
      method: "GET",
      path: "/api/test",
    });

    if (!entry.id) return false;
    if (entry.level !== LogLevel.INFO) return false;
    if (entry.message !== "Test request") return false;

    return true;
  }

  /**
   * Test: Logger query
   */
  static testLoggerQuery(): boolean {
    const { Logger, LogLevel, EventType } = require("../../lib/api-monitoring");

    const logger = new Logger();

    // Add different types of logs
    logger.log(LogLevel.INFO, EventType.REQUEST, "Request 1");
    logger.log(LogLevel.ERROR, EventType.ERROR, "Error 1");
    logger.log(LogLevel.INFO, EventType.REQUEST, "Request 2");

    // Query by level
    const errors = logger.query({ level: LogLevel.ERROR });
    if (errors.length !== 1) return false;

    // Query by event type
    const requests = logger.query({ eventType: EventType.REQUEST });
    if (requests.length !== 2) return false;

    return true;
  }

  /**
   * Test: Monitor metrics collection
   */
  static testMonitorMetrics(): boolean {
    const {
      Logger,
      Monitor,
      EventType,
      LogLevel,
    } = require("../../lib/api-monitoring");

    const logger = new Logger();
    const monitor = new Monitor(logger);

    const metrics = monitor.getMetrics();

    if (metrics.requestCount === undefined) return false;
    if (metrics.avgResponseTime === undefined) return false;
    if (!metrics.statusCodes) return false;

    monitor.stop();
    return true;
  }

  /**
   * Test: Security alerts
   */
  static testSecurityAlerts(): boolean {
    const { Logger, Monitor } = require("../../lib/api-monitoring");

    const logger = new Logger();
    const monitor = new Monitor(logger);

    const alert = monitor.recordSecurityEvent(
      "BRUTE_FORCE",
      "192.168.1.1",
      "/api/login",
      "HIGH",
      "Suspected brute force attack",
    );

    if (!alert.id) return false;
    if (alert.type !== "BRUTE_FORCE") return false;
    if (alert.severity !== "HIGH") return false;

    const alerts = monitor.getAlerts();
    if (alerts.length !== 1) return false;

    monitor.stop();
    return true;
  }
}

/**
 * Run all unit tests
 */
export function runAllUnitTests(): {
  passed: number;
  failed: number;
  tests: Array<{ name: string; passed: boolean; error?: string }>;
} {
  const results: Array<{ name: string; passed: boolean; error?: string }> = [];

  const testClasses = [RateLimiterTests, SecurityUtilityTests, MonitoringTests];

  testClasses.forEach((testClass) => {
    const methods = Object.getOwnPropertyNames(testClass).filter((m) =>
      m.startsWith("test"),
    );

    methods.forEach((method) => {
      try {
        const result = (testClass as any)[method]();
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
    });
  });

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return { passed, failed, tests: results };
}
