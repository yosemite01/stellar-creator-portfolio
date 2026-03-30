use actix_web::{HttpResponse, ResponseError};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("invalid or expired refresh token")]
    InvalidRefreshToken,
    #[error(
        "mint not configured: set AUTH_MINT_SECRET or AUTH_DEV_MINT=1 for local development only"
    )]
    MintNotConfigured,
    #[error("unauthorized mint request")]
    MintUnauthorized,
    #[error("jwt error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("invalid OAuth provider: {0}")]
    InvalidOAuthProvider(String),
    #[error("OAuth provider not configured: {0}")]
    OAuthProviderNotConfigured(String),
    #[error("OAuth2 flow failed: {0}")]
    OAuthFlowFailed(String),

    #[error("Email already in use")]
    EmailAlreadyInUse,

    #[error("Invalid email or password")]
    InvalidCredentials,

    #[error("User not found")]
    UserNotFound,

    #[error("Internal database error")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Internal server error")]
    InternalError,
}

impl ResponseError for AuthError {
    fn error_response(&self) -> HttpResponse {
        let (status, msg) = match self {
            AuthError::InvalidRefreshToken => {
                (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string())
            }
            AuthError::MintNotConfigured => (
                actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
                self.to_string(),
            ),
            AuthError::MintUnauthorized => {
                (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string())
            }
            AuthError::EmailAlreadyInUse => {
                (actix_web::http::StatusCode::CONFLICT, self.to_string())
            }
            AuthError::InvalidCredentials => {
                (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string())
            }
            AuthError::UserNotFound => (actix_web::http::StatusCode::NOT_FOUND, self.to_string()),
            AuthError::DatabaseError(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            ),
            AuthError::InternalError => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            ),
            AuthError::Jwt(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "internal error".to_string(),
            ),
            AuthError::InvalidOAuthProvider(_) => (
                actix_web::http::StatusCode::BAD_REQUEST,
                self.to_string(),
            ),
            AuthError::OAuthProviderNotConfigured(_) => (
                actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
                self.to_string(),
            ),
            AuthError::OAuthFlowFailed(_) => (
                actix_web::http::StatusCode::BAD_GATEWAY,
                self.to_string(),
            ),
        };
        HttpResponse::build(status).json(json!({ "error": msg }))
    }
}
