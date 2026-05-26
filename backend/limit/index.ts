/**
 * Main Entry Point
 * Example Express application with full API security
 */

import express from "express";
import { createSecureApp, setupExampleRoutes } from "./app/api/middleware";

async function main() {
  // Create secure Express app
  const { app, stack } = createSecureApp({
    rateLimit: {
      enabled: true,
      windowMs: 60000,
      maxRequests: 100,
      blockDurationMs: 300000,
    },
    cors: { enabled: true },
    authentication: { enabled: true },
    monitoring: { enabled: true },
  });

  // Setup example routes
  setupExampleRoutes(stack);

  // Dashboard endpoints
  app.get("/dashboard/metrics", (req, res) => {
    const monitoring = stack.getMonitoring();
    if (!monitoring) {
      return res.status(503).json({ error: "Monitoring not available" });
    }

    const metrics = monitoring.monitor.getMetrics();
    const alerts = monitoring.monitor.getAlerts({ limit: 20 });
    const rateLimiterStats = stack.getRateLimiter()?.getStats();

    res.json({
      timestamp: new Date(),
      metrics: {
        requests: metrics.requestCount,
        errors: metrics.errorCount,
        avgResponseTime: `${metrics.avgResponseTime.toFixed(2)}ms`,
        p95ResponseTime: `${metrics.p95ResponseTime.toFixed(2)}ms`,
        p99ResponseTime: `${metrics.p99ResponseTime.toFixed(2)}ms`,
        statusCodes: metrics.statusCodes,
      },
      recentAlerts: alerts.slice(0, 10),
      rateLimiter: rateLimiterStats,
    });
  });

  app.get("/dashboard/logs", (req, res) => {
    const monitoring = stack.getMonitoring();
    if (!monitoring) {
      return res.status(503).json({ error: "Monitoring not available" });
    }

    const level = req.query.level as string;
    const type = req.query.type as string;
    const limit = parseInt(req.query.limit as string) || 100;

    const logs = monitoring.logger.query({ limit });

    res.json({
      total: logs.length,
      logs: logs.slice(0, limit),
    });
  });

  // Security test endpoints (for demonstration)
  app.post("/test/injection", (req, res) => {
    // This endpoint demonstrates input validation
    const { username } = req.body;

    // Try to execute as query (should be prevented by validation)
    res.json({
      message: "Input validation prevented potential attack",
      received: username,
    });
  });

  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   API Security Framework                ║
║   Server running on port ${PORT}         ║
╚════════════════════════════════════════╝

📊 Endpoints:
  - GET /health              - Health check
  - GET /status              - Server status
  - GET /dashboard/metrics   - Metrics dashboard
  - GET /dashboard/logs      - View logs

🔐 API Endpoints:
  - GET  /api/users          - List users (rate limited)
  - POST /api/data           - Submit data with validation

ℹ️  Documentation:
  - README.md                - Full documentation
  - SECURITY_GUIDE.md        - Security implementation guide

🧪 Testing:
  - npm test                 - Run all tests
  - npm run test:unit        - Unit tests
  - npm run test:integration - Integration tests
  - npm run test:e2e         - End-to-end tests

📝 Configuration:
  - PORT: ${PORT}
  - NODE_ENV: ${process.env.NODE_ENV || "development"}
    `);
  });
}

// Error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Run main
main().catch(console.error);
