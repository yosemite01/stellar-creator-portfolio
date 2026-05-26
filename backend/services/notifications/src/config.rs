use serde::Deserialize;
use std::env;
use crate::models::{NotificationError, Result};

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: String,
    pub smtp_pass: String,
    pub smtp_from: String,

    pub twilio_sid: String,
    pub twilio_auth_token: String,
    pub twilio_from_number: String,

    // Placeholder for push notification credentials (e.g. FCM Server Key)
    pub push_app_id: Option<String>,
}

impl Settings {
    pub fn from_env() -> Result<Self> {
        dotenvy::dotenv().ok(); // Ignore error if .env doesn't exist

        Ok(Self {
            smtp_host: env::var("SMTP_HOST").unwrap_or_else(|_| "localhost".to_string()),
            smtp_port: env::var("SMTP_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(587),
            smtp_user: env::var("SMTP_USER").unwrap_or_default(),
            smtp_pass: env::var("SMTP_PASS").unwrap_or_default(),
            smtp_from: env::var("SMTP_FROM").unwrap_or_else(|_| "noreply@stellar.platform".to_string()),

            twilio_sid: env::var("TWILIO_SID").unwrap_or_default(),
            twilio_auth_token: env::var("TWILIO_AUTH_TOKEN").unwrap_or_default(),
            twilio_from_number: env::var("TWILIO_FROM_NUMBER").unwrap_or_default(),

            push_app_id: env::var("PUSH_APP_ID").ok(),
        })
    }

    pub fn validate(&self) -> Result<()> {
        if self.smtp_user.is_empty() && self.smtp_host != "localhost" {
            return Err(NotificationError::Config("SMTP_USER is required for non-localhost hosts".to_string()));
        }
        if self.twilio_sid.is_empty() || self.twilio_auth_token.is_empty() {
             tracing::warn!("Twilio credentials missing; SMS delivery will fail");
        }
        Ok(())
    }
}
