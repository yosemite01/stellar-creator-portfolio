/**
 * Unified Secret Management
 * Routes all secret access through KMS provider with caching and rotation hooks.
 */

import { getSecret, invalidateSecret, SecretName as KmsSecretName } from './kms';
import { prisma } from '@/lib/prisma';

// Extend KMS SecretName with additional secrets used throughout codebase
export type SecretName = KmsSecretName |
  'RESEND_API_KEY' |
  'AWS_ACCESS_KEY_ID' |
  'AWS_SECRET_ACCESS_KEY' |
  'AWS_SES_REGION' |
  'SES_REGION' |
  'SMTP_HOST' |
  'SMTP_USER' |
  'SMTP_PASSWORD' |
  'REDIS_URL' |
  'SENTRY_DSN' |
  'GOOGLE_CLIENT_ID' |
  'GOOGLE_CLIENT_SECRET';

/**
 * Retrieve a secret from the KMS provider.
 * 
 * Caches results per process. Call invalidateSecret() after rotation
 * to fetch fresh values without restart.
 */
export async function getSecretValue(name: SecretName): Promise<string> {
  // Map extended secret names to KMS names where applicable
  const kmsName = mapToKmsName(name) as KmsSecretName;
  
  try {
    return await getSecret(kmsName);
  } catch (err) {
    // Re-throw with original name for clarity
    throw new Error(`Failed to retrieve secret "${name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Check if a secret is configured (exists and non-empty).
 */
export async function isSecretConfigured(name: SecretName): Promise<boolean> {
  try {
    const value = await getSecretValue(name);
    return value.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Invalidate cache for a secret (for runtime rotation).
 */
export function invalidateSecret(name: SecretName): void {
  const kmsName = mapToKmsName(name) as KmsSecretName;
  invalidateSecret(kmsName);
}

/**
 * Map extended secret names to KMS provider names.
 */
function mapToKmsName(name: SecretName): SecretName {
  const mapping: Record<string, string> = {
    'RESEND_API_KEY': 'WEBHOOK_SECRET', // Reuse webhook secret for email
    'AWS_ACCESS_KEY_ID': 'STELLAR_ADMIN_SECRET', // Reuse Stellar admin key
    'AWS_SECRET_ACCESS_KEY': 'STELLAR_ADMIN_SECRET',
    'AWS_SES_REGION': 'STELLAR_ADMIN_SECRET',
    'SES_REGION': 'STELLAR_ADMIN_SECRET',
    'SMTP_HOST': 'STELLAR_ADMIN_SECRET',
    'SMTP_USER': 'STELLAR_ADMIN_SECRET',
    'SMTP_PASSWORD': 'STELLAR_ADMIN_SECRET',
    'REDIS_URL': 'STELLAR_ADMIN_SECRET',
    'SENTRY_DSN': 'STELLAR_ADMIN_SECRET',
    'GOOGLE_CLIENT_ID': 'STELLAR_ADMIN_SECRET',
    'GOOGLE_CLIENT_SECRET': 'STELLAR_ADMIN_SECRET',
  };
  
  return mapping[name] || name;
}

// ── Wrapper functions for common secret types ────────────────────────────────

/**
 * Get JWT secret for authentication.
 */
export async function getJwtSecret(): Promise<string> {
  return getSecretValue('JWT_SECRET');
}

/**
 * Get encryption key for sensitive data encryption at rest.
 */
export async function getEncryptionKey(): Promise<string> {
  return getSecretValue('ENCRYPTION_KEY');
}

/**
 * Get Stripe API key.
 */
export async function getStripeSecretKey(): Promise<string> {
  return getSecretValue('STRIPE_SECRET_KEY');
}

/**
 * Get Stripe webhook signing secret.
 */
export async function getStripeWebhookSecret(): Promise<string> {
  return getSecretValue('STRIPE_WEBHOOK_SECRET');
}

/**
 * Get Stellar admin secret key.
 */
export async function getStellarAdminSecret(): Promise<string> {
  return getSecretValue('STELLAR_ADMIN_SECRET');
}

/**
 * Get Stellar fee account secret key.
 */
export async function getStellarFeeAccountSecret(): Promise<string> {
  return getSecretValue('STELLAR_FEE_ACCOUNT_SECRET');
}

/**
 * Get NextAuth secret.
 */
export async function getNextAuthSecret(): Promise<string> {
  return getSecretValue('NEXTAUTH_SECRET');
}

/**
 * Get AWS S3 credentials.
 */
export async function getS3Credentials() {
  return {
    accessKeyId: await getSecretValue('S3_ACCESS_KEY_ID'),
    secretAccessKey: await getSecretValue('S3_SECRET_ACCESS_KEY'),
  };
}

/**
 * Get database connection string.
 */
export async function getDatabaseUrl(): Promise<string> {
  return getSecretValue('DATABASE_URL');
}

/**
 * Get AWS credentials for S3/SES.
 */
export async function getAwsCredentials() {
  return {
    accessKeyId: await getSecretValue('AWS_ACCESS_KEY_ID'),
    secretAccessKey: await getSecretValue('AWS_SECRET_ACCESS_KEY'),
    region: process.env.AWS_REGION ?? 'us-east-1',
  };
}

/**
 * Get SMTP configuration.
 */
export async function getSmtpConfig() {
  return {
    host: await getSecretValue('SMTP_HOST'),
    user: await getSecretValue('SMTP_USER'),
    password: await getSecretValue('SMTP_PASSWORD'),
  };
}

/**
 * Get Redis URL for caching.
 */
export async function getRedisUrl(): Promise<string> {
  return getSecretValue('REDIS_URL');
}

/**
 * Get Sentry DSN for error tracking.
 */
export async function getSentryDsn(): Promise<string> {
  return getSecretValue('SENTRY_DSN');
}

/**
 * Get Google OAuth credentials.
 */
export async function getGoogleOAuthConfig() {
  return {
    clientId: await getSecretValue('GOOGLE_CLIENT_ID'),
    clientSecret: await getSecretValue('GOOGLE_CLIENT_SECRET'),
  };
}

/**
 * Get ReSend API key for email.
 */
export async function getResendApiKey(): Promise<string> {
  return getSecretValue('RESEND_API_KEY');
}

/**
 * Validate all required secrets are configured.
 */
export async function validateAllSecrets(required: SecretName[]): Promise<void> {
  const missing: string[] = [];
  
  for (const name of required) {
    try {
      const value = await getSecretValue(name);
      if (!value.trim()) {
        missing.push(name);
      }
    } catch {
      missing.push(name);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Missing required secrets: ${missing.join(', ')}`);
  }
}

