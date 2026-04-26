use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct AccessClaims {
    pub sub: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_token_round_trip() {
        let secret = "01234567890123456789012345678901"; // 32 chars
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let claims = verify_access_token(&token, secret).unwrap();
        assert_eq!(claims.sub, "user-1");
        assert_eq!(claims.family_id, family);
    }

    #[test]
    fn refresh_token_hash_stable() {
        let t = "abc";
        assert_eq!(hash_refresh_token(t), hash_refresh_token(t));
    }
}
