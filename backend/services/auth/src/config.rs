use anyhow::{Context, Result};

#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub jwt_secret: String,
    pub access_ttl_secs: u64,
    pub refresh_ttl_secs: u64,
    /// When set, `POST /auth/token` requires matching `X-Mint-Secret` header.
    pub mint_secret: Option<String>,
    /// When true and `mint_secret` is unset, allows mint without a secret (development only).
    pub dev_mint_allow: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let jwt_secret =
            std::env::var("JWT_SECRET").context("JWT_SECRET is required for signing access tokens")?;
        if jwt_secret.len() < 32 {
            anyhow::bail!("JWT_SECRET must be at least 32 characters");
        }

        let mint_secret = std::env::var("AUTH_MINT_SECRET").ok().filter(|s| !s.is_empty());
        let dev_mint_allow = std::env::var("AUTH_DEV_MINT")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        let access_ttl_secs = std::env::var("AUTH_ACCESS_TOKEN_TTL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(900);

        let refresh_ttl_secs = std::env::var("AUTH_REFRESH_TOKEN_TTL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(604_800);

        Ok(Config {
            host: std::env::var("AUTH_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("AUTH_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(8080),
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            jwt_secret,
            access_ttl_secs,
            refresh_ttl_secs,
            mint_secret,
            dev_mint_allow,
        })
    }

    pub fn mint_allowed(&self, header_secret: Option<&str>) -> bool {
        match &self.mint_secret {
            Some(expected) => header_secret.is_some_and(|h| h == expected.as_str()),
            None => self.dev_mint_allow,
        }
    }
}