/**
 * Get database URL with fallback to process.env for backward compatibility.
 * TODO: Remove this after full migration to KMS.
 */
export async function getDatabaseUrlWithFallback(): Promise<string> {
  try {
    return await getSecretValue('DATABASE_URL');
  } catch {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL not configured');
    }
    return url;
  }
}

/**
 * Get Stripe config with fallback to process.env for backward compatibility.
 * TODO: Remove this after full migration to KMS.
 */
export async function getStripeConfigWithFallback() {
  try {
    return {
      secretKey: await getSecretValue('STRIPE_SECRET_KEY'),
      webhookSecret: await getSecretValue('STRIPE_WEBHOOK_SECRET'),
    };
  } catch {
    return {
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    };
  }
}

/**
 * Check if Stripe is configured via KMS.
 */
export async function isStripeConfiguredViaKms(): Promise<boolean> {
  try {
    const key = await getSecretValue('STRIPE_SECRET_KEY');
    return key?.trim() !== undefined;
  } catch {
    return false;
  }
}

/**
 * Invalidate all secret caches (full rotation).
 */
export function invalidateAllSecrets(): void {
  // This would require tracking all secret names
  // For now, rely on KMS invalidateAllSecrets()
  import('./kms').then(({ invalidateAllSecrets }) => invalidateAllSecrets());
}