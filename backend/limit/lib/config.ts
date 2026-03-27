/**
 * Centralized configuration for the rate-limiter / API security service.
 * All environment variables are read here with defaults.
 */

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key]
  if (v === undefined) return fallback
  return v === '1' || v.toLowerCase() === 'true'
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]
  if (!v) return fallback
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: envInt('PORT', 3000),

  rateLimit: {
    enabled: envBool('RATE_LIMIT_ENABLED', true),
    windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),
    maxRequests: envInt('RATE_LIMIT_MAX_REQUESTS', 100),
    blockDurationMs: envInt('RATE_LIMIT_BLOCK_DURATION_MS', 300_000),
  },

  cors: {
    enabled: envBool('CORS_ENABLED', true),
    allowedOrigins: process.env.CORS_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) ?? [],
    credentials: envBool('CORS_CREDENTIALS', true),
  },

  auth: {
    enabled: envBool('AUTH_ENABLED', true),
    optional: envBool('AUTH_OPTIONAL', false),
  },

  monitoring: {
    enabled: envBool('MONITORING_ENABLED', true),
    anomalyThreshold: envInt('MONITORING_ANOMALY_THRESHOLD', 10),
  },

  security: {
    headersEnabled: envBool('SECURITY_HEADERS_ENABLED', true),
    compressionEnabled: envBool('COMPRESSION_ENABLED', true),
  },

  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    maxSize: envInt('LOG_MAX_SIZE', 10_000),
  },

  trustProxy: envBool('TRUST_PROXY', false),
  apiKeyExpirationDays: envInt('API_KEY_EXPIRATION_DAYS', 365),
} as const
