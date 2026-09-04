# API Security & Rate Limiting Framework

Enterprise-grade API security middleware for Express.js with comprehensive rate limiting, authentication, input validation, monitoring, and DDoS protection.

**This is a standalone sub-project** (its own `package.json`/`tsconfig.json`,
independent of the root Next.js app and the Rust `backend/`) — every
command below (`npm install`, `npm test`, etc.) must be run from inside
`backend/limit/`, not the repo root.

## 🎯 Features

### Security

- ✅ **Rate Limiting** - Sliding window algorithm with DDoS protection
- ✅ **API Key Authentication** - Generate, verify, and manage API keys
- ✅ **Input Validation & Sanitization** - Prevent injection attacks (SQL, XSS)
- ✅ **CORS Management** - Configure allowed origins and methods
- ✅ **Security Headers** - CSP, HSTS, X-Frame-Options, etc.
- ✅ **Request Throttling** - Smart queuing system for concurrent requests
- ✅ **Adaptive Rate Limiting** - Dynamic limits based on server load

### Monitoring & Logging

- 📊 **Real-time Metrics** - Request count, response times, error rates
- 🔍 **Security Logging** - Track all security events and anomalies
- 🚨 **Anomaly Detection** - Automatic alerts for suspicious patterns
- 📈 **Performance Metrics** - P95/P99 response times, status code tracking
- 📝 **Structured Logging** - Query logs by level, type, time range

## 📦 Installation

```bash
npm install
```

## 🚀 Quick Start

### Basic Setup

```typescript
import express from "express";
import { createSecureApp, setupExampleRoutes } from "./app/api/middleware";

const { app, stack } = createSecureApp({
  rateLimit: {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100,
  },
  cors: { enabled: true },
  authentication: { enabled: true },
  monitoring: { enabled: true },
});

// Setup routes
setupExampleRoutes(stack);

// Start server
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
```

### Advanced Configuration

```typescript
const { app, stack } = createSecureApp({
  rateLimit: {
    enabled: true,
    windowMs: 60000, // 1 minute window
    maxRequests: 100, // 100 requests per window
    blockDurationMs: 300000, // 5 minute block
  },
  cors: {
    enabled: true,
    config: {
      allowedOrigins: ["https://app.example.com"],
      allowedMethods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
    },
  },
  authentication: { enabled: true },
  monitoring: { enabled: true, anomalyThreshold: 10 },
  compression: { enabled: true },
  trustedProxy: true,
});
```

## 🔐 API Key Authentication

### Generate API Keys

```typescript
import { apiKeyManager } from "./lib/security";

// Generate new API key
const { key, secret } = apiKeyManager.generateKey(
  "my-app", // name
  ["read", "write"], // permissions
  100, // rate limit
);

console.log(`Key: ${key}`);
console.log(`Secret: ${secret}`); // Store securely!
```

### Authenticate Requests

```typescript
// Using API key header
const response = await fetch("/api/endpoint", {
  headers: {
    "X-API-Key": `${key}:${secret}`,
  },
});
```

## ⏱️ Rate Limiting

### Global Rate Limiting

Applied to all requests automatically:

```typescript
rateLimit: {
  windowMs: 60000,        // Time window in ms
  maxRequests: 100,       // Max requests per window
  blockDurationMs: 300000 // Duration to block after limit
}
```

### Endpoint-Specific Rate Limiting

```typescript
import { RateLimiter } from "./middleware/rate-limit";

const loginLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 5, // Strict limit for login
});

app.post("/api/login", loginLimiter.middleware(), (req, res) => {
  // Handle login
});
```

### Custom Rate Limit Keys

```typescript
const limiter = new RateLimiter({
  keyGenerator: (req) => {
    // Rate limit by user ID instead of IP
    return `user:${req.user.id}`;
  },
});
```

## 🛡️ Input Validation

### Schema Validation

