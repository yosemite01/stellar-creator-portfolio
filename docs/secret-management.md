# Secret Management Design Note

## Overview

This document describes the unified secret management system that routes all secrets through the KMS provider with runtime rotation support.

## Data Model

### SecretName (Union Type)

```typescript
type SecretName =
  | 'STELLAR_ADMIN_SECRET'
  | 'STELLAR_FEE_ACCOUNT_SECRET'
  | 'JWT_SECRET'
  | 'ENCRYPTION_KEY'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'NEXTAUTH_SECRET'
  | 'WEBHOOK_SECRET'
  | 'RESEND_API_KEY'
  | 'AWS_ACCESS_KEY_ID'
  | 'AWS_SECRET_ACCESS_KEY'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
  | 'REDIS_URL'
  | 'SENTRY_DSN'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
```

### Provider Configuration

```typescript
interface KmsProviderConfig {
  provider: KmsProviderName; // 'env' | 'aws' | 'azure'
  aws?: {
    region?: string;
    secretPrefix?: string;
  };
  azure?: {
    vaultUrl: string;
  };
}
```

## API

### getSecret(name: SecretName): Promise<string>

Retrieves a secret with caching. First call fetches from provider, subsequent calls use in-process cache.

**Caching behavior:**
- Cache lives for process lifetime
- `invalidateSecret(name)` clears one entry
- `invalidateAllSecrets()` clears all entries

**Error handling:**
- Never exposes secret values in error messages
- Error format: `KMS[provider]: failed to retrieve secret "NAME" (code: CODE)`

### invalidateSecret(name: SecretName): void

Clears cache entry for a secret. Called after rotation.

### invalidateAllSecrets(): void

Clears all cached secrets. Used after full rotation.

### provisionSecret(name: SecretName, value: string): Promise<void>

Creates/updates a secret in AWS or Azure. Not available for `env` provider.

### validateSecrets(required: SecretName[]): Promise<void>

Validates all required secrets are resolvable at startup.

## Failure Modes

### Provider Unavailable
- Falls back gracefully if provider returns error
- Logs error without exposing secret name in user-facing messages
- Cache serves stale values if available

### Secret Not Found
- Throws with secret name but no value
- Aggregated in `validateSecrets()` for batch error reporting

### Config Errors
- Unknown `KMS_PROVIDER` falls back to `env` with warning
- Missing `AWS_REGION` defaults to `us-east-1`
- Missing `AZURE_KEYVAULT_URL` throws with clear message

## Secret Rotation

### Runtime Rotation Flow

1. Rotate secret in Secrets Manager/Key Vault
2. Call `invalidateSecret(name)` after rotation completes
3. Next `getSecret(name)` call fetches fresh value
4. No process restart required

### Example

```typescript
// In rotation webhook or CLI
import { invalidateSecret } from '@/server/services/kms';

app.post('/rotation/webhook', async (req, res) => {
  await invalidateSecret('JWT_SECRET');
  res.status(200).send('Secret invalidated');
});
```

## Migration Plan

### Phase 1: Inventory (Current)
- Find all `process.env` secret reads
- Add to `SecretName` union
- Update docs

### Phase 2: Routing
- Create wrapper module
- Replace `process.env` reads with `getSecret()`
- Add lint rule

### Phase 3: Validation
- Run `validateSecrets()` at startup
- Remove direct `process.env` accesses

## CI Checks

### Lint Rule (eslint-plugin-kms)

```javascript
'kms/no-direct-env-read': ['error', {
  'pattern': 'process\\.env\\.[A-Z_]+'
}]
```

### Tests

- Test rotation: verify new value picked up after `invalidateSecret()`
- Test cache: verify same value returned for multiple calls
- Test fallback: verify `env` provider works when provider unavailable

## Next Steps

1. Complete inventory of `process.env` secret reads
2. Create wrapper module with caching
3. Add lint rule
4. Run CI validation
5. Document rotation runbook