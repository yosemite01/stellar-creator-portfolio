use anyhow::{Context, Result};

#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub rust_log: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let jwt_secret = std::env::var("JWT_SECRET")
            .context("JWT_SECRET is required")?;
        if jwt_secret.len() < 32 {
            anyhow::bail!("JWT_SECRET must be at least 32 characters");
        }

        Ok(Self {
            host: std::env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("API_PORT")
                .unwrap_or_else(|_| "3001".to_string())
                .parse::<u16>()
                .context("API_PORT must be a valid port number")?,
            database_url: std::env::var("DATABASE_URL")
                .context("DATABASE_URL is required")?,
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string()),
            jwt_secret,
            rust_log: std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "info,stellar_api=debug".to_string()),
        })
    }
}