```typescript
import { InputValidator } from "./lib/security";

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
  name: {
    type: "string",
    minLength: 1,
    maxLength: 100,
  },
};

const result = InputValidator.validate(req.body, schema);

if (!result.valid) {
  return res.status(400).json({ errors: result.errors });
}
```

### Use in Routes

```typescript
stack.createRoute(
  "/api/users",
  "post",
  async (req, res) => {
    res.json({ success: true, user: req.body });
  },
  {
    validation: {
      name: { type: "string", required: true, maxLength: 100 },
      email: { type: "string", required: true },
    },
    rateLimit: { windowMs: 60000, maxRequests: 20 },
  },
);
```

## 📊 Monitoring & Metrics

### Access Metrics

```typescript
const { stack } = createSecureApp();

// Get real-time metrics
const monitoring = stack.getMonitoring();
const metrics = monitoring.monitor.getMetrics();

console.log({
  requestCount: metrics.requestCount,
  avgResponseTime: metrics.avgResponseTime,
  maxResponseTime: metrics.maxResponseTime,
  p95ResponseTime: metrics.p95ResponseTime,
  p99ResponseTime: metrics.p99ResponseTime,
  statusCodes: metrics.statusCodes,
  errorRates: metrics.errorRates,
});
```

### Security Alerts

```typescript
// Get recent alerts
const alerts = monitoring.monitor.getAlerts({
  type: "BRUTE_FORCE",
  severity: "HIGH",
  limit: 10,
});

alerts.forEach((alert) => {
  console.log(`[${alert.severity}] ${alert.type}: ${alert.description}`);
});
```

### Logger Access

```typescript
const logger = monitoring.logger;

// Query logs
const errors = logger.query({
  level: LogLevel.ERROR,
  startTime: new Date(Date.now() - 3600000), // Last hour
  limit: 100,
});

errors.forEach((log) => {
  console.log(`${log.timestamp} - ${log.message}`);
});
```

## 🧪 Testing

Tests use a small hand-rolled runner (`tests/runner.ts`), not Jest/vitest.

### Run All Tests

```bash
npm test
```

This runs `tests/runner.ts`, which imports and runs all three suites below
directly (`tests/unit/rate-limit.test.ts`,
`tests/integration/security.test.ts`, `tests/e2e/api-abuse.test.ts`) and
prints a combined pass/fail summary.

**`npm run test:unit` / `test:integration` / `test:e2e` / `test:security`
are declared in `package.json` but currently broken** — they point at
`tests/unit/runner.ts`, `tests/integration/runner.ts`, `tests/e2e/runner.ts`,
and `tests/security/runner.ts`, none of which exist (only the combined
`tests/runner.ts` does, and there is no `tests/security/` directory at
all). Use plain `npm test` until those are added or the scripts are fixed
to point at the right files.

### Test Coverage

- `tests/unit/rate-limit.test.ts` — rate limiting logic, sliding window algorithm
- `tests/integration/security.test.ts` — middleware stack integration, CORS enforcement, security headers
- `tests/e2e/api-abuse.test.ts` — DDoS/rate-limit-bypass/attack-scenario simulation

## 📋 Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configure:

```env
NODE_ENV=production
PORT=3000

RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

CORS_ENABLED=true
CORS_ALLOWED_ORIGINS=https://app.example.com

AUTH_ENABLED=true
MONITORING_ENABLED=true
```

## 🏗️ Project Structure

