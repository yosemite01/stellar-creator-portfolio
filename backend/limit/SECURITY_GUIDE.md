# Security Implementation Guide

## Overview

This guide provides detailed instructions for implementing and operating the API Security & Rate Limiting Framework.

## Table of Contents

1. [Deployment](#deployment)
2. [Security Configuration](#security-configuration)
3. [Rate Limiting Strategy](#rate-limiting-strategy)
4. [Monitoring & Alerts](#monitoring--alerts)
5. [Incident Response](#incident-response)
6. [Best Practices](#best-practices)

## Deployment

### Production Setup

```typescript
const { app, stack } = createSecureApp({
  rateLimit: {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100,
    blockDurationMs: 300000,
  },
  cors: {
    enabled: true,
    config: {
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || [],
      credentials: true,
    },
  },
  authentication: { enabled: true },
  monitoring: { enabled: true },
  trustedProxy: true,
});

app.listen(process.env.PORT || 3000);
```

### Environment Configuration

Set these in production:

```env
NODE_ENV=production
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
CORS_ALLOWED_ORIGINS=https://app.example.com,https://api.example.com
AUTH_ENABLED=true
MONITORING_ENABLED=true
TRUST_PROXY=true
```

## Security Configuration

### CORS Policy

```typescript
const corsConfig = {
  allowedOrigins: ["https://app.example.com", "https://www.example.com"],
  allowedMethods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  credentials: true,
  maxAge: 86400, // 24 hours
};

app.use(corsMiddleware(corsConfig));
```

### API Key Management

**Generating Keys:**

```typescript
const { key, secret } = apiKeyManager.generateKey(
  "partner-name",
  ["read", "write", "delete"],
  500, // rate limit
);

// Store key and secret securely
// Share only secret with client
// Keep key for internal reference
```

**Key Permissions:**

- `read` - GET requests
- `write` - POST, PUT, PATCH requests
- `delete` - DELETE requests
- `admin` - All operations + admin endpoints

### Input Validation Schema

```typescript
const userSchema = {
  name: {
    type: "string",
    required: true,
    minLength: 2,
    maxLength: 100,
    pattern: /^[a-zA-Z\s'-]+$/,
  },
  email: {
    type: "string",
    required: true,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  age: {
    type: "number",
    min: 18,
    max: 120,
  },
};

stack.createRoute("/api/users", "post", handler, {
  validation: userSchema,
});
```

## Rate Limiting Strategy

### Tiered Rate Limiting

```typescript
// Public API - standard limits
const publicLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 100,
});

// Premium API - higher limits
const premiumLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 1000,
  keyGenerator: (req) => `premium:${req.apiKey?.key}`,
});

// Admin API - strictest
const adminLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 50,
});
```

### Endpoint-Specific Limits

```typescript
// Authentication endpoints: very strict
const loginLimiter = new RateLimiter({
  windowMs: 900000, // 15 minutes
  maxRequests: 5,
  blockDurationMs: 3600000, // 1 hour block
});

// Data endpoints: moderate
const dataLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 100,
});

// Public endpoints: relaxed
const publicLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 500,
});
```

## Monitoring & Alerts

### Setting Up Alerts

```typescript
const monitoring = stack.getMonitoring();

// Check for anomalies every minute
setInterval(() => {
  const alerts = monitoring.monitor.detectAnomalies(15);

  alerts.forEach((alert) => {
    if (alert.severity === "CRITICAL") {
      // Send to incident response
      notifyOncall(alert);
    } else if (alert.severity === "HIGH") {
      // Log for review
      logAlert(alert);
    }
  });
}, 60000);
```

### Metrics Dashboard

```typescript
app.get("/admin/metrics", (req, res) => {
  const monitoring = stack.getMonitoring();
  const metrics = monitoring.monitor.getMetrics();
  const alerts = monitoring.monitor.getAlerts({ limit: 100 });

  res.json({
    metrics,
    recentAlerts: alerts,
    summary: {
      requestCount: metrics.requestCount,
      errorRate:
        ((metrics.errorCount / metrics.requestCount) * 100).toFixed(2) + "%",
      avgResponseTime: metrics.avgResponseTime.toFixed(2) + "ms",
      p99ResponseTime: metrics.p99ResponseTime.toFixed(2) + "ms",
    },
  });
});
```

### Alert Types

1. **BRUTE_FORCE** (HIGH/CRITICAL)
   - Multiple failed login attempts
   - Action: Block IP, notify user
   - Recovery: 1-24 hours

2. **DDOS** (CRITICAL)
   - Sudden spike in requests
   - Action: Enable rate limiting, block source
   - Recovery: Manual review

3. **INJECTION_ATTACK** (HIGH)
   - Detected SQL/XSS attempt
   - Action: Block request, log attempt
   - Recovery: Automatic

4. **SUSPICIOUS_PATTERN** (MEDIUM/HIGH)
   - Unusual access patterns
   - Action: Monitor, escalate if continues
   - Recovery: Varies

## Incident Response

### Attack Detection Response

```typescript
async function handleSecurityAlert(alert) {
  switch (alert.type) {
    case "BRUTE_FORCE":
      // Block IP for N hours
      await blockIp(alert.sourceIp, 3600000);
      break;

    case "DDOS":
      // Enable aggressive rate limiting
      await enableDdosMode();
      // Notify security team
      await notifySecurity(alert);
      break;

    case "INJECTION_ATTACK":
      // Log for forensics
      await logForensics(alert);
      break;
  }
}
```

### Escalation Path

```
Severity: LOW
↓ Log and monitor

Severity: MEDIUM
↓ Alert on-call, log to security

Severity: HIGH
↓ Wake on-call, activate incident response

Severity: CRITICAL
↓ Page all security team, activate war room
```

## Best Practices

### 1. API Key Rotation

```typescript
// Rotate quarterly
async function rotateApiKeys() {
  const oldKeys = await getKeysOlderThan(90 * 24 * 60 * 60 * 1000);

  oldKeys.forEach((key) => {
    // Notify user of upcoming rotation
    notifyUser(key.userId, "Your API key will expire in 30 days");

    // After 30 days
    setTimeout(
      () => {
        apiKeyManager.revoke(key.key);
      },
      30 * 24 * 60 * 60 * 1000,
    );
  });
}
```

### 2. Rate Limit Tuning

Monitor and adjust based on real usage:

```typescript
// Weekly review
async function reviewRateLimits() {
  const metrics = monitor.getMetrics();

  const busyEndpoints = Object.entries(metrics.errorRates)
    .filter(([_, rate]) => rate > 0.1) // > 10% errors
    .map(([endpoint, _]) => endpoint);

  // Increase limits for legitimate heavy users
  busyEndpoints.forEach((endpoint) => {
    const limiter = getLimiterForEndpoint(endpoint);
    if (limiter) {
      limiter.config.maxRequests *= 1.2; // Increase by 20%
    }
  });
}
```

### 3. Logging Strategy

```typescript
// Log events to centralized system
const logger = monitoring.logger;

logger.subscribe((log) => {
  if (log.level === LogLevel.ERROR || log.level === LogLevel.CRITICAL) {
    // Send to error tracking (Sentry, etc.)
    errorTracker.captureException({
      level: log.level,
      message: log.message,
      context: log.metadata,
    });
  }
});
```

### 4. Performance Optimization

```typescript
// Pre-allocate resources
const rateLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 10000,
});

// Run cleanup periodically
setInterval(() => {
  const cleaned = logger.clearOldLogs(3600000); // 1 hour
  console.log(`Cleaned ${cleaned} old logs`);
}, 300000);
```

### 5. Security Headers Hardening

```typescript
// Stricter CSP for sensitive endpoints
app.use("/admin/*", (req, res, next) => {
  res.set(
    "Content-Security-Policy",
    `
    default-src 'self';
    script-src 'self';
    style-src 'self';
    img-src 'self' data:;
    font-src 'self';
  `.replace(/\n/g, ""),
  );
  next();
});
```

### 6. Whitelist Trusted IPs

```typescript
const trustedIps = ["10.0.0.1", "10.0.0.2"];

const limiter = new RateLimiter({
  skip: (req) => trustedIps.includes(req.ip),
});
```

### 7. Graceful Degradation

```typescript
// Under extreme load, reduce feature set
const cpuUsage = os.loadavg()[0];

if (cpuUsage > 5) {
  // Disable heavy features
  monitoring.enabled = false;
  compression.enabled = false;
}
```

## Compliance & Testing

### Security Testing Checklist

- [ ] Rate limiting prevents abuse
- [ ] SQL injection attempts blocked
- [ ] XSS attempts sanitized
- [ ] CORS policy enforced
- [ ] Security headers present
- [ ] API keys properly secured
- [ ] Logs contain sensitive data (PII) redaction
- [ ] Performance under load maintained

### Regular Audits

```bash
# Weekly
npm test:security

# Monthly
npm audit

# Quarterly
penetration-testing-suite.sh
```

This framework provides enterprise-grade security. Always keep dependencies updated and conduct regular security reviews.
