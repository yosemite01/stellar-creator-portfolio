# Secret Management Migration Guide

## Overview

This guide walks through migrating from direct `process.env` secret reads to the unified KMS provider.

## Status

### Secrets Already Migrated

The following secrets are already routed through KMS:

| Secret | File | Provider |
|--------|------|----------|
| `STELLAR_ADMIN_SECRET` | `server/services/kms.ts` | env/aws/azure |
| `STELLAR_FEE_ACCOUNT_SECRET` | `server/services/kms.ts` | env/aws/azure |
| `JWT_SECRET` | `server/services/kms.ts` | env/aws/azure |
| `ENCRYPTION_KEY` | `server/services/kms.ts` | env/aws/azure |
| `STRIPE_SECRET_KEY` | `lib/payments/stripe.ts` | KMS |
| `STRIPE_WEBHOOK_SECRET` | `server/services/kms.ts` | env/aws/azure |
| `NEXTAUTH_SECRET` | `server/services/kms.ts` | env/aws/azure |
| `WEBHOOK_SECRET` | `server/services/kms.ts` | env/aws/azure |

### Secrets Still Using process.env

| Secret | File | Migration Required |
|--------|------|-------------------|
| `RESEND_API_KEY` | `lib/email/mailer.ts` | Yes |
| `AWS_ACCESS_KEY_ID` | `lib/storage/s3.ts` | Yes |
| `AWS_SECRET_ACCESS_KEY` | `lib/storage/s3.ts`, `lib/webhooks/verify-signature.ts` | Yes |
| `AWS_SES_REGION` | `lib/email/mailer.ts` | No (region, not secret) |
| `SES_REGION` | `lib/email/mailer.ts` | No (region, not secret) |
| `SMTP_HOST` | `lib/email/mailer.ts` | Yes |
| `SMTP_USER` | `lib/email/mailer.ts` | Yes |
| `SMTP_PASSWORD` | `lib/email/mailer.ts` | Yes |
| `S3_ACCESS_KEY_ID` | `lib/storage/s3.ts` | Yes |
| `S3_SECRET_ACCESS_KEY` | `lib/storage/s3.ts` | Yes |
| `REDIS_URL` | Various | Yes (if used for secrets) |
| `SIGNALING_TOKEN_SECRET` | `server/realtime/signaling-policy.ts` | Yes |
| `REALTIME_JWT_SECRET` | `server/realtime/collab-policy.ts` | Yes |
| `TURN_SECRET` | `server/realtime/signaling-policy.ts` | Yes |

## Migration Steps

### Step 1: Add Secret to SecretName Union

Edit `server/services/secrets.ts`:

```typescript
export type SecretName = KmsSecretName |
  // ... existing |
  'YOUR_SECRET_NAME';
```

### Step 2: Add Wrapper Function

In `server/services/secrets.ts`:

```typescript
/**
 * Get your secret.
 */
export async function getYourSecret(): Promise<string> {
  return getSecretValue('YOUR_SECRET_NAME');
}
```

### Step 3: Update Secret Reads

Replace `process.env.YOUR_SECRET`:

```typescript
// Before
const secret = process.env.YOUR_SECRET;

// After
import { getYourSecret } from '@/server/services/secrets';
const secret = await getYourSecret();
```

### Step 4: Update Validation

If the secret is validated at startup, add to `validateAllSecrets`:

```typescript
await validateAllSecrets(['YOUR_SECRET_NAME']);
```

## Examples

### Example 1: S3 Credentials

```typescript
// Before (lib/storage/s3.ts)
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;

// After
import { getS3Credentials } from '@/server/services/secrets';

const { accessKeyId, secretAccessKey } = await getS3Credentials();
```

### Example 2: Email Provider

```typescript
// Before (lib/email/mailer.ts)
if (process.env.RESEND_API_KEY) return "resend";
if (process.env.AWS_SES_REGION || process.env.SES_REGION) return "ses";

// After
import { getResendApiKey } from '@/server/services/secrets';

async function getProvider(): Promise<string> {
  if (await isSecretConfigured('RESEND_API_KEY')) return "resend";
  if (process.env.AWS_SES_REGION || process.env.SES_REGION) return "ses";
  return "console";
}
```

### Example 3: Redis URL

```typescript
// Before
const redisUrl = process.env.REDIS_URL;

// After
import { getRedisUrl } from '@/server/services/secrets';

const redisUrl = await getRedisUrl();
```

## Testing

### Unit Tests

```typescript
import { getYourSecret } from '@/server/services/secrets';

it('should retrieve your secret', async () => {
  const result = await getYourSecret();
  expect(result).toBeDefined();
  expect(result.length).toBeGreaterThan(0);
});
```

### Integration Tests

```typescript
it('should work with AWS provider', async () => {
  process.env.KMS_PROVIDER = 'aws';
  const result = await getYourSecret();
  expect(result).not.toContain('[REDACTED]');
});
```

## Rollback Plan

If migration causes issues:

1. Check KMS provider configuration
2. Verify secret names match
3. Check network connectivity to Secrets Manager
4. Fall back to env provider: `KMS_PROVIDER=env`

## CI Checks

### Lint Rule

```bash
# Run ESLint with KMS plugin
pnpm lint --plugin kms
```

### Type Check

```bash
# Verify no direct env reads remain
grep -r "process\.env\.\(JWT\|STRIPE\|SECRET\|TOKEN\)" lib/ server/ --include="*.ts" | grep -v "kms.ts" | grep -v "secrets.ts"
```

### Test Suite

```bash
# Run all secret tests
pnpm test server/services/secrets.test.ts
pnpm test server/services/kms.test.ts
```

## Verification Checklist

- [ ] All secrets use KMS provider
- [ ] `validateAllSecrets()` runs at startup
- [ ] Cache invalidation works for rotation
- [ ] Lint rule catches direct env reads
- [ ] Tests pass for all providers (env/aws/azure)
- [ ] Documentation updated
- [ ] Rotation runbook reviewed