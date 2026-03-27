import { describe, it, expect, beforeEach } from 'vitest'
import { serverEnvSchema, clientEnvSchema } from '@/lib/config/env'

const VALID_SERVER_ENV = {
  NEXTAUTH_URL: 'http://localhost:3000',
  NEXTAUTH_SECRET: 'a-secret-at-least-1-char-long',
  DATABASE_URL: 'file:./dev.db',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
}

describe('serverEnvSchema', () => {
  it('parses valid required-only env', () => {
    const result = serverEnvSchema.safeParse(VALID_SERVER_ENV)
    expect(result.success).toBe(true)
  })

  it('applies defaults for optional fields', () => {
    const result = serverEnvSchema.safeParse(VALID_SERVER_ENV)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.NEXTAUTH_URL).toBe('http://localhost:3000')
    expect(result.data.NODE_ENV).toBe('development')
    expect(result.data.PORT).toBe(3000)
    expect(result.data.STORAGE_PROVIDER).toBe('s3')
    expect(result.data.S3_REGION).toBe('us-east-1')
    expect(result.data.SIGNED_URL_TTL_SECONDS).toBe(900)
    expect(result.data.STELLAR_NETWORK).toBe('testnet')
    expect(result.data.MAX_UPLOAD_SIZE_MB).toBe(100)
  })

  it('reports ALL missing required vars at once', () => {
    const result = serverEnvSchema.safeParse({})
    expect(result.success).toBe(false)
    if (result.success) return

    const paths = result.error.issues.map((i) => i.path[0])
    expect(paths).toContain('NEXTAUTH_SECRET')
    expect(paths).toContain('DATABASE_URL')
    expect(paths).toContain('SUPABASE_URL')
    expect(paths).toContain('SUPABASE_ANON_KEY')
  })

  it('allows optional vars to be absent', () => {
    const result = serverEnvSchema.safeParse(VALID_SERVER_ENV)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.REDIS_URL).toBeUndefined()
    expect(result.data.STRIPE_SECRET_KEY).toBeUndefined()
    expect(result.data.S3_BUCKET).toBeUndefined()
    expect(result.data.EMAIL_SERVER).toBeUndefined()
  })

  it('rejects partial S3 configuration', () => {
    const result = serverEnvSchema.safeParse({
      ...VALID_SERVER_ENV,
      S3_BUCKET: 'my-bucket',
      // Missing S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY
    })
    expect(result.success).toBe(false)
    if (result.success) return

    const s3Issue = result.error.issues.find((i) => i.path.includes('S3_BUCKET'))
    expect(s3Issue).toBeDefined()
    expect(s3Issue!.message).toContain('S3 configuration is incomplete')
  })

  it('accepts complete S3 configuration', () => {
    const result = serverEnvSchema.safeParse({
      ...VALID_SERVER_ENV,
      S3_BUCKET: 'my-bucket',
      S3_ACCESS_KEY_ID: 'AKID123',
      S3_SECRET_ACCESS_KEY: 'secret123',
    })
    expect(result.success).toBe(true)
  })

  it('coerces numeric string env vars', () => {
    const result = serverEnvSchema.safeParse({
      ...VALID_SERVER_ENV,
      PORT: '8080',
      SIGNED_URL_TTL_SECONDS: '1800',
      MAX_UPLOAD_SIZE_MB: '50',
    })
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.PORT).toBe(8080)
    expect(result.data.SIGNED_URL_TTL_SECONDS).toBe(1800)
    expect(result.data.MAX_UPLOAD_SIZE_MB).toBe(50)
  })
})

describe('clientEnvSchema', () => {
  it('parses empty env with defaults', () => {
    const result = clientEnvSchema.safeParse({})
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.NEXT_PUBLIC_PLAUSIBLE_DOMAIN).toBe('example.com')
    expect(result.data.NEXT_PUBLIC_PLAUSIBLE_SRC).toBe('https://plausible.io/js/plausible.js')
    expect(result.data.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB).toBe(100)
    expect(result.data.NEXT_PUBLIC_APP_URL).toBe('')
  })

  it('allows all client vars to be optional', () => {
    const result = clientEnvSchema.safeParse({})
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBeUndefined()
    expect(result.data.NEXT_PUBLIC_VAPID_PUBLIC_KEY).toBeUndefined()
  })

  it('accepts custom values', () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
      NEXT_PUBLIC_PLAUSIBLE_DOMAIN: 'mysite.com',
      NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB: '50',
    })
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe('pk_test_123')
    expect(result.data.NEXT_PUBLIC_PLAUSIBLE_DOMAIN).toBe('mysite.com')
    expect(result.data.NEXT_PUBLIC_MAX_UPLOAD_SIZE_MB).toBe(50)
  })
})
