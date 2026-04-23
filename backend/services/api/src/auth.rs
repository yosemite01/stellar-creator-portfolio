//! JWT authentication middleware for Actix-web.
//!
//! Protected routes must carry a `Bearer <token>` header.
//! The secret is read from the `JWT_SECRET` environment variable
//! (falls back to `"stellar-dev-secret"` in development).

use actix_web::{
    body::{BoxBody, MessageBody},
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpMessage, HttpResponse,
};
use futures::future::{ok, LocalBoxFuture, Ready};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use std::rc::Rc;

use crate::{ApiError, ApiErrorCode, ApiResponse};

// ── Claims ────────────────────────────────────────────────────────────────────

/// JWT payload stored inside every access token.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Claims {
    /// Subject — typically the user's wallet address or UUID.
    pub sub: String,
    /// Expiry (Unix timestamp).
    pub exp: u64,
    /// Role: `"creator"`, `"freelancer"`, or `"admin"`.
    pub role: String,
}

// ── Validation helper ─────────────────────────────────────────────────────────

fn jwt_secret() -> String {
    std::env::var("JWT_SECRET").unwrap_or_else(|_| "stellar-dev-secret".to_string())
}

/// Decode and validate a raw JWT string.
/// Returns `Claims` on success or an error message on failure.
pub fn validate_token(token: &str) -> Result<Claims, String> {
    let key = DecodingKey::from_secret(jwt_secret().as_bytes());
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.leeway = 0;

    decode::<Claims>(token, &key, &validation)
        .map(|data| data.claims)
        .map_err(|e| e.to_string())
}

// ── Middleware factory ────────────────────────────────────────────────────────

/// Wrap a route scope with `JwtMiddleware` to require a valid Bearer token.
///
/// ```rust,ignore
/// web::scope("/api/protected")
///     .wrap(JwtMiddleware)
///     .route(...)
/// ```
pub struct JwtMiddleware;

impl<S, B> Transform<S, ServiceRequest> for JwtMiddleware
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Transform = JwtMiddlewareService<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(JwtMiddlewareService { service: Rc::new(service) })
    }
}

pub struct JwtMiddlewareService<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for JwtMiddlewareService<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let svc = Rc::clone(&self.service);

        let token_result = req
            .headers()
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|t| validate_token(t))
            .unwrap_or(Err("Missing Authorization header".to_string()));

        Box::pin(async move {
            match token_result {
                Ok(claims) => {
                    req.extensions_mut().insert(claims);
                    svc.call(req).await.map(|r| r.map_into_boxed_body())
                }
                Err(reason) => {
                    tracing::warn!("JWT auth failed: {}", reason);
                    let body = ApiResponse::<()>::err(ApiError::new(
                        ApiErrorCode::Unauthorized,
                        "Invalid or missing token",
                    ));
                    let http_resp = HttpResponse::Unauthorized().json(body);
                    Ok(req.into_response(http_resp).map_into_boxed_body())
                }
            }
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub mod tests {
    use super::*;
    use actix_web::{test as awtest, web, App, HttpRequest, HttpResponse};
    use jsonwebtoken::{encode, EncodingKey, Header};

    /// Generate a signed token for tests (uses the dev secret).
    pub fn make_token(sub: &str, role: &str, exp_offset_secs: i64) -> String {
        let exp = (chrono_exp(exp_offset_secs)) as u64;
        let claims = Claims { sub: sub.to_string(), exp, role: role.to_string() };
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(b"stellar-dev-secret"),
        )
        .unwrap()
    }

    fn chrono_exp(offset: i64) -> u64 {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        (now + offset).max(0) as u64
    }

    async fn protected_handler(_req: HttpRequest) -> HttpResponse {
        HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
    }

    // ── validate_token unit tests ─────────────────────────────────────────────

    #[test]
    fn valid_token_decodes_claims() {
        std::env::remove_var("JWT_SECRET");
        let token = make_token("user-1", "creator", 3600);
        let claims = validate_token(&token).unwrap();
        assert_eq!(claims.sub, "user-1");
        assert_eq!(claims.role, "creator");
    }

    #[test]
    fn expired_token_is_rejected() {
        std::env::remove_var("JWT_SECRET");
        let token = make_token("user-1", "creator", -10); // already expired
        assert!(validate_token(&token).is_err());
    }

    #[test]
    fn tampered_token_is_rejected() {
        std::env::remove_var("JWT_SECRET");
        let token = make_token("user-1", "creator", 3600);
        let tampered = format!("{}x", token);
        assert!(validate_token(&tampered).is_err());
    }

    #[test]
    fn wrong_secret_is_rejected() {
        let token = {
            let claims = Claims {
                sub: "user-1".to_string(),
                exp: 9_999_999_999,
                role: "creator".to_string(),
            };
            encode(
                &Header::default(),
                &claims,
                &EncodingKey::from_secret(b"wrong-secret"),
            )
            .unwrap()
        };
        std::env::remove_var("JWT_SECRET");
        assert!(validate_token(&token).is_err());
    }

    // ── middleware integration tests ──────────────────────────────────────────

    #[actix_web::test]
    async fn valid_bearer_token_passes_middleware() {
        std::env::remove_var("JWT_SECRET");
        let token = make_token("user-1", "creator", 3600);

        let app = awtest::init_service(
            App::new()
                .service(
                    web::scope("/protected")
                        .wrap(JwtMiddleware)
                        .route("", web::get().to(protected_handler)),
                ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/protected")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);
    }

    #[actix_web::test]
    async fn missing_token_returns_401() {
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(
            App::new().service(
                web::scope("/protected")
                    .wrap(JwtMiddleware)
                    .route("", web::get().to(protected_handler)),
            ),
        )
        .await;

        let req = awtest::TestRequest::get().uri("/protected").to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn expired_token_returns_401() {
        std::env::remove_var("JWT_SECRET");
        let token = make_token("user-1", "creator", -60);

        let app = awtest::init_service(
            App::new().service(
                web::scope("/protected")
                    .wrap(JwtMiddleware)
                    .route("", web::get().to(protected_handler)),
            ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/protected")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn invalid_token_returns_401_with_error_body() {
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(
            App::new().service(
                web::scope("/protected")
                    .wrap(JwtMiddleware)
                    .route("", web::get().to(protected_handler)),
            ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/protected")
            .insert_header(("Authorization", "Bearer not.a.jwt"))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"]["code"], "UNAUTHORIZED");
    }

    #[actix_web::test]
    async fn claims_are_injected_into_request_extensions() {
        std::env::remove_var("JWT_SECRET");
        let token = make_token("wallet-abc", "freelancer", 3600);

        async fn claims_handler(req: HttpRequest) -> HttpResponse {
            let claims = req.extensions().get::<Claims>().cloned().unwrap();
            HttpResponse::Ok().json(serde_json::json!({
                "sub": claims.sub,
                "role": claims.role,
            }))
        }

        let app = awtest::init_service(
            App::new().service(
                web::scope("/protected")
                    .wrap(JwtMiddleware)
                    .route("", web::get().to(claims_handler)),
            ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/protected")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["sub"], "wallet-abc");
        assert_eq!(json["role"], "freelancer");
    }
}
