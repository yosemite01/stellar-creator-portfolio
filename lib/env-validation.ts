/**
 * Environment variable validation utilities
 * Ensures critical configuration is valid at startup
 */

/**
 * Validate encryption key format
 * Must be a valid 32-byte (64-character) hex string and not all zeros
 */
export function validateEncryptionKey(value: string): boolean {
  // Must be exactly 64 hex characters (32 bytes)
  if (value.length !== 64) {
    return false;
  }

  // Must be valid hex
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    return false;
  }

  // Must not be all zeros (weak key)
  if (value === '0000000000000000000000000000000000000000000000000000000000000000') {
    return false;
  }

  return true;
}

/**
 * Validate all required environment variables
 * Throws an error if validation fails
 */
export function validateEnvironment(): void {
  const errors: string[] = [];

  // Check ENCRYPTION_KEY if present
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey) {
    if (!validateEncryptionKey(encryptionKey)) {
      errors.push(
        'Invalid ENCRYPTION_KEY: must be a 32-byte (64-character) hex string and not all zeros. ' +
        'Generate with: openssl rand -hex 32'
      );
    }
  }

  if (errors.length > 0) {
    const errorMessage = 'Environment configuration errors:\n  - ' + errors.join('\n  - ');
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * Log environment configuration status
 * Explicitly calls out encryption key validation status
 */
export function logEnvironmentConfig(): void {
  console.log('Environment configuration:');

  // Check encryption key
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey) {
    if (validateEncryptionKey(encryptionKey)) {
      console.log('  ENCRYPTION_KEY: [VALID - 32-byte hex key]');
    } else {
      console.warn('  ENCRYPTION_KEY: [INVALID - will be rejected at startup]');
    }
  } else {
    console.log('  ENCRYPTION_KEY: [NOT SET]');
  }

  // Log other important configs
  if (process.env.NEXTAUTH_SECRET) {
    console.log('  NEXTAUTH_SECRET: [SET]');
  }

  if (process.env.DATABASE_URL) {
    const sanitized = sanitizeDatabaseUrl(process.env.DATABASE_URL);
    console.log(`  DATABASE_URL: ${sanitized}`);
  }

  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    console.log('  NEXT_PUBLIC_SENTRY_DSN: [SET]');
  }
}

/**
 * Sanitize database URL to hide credentials
 */
function sanitizeDatabaseUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    if (urlObj.password) {
      urlObj.password = '****';
    }
    return urlObj.toString();
  } catch {
    return '[INVALID URL]';
  }
}
