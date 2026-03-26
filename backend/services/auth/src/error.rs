use actix_web::{HttpResponse, ResponseError};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("invalid or expired refresh token")]
    InvalidRefreshToken,
    #[error("mint not configured: set AUTH_MINT_SECRET or AUTH_DEV_MINT=1 for local development only")]
    MintNotConfigured,
    #[error("unauthorized mint request")]
    MintUnauthorized,
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("jwt error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
}

impl ResponseError for AuthError {
    fn error_response(&self) -> HttpResponse {
        let (status, msg) = match self {
            AuthError::InvalidRefreshToken => (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::MintNotConfigured => (
                actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
                self.to_string(),
            ),
            AuthError::MintUnauthorized => (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string()),
            AuthError::Db(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            ),
            AuthError::Jwt(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            ),
        };
        HttpResponse::build(status).json(json!({ "error": msg }))
    }
}
