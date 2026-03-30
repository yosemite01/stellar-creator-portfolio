use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub redis_url: String,
    pub smtp_config: SmtpConfig,
    pub webhook_base_url: Option<String>,
    pub max_retries: u32,
    pub retry_delay_seconds: u64,
    pub worker_poll_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from_address: String,
    pub from_name: String,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();

        let smtp_config = SmtpConfig {
            host: std::env::var("SMTP_HOST").unwrap_or_else(|_| "smtp.gmail.com".to_string()),
            port: std::env::var("SMTP_PORT")
                .unwrap_or_else(|_| "587".to_string())
                .parse()
                .unwrap_or(587),
            username: std::env::var("SMTP_USERNAME").unwrap_or_default(),
            password: std::env::var("SMTP_PASSWORD").unwrap_or_default(),
            from_address: std::env::var("SMTP_FROM_ADDRESS")
                .unwrap_or_else(|_| "notifications@stellar.local".to_string()),
            from_name: std::env::var("SMTP_FROM_NAME")
                .unwrap_or_else(|_| "Stellar Platform".to_string()),
        };

        Ok(Self {
            host: std::env::var("NOTIFICATIONS_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: std::env::var("NOTIFICATIONS_PORT")
                .unwrap_or_else(|_| "3003".to_string())
                .parse()
                .unwrap_or(3003),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            smtp_config,
            webhook_base_url: std::env::var("WEBHOOK_BASE_URL").ok(),
            max_retries: std::env::var("MAX_RETRIES")
                .unwrap_or_else(|_| "3".to_string())
                .parse()
                .unwrap_or(3),
            retry_delay_seconds: std::env::var("RETRY_DELAY_SECONDS")
                .unwrap_or_else(|_| "60".to_string())
                .parse()
                .unwrap_or(60),
            worker_poll_interval_seconds: std::env::var("WORKER_POLL_INTERVAL_SECONDS")
                .unwrap_or_else(|_| "5".to_string())
                .parse()
                .unwrap_or(5),
        })
    }
}
