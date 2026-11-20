use actix_web::{HttpResponse, ResponseError};
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("invalid or expired refresh token")]
    InvalidRefreshToken,
    #[error("refresh token reuse detected — all sessions for this user have been revoked")]
    TokenReuseDetected,
    #[error("access token has been revoked")]
    TokenRevoked,
    #[error(
        "mint not configured: set AUTH_MINT_SECRET or AUTH_DEV_MINT=1 for local development only"
    )]
    MintNotConfigured,
    #[error("unauthorized mint request")]
    MintUnauthorized,
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
    #[error("jwt error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("invalid OAuth provider: {0}")]
    InvalidOAuthProvider(String),
    #[error("OAuth provider not configured: {0}")]
    OAuthProviderNotConfigured(String),
    #[error("OAuth flow failed: {0}")]
    OAuthFlowFailed(String),
    #[error("JWKS error: {0}")]
    Jwks(String),
}

impl ResponseError for AuthError {
    fn error_response(&self) -> HttpResponse {
        let (status, msg) = match self {
            AuthError::InvalidRefreshToken => {
                (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string())
            }
            AuthError::TokenReuseDetected => {
                (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string())
            }
            AuthError::TokenRevoked => {
                (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string())
            }
            AuthError::MintNotConfigured => (
                actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
                self.to_string(),
            ),
            AuthError::MintUnauthorized => {
                (actix_web::http::StatusCode::UNAUTHORIZED, self.to_string())
            }
            AuthError::Db(_) => (
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
            AuthError::Jwks(_) => (
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to fetch JWKS".to_string(),
            ),
        };
        HttpResponse::build(status).json(json!({ "error": msg }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::body::to_bytes;
    use actix_web::http::StatusCode;

    async fn error_response_parts(err: AuthError) -> (StatusCode, serde_json::Value) {
        let resp = err.error_response();
        let status = resp.status();
        let body = to_bytes(resp.into_body()).await.expect("response body");
        let json: serde_json::Value = serde_json::from_slice(&body).expect("json body");
        (status, json)
    }

    #[actix_web::test]
    async fn invalid_refresh_token_is_unauthorized_and_generic() {
        let (status, json) = error_response_parts(AuthError::InvalidRefreshToken).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(json["error"], "invalid or expired refresh token");
    }

    #[actix_web::test]
    async fn mint_not_configured_is_service_unavailable() {
        let (status, _) = error_response_parts(AuthError::MintNotConfigured).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[actix_web::test]
    async fn mint_unauthorized_is_unauthorized() {
        let (status, json) = error_response_parts(AuthError::MintUnauthorized).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(json["error"], "unauthorized mint request");
    }

    #[actix_web::test]
    async fn db_error_maps_to_internal_error_without_leaking_details() {
        let (status, json) = error_response_parts(AuthError::Db(sqlx::Error::RowNotFound)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json["error"], "internal error");
        // The client must not learn that this was specifically a "row not found" —
        // that would leak whether a given token/user exists in the database.
        let msg = json["error"].as_str().unwrap().to_lowercase();
        assert!(!msg.contains("row"));
        assert!(!msg.contains("sqlx"));
    }

    #[actix_web::test]
    async fn jwt_error_maps_to_internal_error_without_leaking_details() {
        let jwt_err: jsonwebtoken::errors::Error =
            jsonwebtoken::errors::ErrorKind::InvalidToken.into();
        let (status, json) = error_response_parts(AuthError::Jwt(jwt_err)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json["error"], "internal error");
    }

    #[actix_web::test]
    async fn invalid_oauth_provider_is_bad_request() {
        let (status, json) =
            error_response_parts(AuthError::InvalidOAuthProvider("bogus".to_string())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["error"], "invalid OAuth provider: bogus");
    }

    #[actix_web::test]
    async fn oauth_provider_not_configured_is_service_unavailable() {
        let (status, _) = error_response_parts(AuthError::OAuthProviderNotConfigured(
            "github".to_string(),
        ))
        .await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[actix_web::test]
    async fn oauth_flow_failed_is_bad_gateway() {
        let (status, _) =
            error_response_parts(AuthError::OAuthFlowFailed("boom".to_string())).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
    }

    #[actix_web::test]
    async fn jwks_error_maps_to_internal_error() {
        let (status, json) = error_response_parts(AuthError::Jwks("test error".to_string())).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json["error"], "failed to fetch JWKS");
    }

    #[test]
    fn invalid_refresh_token_uses_one_generic_message_for_every_case() {
        // db::rotate_refresh_token returns this same variant whether the token is
        // unknown, expired, or already rotated away — callers can't distinguish
        // which case applies from the message alone.
        assert_eq!(
            AuthError::InvalidRefreshToken.to_string(),
            "invalid or expired refresh token"
        );
    }
}
