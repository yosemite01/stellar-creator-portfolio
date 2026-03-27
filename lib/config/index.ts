import { serverEnvSchema, clientEnvSchema } from './env'

// ── Parse once at module load ────────────────────────────────────────────────

function parseServerEnv() {
  const result = serverEnvSchema.safeParse(process.env)
  if (!result.success) {
    throw new Error(
      `[config] Server env parse failed:\n${result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    )
  }
  return result.data
}

function parseClientEnv() {
  const result = clientEnvSchema.safeParse(process.env)
  if (!result.success) {
    throw new Error(
      `[config] Client env parse failed:\n${result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    )
  }
  return result.data
}

let _server: ReturnType<typeof parseServerEnv> | null = null
let _client: ReturnType<typeof parseClientEnv> | null = null

function getServerEnv() {
  if (!_server) _server = parseServerEnv()
  return _server
}

function getClientEnv() {
  if (!_client) _client = parseClientEnv()
  return _client
}

// ── Server config (domain-grouped) ──────────────────────────────────────────

export const serverConfig = {
  get auth() {
    const env = getServerEnv()
    return {
      nextAuthUrl: env.NEXTAUTH_URL,
      nextAuthSecret: env.NEXTAUTH_SECRET,
      githubId: env.GITHUB_ID,
      githubSecret: env.GITHUB_SECRET,
    }
  },

  get db() {
    const env = getServerEnv()
    return {
      databaseUrl: env.DATABASE_URL,
      supabaseUrl: env.SUPABASE_URL,
      supabaseAnonKey: env.SUPABASE_ANON_KEY,
    }
  },

  get cache() {
    const env = getServerEnv()
    return {
      redisUrl: env.REDIS_URL,
    }
  },

  get email() {
    const env = getServerEnv()
    return {
      server: env.EMAIL_SERVER,
      from: env.EMAIL_FROM,
      devUser: env.EMAIL_DEV_USER,
      devPass: env.EMAIL_DEV_PASS,
    }
  },

  get storage() {
    const env = getServerEnv()
    return {
      provider: env.STORAGE_PROVIDER,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL,
      signedUrlTtlSeconds: env.SIGNED_URL_TTL_SECONDS,
    }
  },

  get stripe() {
    const env = getServerEnv()
    return {
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    }
  },

  get stellar() {
    const env = getServerEnv()
    return {
      network: env.STELLAR_NETWORK,
      rpcUrl: env.STELLAR_RPC_URL,
      horizonUrl: env.STELLAR_HORIZON_URL,
      bountyContractId: env.BOUNTY_CONTRACT_ID,
      escrowContractId: env.ESCROW_CONTRACT_ID,
      freelancerContractId: env.FREELANCER_CONTRACT_ID,
      governanceContractId: env.GOVERNANCE_CONTRACT_ID,
    }
  },

  get upload() {
    const env = getServerEnv()
    return {
      maxSizeMb: env.MAX_UPLOAD_SIZE_MB,
      allowedFileTypes: env.ALLOWED_FILE_TYPES,
    }
  },

  get analytics() {
    const env = getServerEnv()
    return {
      plausibleApiKey: env.PLAUSIBLE_API_KEY,
      adminDashboardToken: env.ADMIN_DASHBOARD_TOKEN,
    }
  },

  get notifications() {
    const env = getServerEnv()
    return {
      bountyNotifyEmail: env.BOUNTY_NOTIFY_EMAIL,
    }
  },

  get app() {
    const env = getServerEnv()
    return {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
    }
  },
}

// ── Client config (NEXT_PUBLIC_* only) ──────────────────────────────────────

export const clientConfig = {
  get stripe() {
    const env = getClientEnv()
    return {
      publishableKey: env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      premiumMonthlyPriceId: env.NEXT_PUBLIC_STRIPE_PRICE_PREMIUM_MONTHLY,
    }
  },

  get analytics() {
    const env = getClientEnv()
    return {
      plausibleDomain: env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
      plausibleSrc: env.NEXT_PUBLIC_PLAUSIBLE_SRC,
      plausibleApi: env.NEXT_PUBLIC_PLAUSIBLE_API,
    }
  },

  get pwa() {
    const env = getClientEnv()
    return {
      vapidPublicKey: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    }
  },

  get upload() {
    const env = getClientEnv()
    return {
      maxSizeMb: env.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB,
    }
  },

  get app() {
    const env = getClientEnv()
    return {
      url: env.NEXT_PUBLIC_APP_URL,
    }
  },
}

export { validateConfig } from './validate'
