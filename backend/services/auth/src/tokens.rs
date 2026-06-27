use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccessClaims {
    pub sub: String,
    pub jti: Uuid,
    pub family_id: Uuid,
    pub exp: i64,
    pub iat: i64,
}

pub fn hash_refresh_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub fn generate_refresh_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn sign_access_token(
    user_id: &str,
    family_id: Uuid,
    jwt_secret: &str,
    ttl: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let exp = now + ttl;
    let claims = AccessClaims {
        sub: user_id.to_string(),
        jti: Uuid::new_v4(),
        family_id,
        exp: exp.timestamp(),
        iat: now.timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
}

#[allow(dead_code)]
pub fn verify_access_token(
    token: &str,
    jwt_secret: &str,
) -> Result<AccessClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.validate_exp = true;
    let token = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &validation,
    )?;
    Ok(token.claims)
}

#[derive(Clone, Default)]
pub struct RevocationList {
    revoked_jtis: Arc<Mutex<HashSet<Uuid>>>,
}

impl RevocationList {
    pub fn new() -> Self {
        Self {
            revoked_jtis: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn revoke(&self, jti: Uuid) {
        self.revoked_jtis.lock().unwrap().insert(jti);
    }

    pub fn is_revoked(&self, jti: &Uuid) -> bool {
        self.revoked_jtis.lock().unwrap().contains(jti)
    }
}

pub fn verify_access_token_with_revocation(
    token: &str,
    jwt_secret: &str,
    revocation_list: &RevocationList,
) -> Result<AccessClaims, TokenError> {
    let claims = verify_access_token(token, jwt_secret)
        .map_err(|e| TokenError::Jwt(e.to_string()))?;

    if revocation_list.is_revoked(&claims.jti) {
        return Err(TokenError::Revoked);
    }

    Ok(claims)
}

#[derive(Debug, Clone)]
pub enum TokenError {
    Jwt(String),
    Revoked,
    Reused,
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenError::Jwt(e) => write!(f, "JWT error: {}", e),
            TokenError::Revoked => write!(f, "token has been revoked"),
            TokenError::Reused => write!(f, "token reuse detected — all sessions revoked"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_token_round_trip() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let claims = verify_access_token(&token, secret).unwrap();
        assert_eq!(claims.sub, "user-1");
        assert_eq!(claims.family_id, family);
    }

    #[test]
    fn access_token_has_jti() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let claims = verify_access_token(&token, secret).unwrap();
        assert!(!claims.jti.is_nil());
    }

    #[test]
    fn two_tokens_have_different_jtis() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let t1 = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let t2 = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let c1 = verify_access_token(&t1, secret).unwrap();
        let c2 = verify_access_token(&t2, secret).unwrap();
        assert_ne!(c1.jti, c2.jti);
    }

    #[test]
    fn refresh_token_hash_stable() {
        let t = "abc";
        assert_eq!(hash_refresh_token(t), hash_refresh_token(t));
    }

    #[test]
    fn revocation_list_blocks_revoked_token() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let claims = verify_access_token(&token, secret).unwrap();

        let rev_list = RevocationList::new();
        assert!(!rev_list.is_revoked(&claims.jti));

        rev_list.revoke(claims.jti);
        assert!(rev_list.is_revoked(&claims.jti));

        let result = verify_access_token_with_revocation(&token, secret, &rev_list);
        assert!(matches!(result, Err(TokenError::Revoked)));
    }

    #[test]
    fn revocation_list_allows_non_revoked_token() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();

        let rev_list = RevocationList::new();
        let result = verify_access_token_with_revocation(&token, secret, &rev_list);
        assert!(result.is_ok());
    }
}
