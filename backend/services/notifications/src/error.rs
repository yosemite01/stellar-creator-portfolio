use actix_web::{HttpResponse, ResponseError};
use serde_json::json;
use std::fmt;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum NotificationError {
    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),

    #[error("Pool error: {0}")]
    Pool(#[from] deadpool_redis::PoolError),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Email error: {0}")]
    Email(String),

    #[error("HTTP client error: {0}")]
    HttpClient(#[from] reqwest::Error),

    #[error("Notification not found: {0}")]
    NotFound(String),

    #[error("Invalid notification type: {0}")]
    InvalidType(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Queue error: {0}")]
    Queue(String),

    #[error("Worker error: {0}")]
    Worker(String),

    #[error("Max retries exceeded for notification: {0}")]
    MaxRetriesExceeded(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl ResponseError for NotificationError {
    fn error_response(&self) -> HttpResponse {
        let (status, error_code) = match self {
            NotificationError::NotFound(_) => (actix_web::http::StatusCode::NOT_FOUND, "NOT_FOUND"),
            NotificationError::InvalidType(_) => (actix_web::http::StatusCode::BAD_REQUEST, "INVALID_TYPE"),
            NotificationError::Config(_) => (actix_web::http::StatusCode::BAD_REQUEST, "CONFIG_ERROR"),
            _ => (actix_web::http::StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
        };

        HttpResponse::build(status).json(json!({
            "error": error_code,
            "message": self.to_string()
        }))
    }
}

impl From<lettre::transport::smtp::Error> for NotificationError {
    fn from(err: lettre::transport::smtp::Error) -> Self {
        NotificationError::Email(err.to_string())
    }
}
