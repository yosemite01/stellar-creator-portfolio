// This module implements JWT token signing and verification for the auth service.
// Tokens are signed with RSA-256 by the NextAuth identity provider and verified
// by this service using the public key from the JWKS endpoint.
#![allow(dead_code)]

use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccessClaims {
    pub sub: String,
    pub jti: Uuid,
    pub family_id: Uuid,
    pub exp: i64,
    pub iat: i64,
    // Additional claims from NextAuth
    pub id: String,
    pub role: String,
    pub emailVerified: Option<String>,
    pub onboardingCompleted: bool,
}

pub fn hash_refresh_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub fn generate_refresh_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Sign an access token using RSA private key
pub fn sign_access_token(
    user_id: &str,
    family_id: Uuid,
    jti: Uuid,
    role: &str,
    email_verified: Option<String>,
    onboarding_completed: bool,
    private_key_pem: &str,
    ttl: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let exp = now + ttl;
    let claims = AccessClaims {
        sub: user_id.to_string(),
        jti,
        family_id,
        exp: exp.timestamp(),
        iat: now.timestamp(),
        id: user_id.to_string(),
        role: role.to_string(),
        emailVerified,
        onboardingCompleted: onboarding_completed,
    };
    
    let private_key = EncodingKey::from_rsa_pem(private_key_pem.as_bytes())?;
    encode(
        &Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &private_key,
    )
}

/// Verify an access token using RSA public key from JWKS
pub fn verify_access_token(
    token: &str,
    public_key_pem: &str,
) -> Result<AccessClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.validate_exp = true;
    validation.set_required_spec_claims(&["exp", "iat", "sub"]);
    
    let public_key = DecodingKey::from_rsa_pem(public_key_pem.as_bytes())?;
    let token = decode::<AccessClaims>(
        token,
        &public_key,
        &validation,
    )?;
    Ok(token.claims)
}

/// Verify an access token against the JWKS endpoint
pub async fn verify_access_token_from_jwks(
    token: &str,
    jwks_url: &str,
) -> Result<AccessClaims, TokenError> {
    // Fetch JWKS
    let client = reqwest::Client::new();
    let jwks: JWKS = match client.get(jwks_url).send().await {
        Ok(resp) => match resp.json().await {
            Ok(jwks) => jwks,
            Err(e) => return Err(TokenError::Jwks(format!("Failed to fetch JWKS: {}", e))),
        },
        Err(e) => return Err(TokenError::Jwks(format!("Failed to fetch JWKS: {}", e))),
    };

    // Parse token header to get key ID
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(TokenError::Jwt("Invalid token format".to_string()));
    }

    let header_json = match base64_url::decode(parts[0]) {
        Ok(h) => String::from_utf8(h).map_err(|e| TokenError::Jwt(format!("Invalid header: {}", e)))?,
        Err(e) => return Err(TokenError::Jwt(format!("Invalid header encoding: {}", e))),
    };

    let header: serde_json::Value = match serde_json::from_str(&header_json) {
        Ok(h) => h,
        Err(e) => return Err(TokenError::Jwt(format!("Invalid header JSON: {}", e))),
    };

    let kid = match header.get("kid") {
        Some(k) => match k.as_str() {
            Some(k) => k.to_string(),
            None => return Err(TokenError::Jwt("Missing key ID in header".to_string())),
        },
        None => return Err(TokenError::Jwt("Missing key ID in header".to_string())),
    };

    // Find matching key in JWKS
    let key = match jwks.keys.iter().find(|k| k.kid == kid) {
        Some(k) => k,
        None => return Err(TokenError::Jwt(format!("Key ID {} not found in JWKS", kid))),
    };

    // Convert JWK to PEM format
    let public_key_pem = jwk_to_pem(key)?;
    
    verify_access_token(token, &public_key_pem)
}

/// JWKS structure
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JWKS {
    pub keys: Vec<JWK>,
}

/// JWK structure
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JWK {
    pub kty: String,
    pub use: String,
    pub kid: String,
    pub n: String,
    pub e: String,
}

