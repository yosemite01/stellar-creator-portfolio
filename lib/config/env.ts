import { z } from 'zod'

// ── Server-only environment variables ────────────────────────────────────────

export const serverEnvSchema = z
  .object({
    // Auth
    NEXTAUTH_URL: z.string().url().default('http://localhost:3000'),
    NEXTAUTH_SECRET: z.string().min(1, 'NEXTAUTH_SECRET is required'),
    GITHUB_ID: z.string().optional(),
    GITHUB_SECRET: z.string().optional(),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
    SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),

    // Cache
    REDIS_URL: z.string().optional(),

    // Email
    EMAIL_SERVER: z.string().optional(),
    EMAIL_FROM: z.string().default('"Stellar Creators" <noreply@stellar-creators.com>'),
    EMAIL_DEV_USER: z.string().optional(),
    EMAIL_DEV_PASS: z.string().optional(),

    // Storage (S3 / R2)
    STORAGE_PROVIDER: z.enum(['s3', 'r2']).default('s3'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PUBLIC_BASE_URL: z.string().optional(),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

    // Stripe
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Stellar / Soroban
    STELLAR_NETWORK: z.enum(['testnet', 'futurenet', 'mainnet']).default('testnet'),
    STELLAR_RPC_URL: z.string().optional(),
    STELLAR_HORIZON_URL: z.string().optional(),
    BOUNTY_CONTRACT_ID: z.string().optional(),
    ESCROW_CONTRACT_ID: z.string().optional(),
    FREELANCER_CONTRACT_ID: z.string().optional(),
    GOVERNANCE_CONTRACT_ID: z.string().optional(),

    // Upload
    MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().default(100),
    ALLOWED_FILE_TYPES: z.string().optional(),

    // Analytics (server-only keys)
    PLAUSIBLE_API_KEY: z.string().optional(),
    ADMIN_DASHBOARD_TOKEN: z.string().optional(),

    // Notifications
    BOUNTY_NOTIFY_EMAIL: z.string().email().optional(),

    // App
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
  })
  .refine(
    (env) => {
      const s3Vars = [env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY]
      const anySet = s3Vars.some(Boolean)
      const allSet = s3Vars.every(Boolean)
      return !anySet || allSet
    },
    {
      message:
        'S3 configuration is incomplete — if any of S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY is set, all three are required',
      path: ['S3_BUCKET'],
    },
  )

export type ServerEnv = z.infer<typeof serverEnvSchema>

// ── Client-safe environment variables (NEXT_PUBLIC_*) ────────────────────────

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PRICE_PREMIUM_MONTHLY: z.string().optional(),
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: z.string().default('example.com'),
  NEXT_PUBLIC_PLAUSIBLE_SRC: z.string().default('https://plausible.io/js/plausible.js'),
  NEXT_PUBLIC_PLAUSIBLE_API: z.string().default('https://plausible.io/api/event'),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().default(100),
  NEXT_PUBLIC_APP_URL: z.string().default(''),
})

export type ClientEnv = z.infer<typeof clientEnvSchema>
