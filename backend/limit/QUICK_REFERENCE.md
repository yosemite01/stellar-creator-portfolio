# Developer Quick Reference

## 🚀 Start Development Server

```bash
npm run dev
```

## 🧪 Run Tests

```bash
npm test              # All tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests
npm run test:e2e      # E2E tests
```

## 📝 Code Quality

```bash
npm run lint          # Check for issues
npm run format        # Auto-format code
npm run build         # Compile TypeScript
```

---

## 🔐 Basic Setup

### 1. Create Secure App

```typescript
import { createSecureApp, setupExampleRoutes } from "./app/api/middleware";

const { app, stack } = createSecureApp({
  rateLimit: { enabled: true, maxRequests: 100 },
  cors: { enabled: true },
  authentication: { enabled: true },
  monitoring: { enabled: true },
});

setupExampleRoutes(stack);
app.listen(3000);
```

### 2. Create Protected Route

```typescript
stack.createRoute(
  "/api/protected",
  "post",
  async (req, res) => {
    res.json({ success: true });
  },
  {
    validation: {
      name: { type: "string", required: true },
      email: { type: "string", required: true },
    },
    rateLimit: { maxRequests: 50 },
  },
);
```

### 3. Generate API Key

```typescript
import { apiKeyManager } from "./lib/security";

const { key, secret } = apiKeyManager.generateKey("my-app", ["read", "write"]);
console.log(`Key: ${key}`);
console.log(`Secret: ${secret}`);
```

### 4. Use API Key

```bash
curl -H "X-API-Key: ${key}:${secret}" \
  https://api.example.com/api/protected
```

---

## 📊 Monitoring

### Get Metrics

```typescript
const monitoring = stack.getMonitoring();
const metrics = monitoring.monitor.getMetrics();

console.log({
  avgResponseTime: metrics.avgResponseTime,
  errorCount: metrics.errorCount,
  statusCodes: metrics.statusCodes,
});
```

### View Logs

```typescript
const logger = monitoring.logger;
const errors = logger.query({
  level: LogLevel.ERROR,
  limit: 100,
});
```

### Get Alerts

```typescript
const alerts = monitoring.monitor.getAlerts({
  severity: "HIGH",
  limit: 10,
});
```

---

## 🛡️ Input Validation

### Schema Definition

```typescript
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
```

### Validate Input

```typescript
const { InputValidator } = require("./lib/security");

const result = InputValidator.validate(req.body, schema);
if (!result.valid) {
  return res.status(400).json({ errors: result.errors });
}
```

---

## ⏱️ Rate Limiting

### Global Limit

```typescript
{
  rateLimit: {
    windowMs: 60000,      // 1 minute
    maxRequests: 100,     // 100 requests
    blockDurationMs: 300000, // 5 min block
  }
}
```

### Endpoint-Specific Limit

```typescript
const limiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 20,
  keyGenerator: (req) => `${req.method}:${req.path}:${req.ip}`,
});

app.post("/api/login", limiter.middleware(), handler);
```

### Skip Rate Limiting

```typescript
{
  rateLimit: {
    skip: (req) => req.path === '/health',
  }
}
```

---

## 🔍 Common Tasks

### Check Health

```bash
curl http://localhost:3000/health
```

### View Server Status

```bash
curl http://localhost:3000/status
```

### Access Metrics Dashboard

```bash
curl http://localhost:3000/dashboard/metrics
```

### View Recent Logs

```bash
curl "http://localhost:3000/dashboard/logs?limit=50"
```

---

## 🐛 Debugging

### Enable Debug Logging

```bash
DEBUG=* npm run dev
```

### Check Rate Limiter Stats

```typescript
const stats = rateLimiter.getStats();
console.log(`Active IPs: ${stats.totalKeys}`);
```

### View Store Contents

```typescript
console.log(rateLimiter.getStats().entries);
```

---

## 📋 Environment Variables

```env
NODE_ENV=production
PORT=3000
RATE_LIMIT_MAX_REQUESTS=100
CORS_ALLOWED_ORIGINS=https://app.example.com
AUTH_ENABLED=true
MONITORING_ENABLED=true
```

---

## 🚨 Common Issues

### Too Many 429 Responses

→ Increase `maxRequests` limit

### Requests Blocked Unexpectedly

→ Add to rate limit whitelist/skip list

### High Memory Usage

→ Reduce `LOG_MAX_SIZE` in config

### Slow Responses

→ Check P99 metrics and optimize bottlenecks

---

## 📚 Key Classes

| Class                | File                       | Purpose            |
| -------------------- | -------------------------- | ------------------ |
| `RateLimiter`        | `middleware/rate-limit.ts` | Rate limiting      |
| `InputValidator`     | `lib/security.ts`          | Input validation   |
| `ApiKeyManager`      | `lib/security.ts`          | API key management |
| `Logger`             | `lib/api-monitoring.ts`    | Request logging    |
| `Monitor`            | `lib/api-monitoring.ts`    | Metrics & alerts   |
| `ApiMiddlewareStack` | `app/api/middleware.ts`    | Unified middleware |

---

## 🔗 API Response Headers

| Header                  | Meaning              |
| ----------------------- | -------------------- |
| `X-RateLimit-Limit`     | Max requests allowed |
| `X-RateLimit-Remaining` | Remaining requests   |
| `X-RateLimit-Reset`     | When limit resets    |
| `Retry-After`           | When to retry (429)  |
| `X-Request-ID`          | Unique request ID    |

---

## 📞 Support

- See **README.md** for full documentation
- See **SECURITY_GUIDE.md** for security implementation
- See **IMPLEMENTATION_SUMMARY.md** for feature overview
- Run `npm test` to verify everything works

---

**Last Updated**: 2026-03-25
**Version**: 1.0.0