```
backend/limit/
├── middleware/
│   └── rate-limit.ts          # Rate limiting implementation
├── lib/
│   ├── security.ts            # Auth, validation, CORS, headers
│   └── api-monitoring.ts      # Logging and monitoring
├── app/
│   └── api/
│       └── middleware.ts      # Unified middleware configuration (createSecureApp)
├── routes/
│   └── estimate.ts
├── tests/
│   ├── runner.ts               # The only working test entry point (npm test)
│   ├── unit/rate-limit.test.ts
│   ├── integration/security.test.ts
│   └── e2e/api-abuse.test.ts
├── index.ts
├── endpoints.ts
├── setup.sh
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## 🔍 Security Features

### Rate Limiting

- Sliding window algorithm
- Per-IP, per-API-key, per-endpoint limiting
- DDoS protection with automatic blocking
- Configurable block duration

### Authentication

- API key generation and management
- Secure secret hashing (SHA-256)
- Key expiration support
- Permission-based access control

### Input Protection

- String sanitization (control character removal)
- HTML escaping (XSS prevention)
- Pattern-based validation
- Schema validation

### HTTP Security

- CORS configuration
- Content Security Policy (CSP)
- Strict Transport Security (HSTS)
- X-Frame-Options (clickjacking prevention)
- X-XSS-Protection header
- X-Content-Type-Options (MIME sniffing prevention)

### Monitoring

- Real-time request tracking
- Performance metrics (P95, P99)
- Error rate monitoring
- Anomaly detection
- Security event logging

## 📈 Performance Characteristics

The specific numbers previously here (sub-millisecond per-request overhead,
10,000+ req/s, <2% CPU) have no benchmark in this directory backing them —
there's no load-test script or recorded result to point to. Until a real
benchmark exists, treat this middleware's overhead as unmeasured rather
than quoting a number nothing here can reproduce.

## 🚨 Attack Prevention

### Protected Against

- ✅ DDoS attacks (rate limiting + blocking)
- ✅ SQL injection (input sanitization)
- ✅ Cross-site scripting (HTML escaping)
- ✅ Brute force attacks (excessive attempt detection)
- ✅ CORS attacks (origin validation)
- ✅ Clickjacking (X-Frame-Options)
- ✅ MIME sniffing (Content-Type headers)
- ✅ Session fixation (secure headers)

## 📚 API Reference

### RateLimiter Class

```typescript
class RateLimiter {
  isLimited(req: Request): {
    limited: boolean;
    remaining: number;
    reset: number;
  };
  reset(key?: string): void;
  middleware(): (req, res, next) => void;
  getStats(): { totalKeys: number; config; entries };
}
```

### InputValidator Class

```typescript
class InputValidator {
  static sanitizeString(input: string, options?): string;
  static sanitizeHtml(input: string): string;
  static validate(
    data: any,
    schema: ValidationSchema,
  ): { valid: boolean; errors: string[] };
}
```

### Monitor Class

```typescript
class Monitor {
  recordRequest(req: Request, startTime: number): void;
  recordResponse(req, res, statusCode, startTime): void;
  getMetrics(): MetricSnapshot;
  getAlerts(options?): SecurityAlert[];
}
```

## 🎓 Examples

### Complete Express App

See `app/api/middleware.ts` for comprehensive examples including:

- Health check endpoint
- Status endpoint with metrics
- Protected API endpoints
- Input validation
- Error handling

### Custom Middleware

```typescript
import { RateLimiter } from "./middleware/rate-limit";

const premiumLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 1000,
  keyGenerator: (req) => `premium:${req.user.id}`,
});

app.get("/api/premium", premiumLimiter.middleware(), (req, res) => {
  res.json({ data: "premium content" });
});
```

## 🔧 Troubleshooting

### Too Many False Positives in Rate Limiting

Increase `maxRequests`:

```typescript
rateLimit: {
  maxRequests: 200;
}
```

### Legitimate Requests Being Blocked

Whitelist specific paths:

```typescript
rateLimit: {
  skip: (req) => req.path === "/health";
}
```

### High Monitoring Overhead

Reduce logging verbosity:

```typescript
const logger = new Logger(5000); // Keep only 5000 logs
```

## 📞 Support

For issues, feature requests, or questions, please refer to the documentation or open an issue.

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please ensure all tests pass before submitting PRs.

```bash
npm run lint    # Lint code
npm run format  # Format code
npm test        # Run tests
```