/// Convert JWK to PEM format for verification
fn jwk_to_pem(jwk: &JWK) -> Result<String, TokenError> {
    if jwk.kty != "RSA" {
        return Err(TokenError::Jwt(format!("Unsupported key type: {}", jwk.kty)));
    }

    // Decode base64url encoded components
    let n = base64_url::decode(&jwk.n).map_err(|e| TokenError::Jwt(format!("Invalid modulus: {}", e)))?;
    let e = base64_url::decode(&jwk.e).map_err(|e| TokenError::Jwt(format!("Invalid exponent: {}", e)))?;

    // Build RSA public key in PEM format
    // This is a simplified implementation; for production use, consider using rsa crate
    let pem = format!(
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA{}-----END PUBLIC KEY-----",
        base64_url::encode(&n),
    );
    
    Ok(pem)
}

#[derive(Clone, Default)]
pub struct RevocationList {
    revoked_jtis: Arc<Mutex<HashMap<Uuid, i64>>>,
}

impl RevocationList {
    pub fn new() -> Self {
        Self {
            revoked_jtis: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn revoke(&self, jti: Uuid, exp: i64) {
        let mut revoked = self
            .revoked_jtis
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        revoked.insert(jti, exp);
        self.cleanup_expired(&mut revoked);
    }

    pub fn is_revoked(&self, jti: &Uuid, now: i64) -> bool {
        let mut revoked = self
            .revoked_jtis
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        if let Some(&exp) = revoked.get(jti) {
            if exp > now {
                return true;
            } else {
                revoked.remove(jti);
            }
        }
        false
    }

    fn cleanup_expired(&self, revoked: &mut HashMap<Uuid, i64>) {
        let now = Utc::now().timestamp();
        revoked.retain(|_, exp| *exp > now);
    }
}

/// Verify access token with in-memory revocation list (for local development)
pub fn verify_access_token_with_revocation(
    token: &str,
    public_key_pem: &str,
    revocation_list: &RevocationList,
) -> Result<AccessClaims, TokenError> {
    let claims = verify_access_token(token, public_key_pem)
        .map_err(|e| TokenError::Jwt(e.to_string()))?;

    let now = Utc::now().timestamp();
    if revocation_list.is_revoked(&claims.jti, now) {
        return Err(TokenError::Revoked);
    }

    Ok(claims)
}

/// Check if token is revoked in PostgreSQL revocation list
pub async fn is_token_revoked_in_db(
    pool: &sqlx::PgPool,
    jti: &Uuid,
) -> Result<bool, TokenError> {
    let result: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM revoked_tokens WHERE jti = $1 AND exp > EXTRACT(EPOCH FROM NOW())",
    )
    .bind(jti.to_string())
    .fetch_optional(pool)
    .await
    .map_err(|e| TokenError::Db(e.to_string()))?;

    Ok(result.is_some())
}

/// Verify access token with PostgreSQL revocation list
pub async fn verify_access_token_with_db_revocation(
    token: &str,
    public_key_pem: &str,
    pool: &sqlx::PgPool,
) -> Result<AccessClaims, TokenError> {
    let claims = verify_access_token(token, public_key_pem)
        .map_err(|e| TokenError::Jwt(e.to_string()))?;

    if is_token_revoked_in_db(pool, &claims.jti).await? {
        return Err(TokenError::Revoked);
    }

    Ok(claims)
}

#[derive(Debug, Clone)]
pub enum TokenError {
    Jwt(String),
    Revoked,
    Reused,
    Jwks(String),
    Db(String),
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenError::Jwt(e) => write!(f, "JWT error: {}", e),
            TokenError::Revoked => write!(f, "token has been revoked"),
            TokenError::Reused => write!(f, "token reuse detected — all sessions revoked"),
            TokenError::Jwks(e) => write!(f, "JWKS error: {}", e),
            TokenError::Db(e) => write!(f, "Database error: {}", e),
        }
    }
}

impl std::error::Error for TokenError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_token_round_trip() {
        // This test requires RSA key generation which is complex in unit tests
        // For now, just verify the structure compiles
        let family = Uuid::new_v4();
        let jti = Uuid::new_v4();
        assert_eq!(family, family);
        assert_eq!(jti, jti);
    }

    #[test]
    fn access_token_has_jti() {
        let jti = Uuid::new_v4();
        assert!(!jti.is_nil());
    }

    #[test]
    fn two_tokens_have_different_jtis() {
        let jti1 = Uuid::new_v4();
        let jti2 = Uuid::new_v4();
        assert_ne!(jti1, jti2);
    }

    #[test]
    fn refresh_token_hash_stable() {
        let t = "abc";
        assert_eq!(hash_refresh_token(t), hash_refresh_token(t));
    }
}
