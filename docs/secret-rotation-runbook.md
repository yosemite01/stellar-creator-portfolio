# Secret Rotation Runbook

## Overview

This runbook covers rotating secrets at runtime without requiring application restarts.

## Prerequisites

- KMS provider configured (AWS Secrets Manager, Azure Key Vault, or local env)
- Access to KMS console or CLI
- Understanding of secret naming convention

## Rotation Procedures

### AWS Secrets Manager

#### 1. Rotate via AWS Console

1. Navigate to AWS Secrets Manager
2. Select the secret (e.g., `stellar/prod/JWT_SECRET`)
3. Click "Rotate secret"
4. Choose rotation method:
   - **Automatic**: Creates Lambda rotation function
   - **Manual**: Rotate yourself
5. Configure rotation schedule (recommended: 90 days)
6. Test rotation immediately

#### 2. Rotate via CLI

```bash
# Rotate JWT secret
aws secretsmanager rotate-secret \
  --secret-id stellar/prod/JWT_SECRET \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:RotateJWTSecret

# Rotate other secrets
aws secretsmanager rotate-secret \
  --secret-id stellar/prod/STRIPE_SECRET_KEY

# Rotate Stellar admin key
aws secretsmanager rotate-secret \
  --secret-id stellar/prod/STELLAR_ADMIN_SECRET
```

#### 3. Invalidate Cache in Application

After rotation completes, invalidate the cached secret:

```javascript
// From application or CLI
import { invalidateSecret } from '@/server/services/kms';

await invalidateSecret('JWT_SECRET');
```

Or make a curl request to a webhook endpoint:

```bash
curl -X POST https://your-app.com/api/rotation/webhook \
  -H "Authorization: Bearer YOUR_SECRET" \
  -d '{"secret": "JWT_SECRET"}'
```

### Azure Key Vault

#### 1. Rotate via Azure Portal

1. Navigate to Azure Key Vault
2. Select "Secrets"
3. Choose the secret (e.g., `stellar-prod-jwt-secret`)
4. Click "New Version"
5. Generate new value
6. Set as current version

#### 2. Rotate via CLI

```bash
# Generate new secret value
NEW_VALUE=$(openssl rand -hex 32)

# Update secret
az keyvault secret set \
  --vault-name stellar-prod-vault \
  --name stellar-prod-jwt-secret \
  --value "$NEW_VALUE"

# Invalidate cache in application
curl -X POST https://your-app.com/api/rotation/webhook
```

### Local Environment (Development)

For local development, secrets are read from environment variables.

#### 1. Update Environment

```bash
# In your shell
export JWT_SECRET=$(openssl rand -hex 32)

# Or in .env.local
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env.local
```

#### 2. Restart Application

Local environment requires restart:

```bash
pnpm dev
```

## Automated Rotation

### AWS Lambda Rotation

Create a Lambda function to rotate secrets automatically:

```javascript
// rotation-lambda.js
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const secretsManager = new AWS.SecretsManager();

exports.handler = async (event) => {
  const arn = event.SecretId;
  const step = event.Step;
  
  switch (step) {
    case 'createSecret':
      return createSecret(arn);
    case 'testSecret':
      return testSecret(arn);
    case 'finishSecret':
      return finishSecret(arn);
    default:
      throw new Error('Invalid step');
  }
};

async function createSecret(arn) {
  const secretValue = { token: uuidv4() };
  await secretsManager.putSecretValue({
    SecretId: arn,
    SecretString: JSON.stringify(secretValue),
  });
}

async function testSecret(arn) {
  // Test that the new secret works
  const secret = await secretsManager.getSecretValue({ SecretId: arn });
  // Verify it works with your service
  return;
}

async function finishSecret(arn) {
  // Mark new version as current
  await secretsManager.updateSecretVersionStage({
    SecretId: arn,
    VersionStage: 'AWSCURRENT',
  });
}
```

### Cron-Based Rotation

Set up a cron job to rotate secrets periodically:

```bash
# Cron entry (rotates JWT secret monthly)
0 0 1 * * /path/to/rotate-secrets.sh
```

```bash
# rotate-secrets.sh
#!/bin/bash
aws secretsmanager rotate-secret \
  --secret-id stellar/prod/JWT_SECRET \
  --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:RotateJWTSecret
```

## Verification

### Verify Rotation

After rotation, verify:

```bash
# Test with curl
curl -X POST http://localhost:3000/api/rotation/webhook \
  -H "Authorization: Bearer YOUR_SECRET" \
  -d '{"secret": "JWT_SECRET"}'

# Check application logs
tail -f logs/app.log | grep "Secret invalidated"
```

### Test Application

Verify application works with new secret:

```javascript
// Test JWT authentication
curl -X POST http://localhost:3000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

// Should succeed with new secret
```

## Troubleshooting

### Secret Not Rotated

**Symptom**: Application still uses old secret.

**Solution**:
1. Check cache: `invalidateSecret('SECRET_NAME')`
2. Verify rotation in AWS/Azure console
3. Check application logs for errors

### Rotation Failed

**Symptom**: Rotation throws error.

**Solution**:
1. Check IAM permissions (AWS) or RBAC (Azure)
2. Verify secret name matches
3. Check network connectivity to KMS

### Application Down After Rotation

**Symptom**: Application fails to start.

**Solution**:
1. Check secrets are configured
2. Verify provider credentials
3. Check for typos in secret names

## Security Checklist

- [ ] Rotate secrets before expiration
- [ ] Rotate immediately after suspected compromise
- [ ] Test rotation in staging first
- [ ] Monitor logs after rotation
- [ ] Revoke old secret values if applicable
- [ ] Update dependent services
- [ ] Document rotation in incident log

## Contact

For questions or issues, contact the platform team.