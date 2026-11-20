# Authentication Unification

## Overview

This document describes the unified authentication system for the Stellar Creator Portfolio project.

## Architecture

The authentication system has been unified to use a single identity provider (NextAuth) with asymmetric JWT tokens.

### Components

1. **NextAuth (Identity Provider)**
   - Handles user registration, login, and OAuth
   - Signs JWT tokens with RSA-256 private key
   - Exposes JWKS endpoint for token verification

2. **JWKS Endpoint (`/api/jwks`)**
   - Distributes the public key for token verification
   - Returns JWKS format with single RSA key

3. **Shared Revocation List (PostgreSQL)**
   - Single source of truth for revoked tokens
   - Both Next.js and Rust services check revocation

4. **Rust Auth Service (Verifier Only)**
   - Verifies tokens using JWKS public key
   - Checks revocation list
   - No longer mints tokens

## Token Format

Tokens are signed with RSA-256 and contain the following claims:

```json
{
  "sub": "user-id",
  "jti": "uuid",
  "id": "user-id",
  "role": "USER|CREATOR|CLIENT|ADMIN",
  "emailVerified": "timestamp|null",
  "onboardingCompleted": true|false,
  "exp": 1234567890,
  "iat": 1234567890,
  "iss": "stellar-creator-portfolio",
  "aud": "stellar-creator-portfolio"
}
```

### Claim Descriptions

| Claim | Description |
|-------|-------------|
| `sub` | Subject (user ID) |
| `jti` | JWT ID (unique identifier for revocation) |
| `id` | User ID (duplicate of sub for compatibility) |
| `role` | User role (USER, CREATOR, CLIENT, or ADMIN) |
| `emailVerified` | Email verification timestamp or null |
| `onboardingCompleted` | Boolean indicating onboarding completion |
| `exp` | Expiration timestamp |
| `iat` | Issued at timestamp |
| `iss` | Issuer (always "stellar-creator-portfolio") |
| `aud` | Audience (always "stellar-creator-portfolio") |

## JWKS Endpoint

### Endpoint

```
GET /api/jwks
```

### Response

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "fingerprint",
      "n": "modulus",
      "e": "exponent"
    }
  ]
}
```

### Headers

- `Cache-Control: public, max-age=3600` (1 hour cache)

## Token Verification

### Next.js Services

```typescript
import { verify_access_token_from_jwks } from '@/lib/auth/keys';

const token = req.headers.get('authorization')?.replace('Bearer ', '');
const claims = await verify_access_token_from_jwks(
  token,
  process.env.NEXTAUTH_URL + '/api/jwks'
);
```

### Rust Services

```rust
use stellar_auth::tokens::verify_access_token_from_jwks;

let token = req.headers()
    .get("authorization")
    .and_then(|h| h.to_str().ok())
    .map(|s| s.trim_start_matches("Bearer "))
    .unwrap_or("");

let claims = verify_access_token_from_jwks(token, &jwks_url).await?;
```

## Revocation

### Checking if Token is Revoked

```typescript
import { isTokenRevoked } from '@/lib/auth/revocation';

const jti = 'token-id';
const isRevoked = await isTokenRevoked(jti);

if (isRevoked) {
  // Reject token
}
```

### Revoking a Token

```typescript
import { revokeToken } from '@/lib/auth/revocation';

await revokeToken(jti, expirationTimestamp);
```

## Key Management

### Key Location

- Private key: `.auth-keys/auth-private-key.pem` (gitignored)
- Public key: `.auth-keys/auth-public-key.pem`

### Generating Keys

```bash
# Generate new keys
pnpm auth:generate-keys
```

### Key Rotation

1. Generate new key pair
2. Update JWKS endpoint with new key
3. Wait for all services to cache new key
4. Remove old key

## Security Considerations

### Private Key Protection

1. **Never commit** the private key to version control
2. Use environment variables for production keys
3. Rotate keys periodically (quarterly recommended)
4. Store keys in secure storage (AWS KMS, Azure Key Vault)

### Token Validation

1. Always validate `exp` (expiration)
2. Validate `iss` (issuer) matches expected value
3. Validate `aud` (audience) matches expected value
4. Check revocation list before accepting token

### JWKS Security

1. Use HTTPS for JWKS endpoint
2. Rate limit JWKS requests
3. Cache JWKS response
4. Implement fallback to cached JWKS

## Troubleshooting

### Token Verification Fails

1. Check JWKS endpoint is accessible
2. Verify key pair matches
3. Check token expiration
4. Check revocation list

### JWKS Endpoint Returns 500

1. Check `.auth-keys/` directory exists
2. Verify private key file exists
3. Check key format (PEM format required)

### Rust Service Cannot Verify Token

1. Check JWKS URL is correct
2. Verify Rust service has network access to Next.js
3. Check token signature algorithm (RS256 required)

## Related Documentation

- [Authentication Architecture](ARCHITECTURE.md)
- [API Reference](API.md)
- [JWT Standards](https://datatracker.ietf.org/doc/html/rfc7519)

## Related Issues

- Issue #1629: Architecture overview
- Issue #X: Authentication unification (to be created)
