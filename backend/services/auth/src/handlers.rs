use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{Duration, Utc};
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointNotSet, EndpointSet, RedirectUrl, Scope,
    TokenResponse, TokenUrl,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::config::{Config, OAuthProvider, OAuthProviderConfig};
use crate::db;
use crate::error::AuthError;
use crate::tokens::{generate_refresh_token, hash_refresh_token, sign_access_token};

#[derive(Deserialize)]
pub struct MintTokenRequest {
    pub user_id: String,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct OAuthTokenRequest {
    pub code: String,
    #[serde(default)]
    pub redirect_uri: Option<String>,
}

#[derive(Deserialize)]
pub struct OAuthAuthorizeRequest {
    #[serde(default)]
    pub redirect_uri: Option<String>,
}

/// An oauth2 v5 client with the auth and token endpoints configured.
type OAuthClient = BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;

/// HTTP client for the token exchange. Redirects are disabled, as oauth2
/// recommends, so a provider response cannot bounce the request (and the
/// client secret) to another host.
fn oauth_http_client() -> Result<oauth2::reqwest::Client, AuthError> {
    oauth2::reqwest::Client::builder()
        .redirect(oauth2::reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))
}

fn build_oauth_client(
    provider: OAuthProvider,
    config: &OAuthProviderConfig,
    redirect_uri: &str,
) -> Result<OAuthClient, AuthError> {
    let (auth_url, token_url, _scopes) = match provider {
        OAuthProvider::Google => (
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            vec!["openid", "email", "profile"],
        ),
        OAuthProvider::GitHub => (
            "https://github.com/login/oauth/authorize",
            "https://github.com/login/oauth/access_token",
            vec!["read:user", "user:email"],
        ),
        OAuthProvider::Twitter => (
            "https://twitter.com/i/oauth2/authorize",
            "https://api.twitter.com/2/oauth2/token",
            vec!["tweet.read", "users.read", "offline.access"],
        ),
    };

    let client = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_client_secret(ClientSecret::new(config.client_secret.clone()))
        .set_auth_uri(AuthUrl::new(auth_url.to_string()).map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?)
        .set_token_uri(TokenUrl::new(token_url.to_string()).map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?)
        .set_redirect_uri(
            RedirectUrl::new(redirect_uri.to_string()).map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?,
        );

    Ok(client)
}

async fn fetch_oauth_user_id(provider: OAuthProvider, access_token: &str) -> Result<String, AuthError> {
    let client = reqwest::Client::new();
    match provider {
        OAuthProvider::Google => {
            #[derive(serde::Deserialize)]
            struct GoogleProfile {
                sub: String,
                #[allow(dead_code)]
                email: Option<String>,
            }
            let profile: GoogleProfile = client
                .get("https://openidconnect.googleapis.com/v1/userinfo")
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?
                .error_for_status()
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?
                .json::<GoogleProfile>()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?;
            Ok(format!("google:{}", profile.sub))
        }
        OAuthProvider::GitHub => {
            #[derive(serde::Deserialize)]
            struct GitHubProfile {
                id: u64,
                #[allow(dead_code)]
                login: Option<String>,
            }
            let profile: GitHubProfile = client
                .get("https://api.github.com/user")
                .bearer_auth(access_token)
                .header("User-Agent", "stellar-auth")
                .header("Accept", "application/vnd.github+json")
                .send()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?
                .error_for_status()
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?
                .json::<GitHubProfile>()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?;
            Ok(format!("github:{}", profile.id))
        }
        OAuthProvider::Twitter => {
            #[derive(serde::Deserialize)]
            struct TwitterData {
                id: String,
                #[allow(dead_code)]
                username: Option<String>,
            }
            #[derive(serde::Deserialize)]
            struct TwitterProfile {
                data: TwitterData,
            }
            let profile: TwitterProfile = client
                .get("https://api.twitter.com/2/users/me?user.fields=username")
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?
                .error_for_status()
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?
                .json::<TwitterProfile>()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?;
            Ok(format!("twitter:{}", profile.data.id))
        }
    }
}

fn extract_mint_header(req: &HttpRequest) -> Option<&str> {
    req.headers()
        .get("x-mint-secret")
        .and_then(|v| v.to_str().ok())
}

async fn mint_tokens_for_user(
    user_id: &str,
    config: &Config,
    pool: &sqlx::PgPool,
) -> Result<HttpResponse, AuthError> {
    let family_id = Uuid::new_v4();
    let refresh_plain = generate_refresh_token();
    let refresh_hash = hash_refresh_token(&refresh_plain);
    let row_id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::seconds(config.refresh_ttl_secs as i64);

    db::insert_refresh_token(pool, row_id, user_id, &refresh_hash, family_id, expires_at).await?;

    let access = sign_access_token(
        user_id,
        family_id,
        &config.jwt_secret,
        Duration::seconds(config.access_ttl_secs as i64),
    )?;

    Ok(HttpResponse::Ok().json(json!({
        "access_token": access,
        "refresh_token": refresh_plain,
        "token_type": "Bearer",
        "expires_in": config.access_ttl_secs
    })))
}

pub async fn health() -> HttpResponse {
    HttpResponse::Ok().json(json!({
        "status": "healthy",
        "service": "stellar-auth",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

pub async fn mint_tokens(
    req: HttpRequest,
    config: web::Data<Config>,
    pool: web::Data<sqlx::PgPool>,
    body: web::Json<MintTokenRequest>,
) -> Result<HttpResponse, AuthError> {
    let header = extract_mint_header(&req);
    if !config.mint_allowed(header) {
        return Err(if config.mint_secret.is_none() && !config.dev_mint_allow {
            AuthError::MintNotConfigured
        } else {
            AuthError::MintUnauthorized
        });
    }

    let family_id = Uuid::new_v4();
    let refresh_plain = generate_refresh_token();
    let refresh_hash = hash_refresh_token(&refresh_plain);
    let row_id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::seconds(config.refresh_ttl_secs as i64);

    db::insert_refresh_token(
        pool.get_ref(),
        row_id,
        &body.user_id,
        &refresh_hash,
        family_id,
        expires_at,
    )
    .await?;

    let access = sign_access_token(
        &body.user_id,
        family_id,
        &config.jwt_secret,
        Duration::seconds(config.access_ttl_secs as i64),
    )?;

    Ok(HttpResponse::Ok().json(json!({
        "access_token": access,
        "refresh_token": refresh_plain,
        "token_type": "Bearer",
        "expires_in": config.access_ttl_secs
    })))
}

pub async fn oauth2_token_exchange(
    provider_path: web::Path<String>,
    body: web::Json<OAuthTokenRequest>,
    config: web::Data<Config>,
    pool: web::Data<sqlx::PgPool>,
) -> Result<HttpResponse, AuthError> {
    let provider = OAuthProvider::from_str(provider_path.as_str())
        .ok_or_else(|| AuthError::InvalidOAuthProvider(provider_path.into_inner()))?;

    let provider_config = config
        .oauth_provider_config(provider)
        .ok_or_else(|| AuthError::OAuthProviderNotConfigured(provider.to_string()))?;

    let redirect_uri = body
        .redirect_uri
        .clone()
        .unwrap_or_else(|| provider_config.redirect_uri.clone());

    let client = build_oauth_client(provider, provider_config, redirect_uri.as_str())?;

    let token = client
        .exchange_code(AuthorizationCode::new(body.code.clone()))
        .request_async(&oauth_http_client()?)
        .await
        .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?;

    let user_id = fetch_oauth_user_id(provider, token.access_token().secret()).await?;

    mint_tokens_for_user(&user_id, &config, pool.get_ref()).await
}

pub async fn oauth2_authorize(
    provider_path: web::Path<String>,
    query: web::Query<OAuthAuthorizeRequest>,
    config: web::Data<Config>,
) -> Result<HttpResponse, AuthError> {
    let provider = OAuthProvider::from_str(provider_path.as_str())
        .ok_or_else(|| AuthError::InvalidOAuthProvider(provider_path.into_inner()))?;

    let provider_config = config
        .oauth_provider_config(provider)
        .ok_or_else(|| AuthError::OAuthProviderNotConfigured(provider.to_string()))?;

    let redirect_uri = query
        .redirect_uri
        .clone()
        .unwrap_or_else(|| provider_config.redirect_uri.clone());

    let client = build_oauth_client(provider, provider_config, redirect_uri.as_str())?;

    let scopes = match provider {
        OAuthProvider::Google => vec!["openid", "email", "profile"],
        OAuthProvider::GitHub => vec!["read:user", "user:email"],
        OAuthProvider::Twitter => vec!["tweet.read", "users.read", "offline.access"],
    };

    let mut auth_request = client.authorize_url(CsrfToken::new_random);
    for scope in scopes {
        auth_request = auth_request.add_scope(Scope::new(scope.to_string()));
    }
    
    let (authorize_url, csrf_state) = auth_request.url();

    Ok(HttpResponse::Ok().json(json!({
        "authorization_url": authorize_url.to_string(),
        "csrf_state": csrf_state.secret(),
    })))
}

pub async fn refresh_tokens(
    config: web::Data<Config>,
    pool: web::Data<sqlx::PgPool>,
    body: web::Json<RefreshRequest>,
) -> Result<HttpResponse, AuthError> {
    let old_hash = hash_refresh_token(&body.refresh_token);
    let new_plain = generate_refresh_token();
    let new_hash = hash_refresh_token(&new_plain);
    let new_id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::seconds(config.refresh_ttl_secs as i64);

    let (user_id, family_id) =
        db::rotate_refresh_token(pool.get_ref(), &old_hash, new_id, &new_hash, expires_at).await?;

    let access = sign_access_token(
        &user_id,
        family_id,
        &config.jwt_secret,
        Duration::seconds(config.access_ttl_secs as i64),
    )?;

    Ok(HttpResponse::Ok().json(json!({
        "access_token": access,
        "refresh_token": new_plain,
        "token_type": "Bearer",
        "expires_in": config.access_ttl_secs
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test as awtest, App};
    use sqlx::postgres::PgPoolOptions;

    fn test_config() -> Config {
        Config {
            host: "127.0.0.1".to_string(),
            port: 8080,
            database_url: "postgres://localhost/test".to_string(),
            jwt_secret: "01234567890123456789012345678901".to_string(),
            access_ttl_secs: 900,
            refresh_ttl_secs: 604_800,
            mint_secret: None,
            dev_mint_allow: true,
            google_oauth: None,
            github_oauth: None,
            twitter_oauth: None,
        }
    }

    /// A pool that never actually connects — safe to pass into handlers whose
    /// code path under test returns before touching the database.
    fn lazy_pool() -> sqlx::PgPool {
        PgPoolOptions::new()
            .connect_lazy("postgres://user:pass@localhost/does-not-matter")
            .expect("lazy pool construction never touches the network")
    }

    /// Connects to `DATABASE_URL` and ensures the `refresh_tokens` table
    /// exists; returns `None` (causing callers to skip) when unreachable, since
    /// CI does not run a Postgres instance for this crate. Run against a real
    /// database locally via `backend/docker-compose.yml`.
    async fn live_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPoolOptions::new().max_connections(1).connect(&url).await.ok()?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id UUID PRIMARY KEY,
                user_id TEXT NOT NULL,
                token_hash BYTEA NOT NULL UNIQUE,
                family_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        )
        .execute(&pool)
        .await
        .ok()?;
        Some(pool)
    }

    // ---- pure / DB-independent ----

    #[test]
    fn extract_mint_header_reads_custom_header() {
        let req = awtest::TestRequest::default()
            .insert_header(("x-mint-secret", "shh"))
            .to_http_request();
        assert_eq!(extract_mint_header(&req), Some("shh"));
    }

    #[test]
    fn extract_mint_header_missing_is_none() {
        let req = awtest::TestRequest::default().to_http_request();
        assert_eq!(extract_mint_header(&req), None);
    }

    #[actix_web::test]
    async fn health_reports_service_metadata() {
        let resp = health().await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);
        let body = actix_web::body::to_bytes(resp.into_body()).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["service"], "stellar-auth");
        assert_eq!(json["status"], "healthy");
    }

    #[test]
    fn build_oauth_client_succeeds_for_every_known_provider() {
        let cfg = OAuthProviderConfig {
            client_id: "id".to_string(),
            client_secret: "secret".to_string(),
            redirect_uri: "https://example.com/callback".to_string(),
        };
        for provider in [OAuthProvider::Google, OAuthProvider::GitHub, OAuthProvider::Twitter] {
            assert!(build_oauth_client(provider, &cfg, "https://example.com/callback").is_ok());
        }
    }

    #[test]

    fn build_oauth_client_rejects_an_invalid_redirect_uri() {
        let cfg = OAuthProviderConfig {
            client_id: "id".to_string(),
            client_secret: "secret".to_string(),
            redirect_uri: "https://example.com/callback".to_string(),
        };
        let result = build_oauth_client(OAuthProvider::Google, &cfg, "not a url");
        assert!(matches!(result, Err(AuthError::OAuthFlowFailed(_))));
    }

    #[actix_web::test]
    async fn mint_tokens_rejects_when_not_configured() {
        let mut cfg = test_config();
        cfg.dev_mint_allow = false;
        cfg.mint_secret = None;
        let req = awtest::TestRequest::default().to_http_request();
        let result = mint_tokens(
            req,
            web::Data::new(cfg),
            web::Data::new(lazy_pool()),
            web::Json(MintTokenRequest { user_id: "u1".to_string() }),
        )
        .await;
        assert!(matches!(result, Err(AuthError::MintNotConfigured)));
    }

    #[actix_web::test]
    async fn mint_tokens_rejects_a_wrong_mint_secret() {
        let mut cfg = test_config();
        cfg.dev_mint_allow = false;
        cfg.mint_secret = Some("correct-secret".to_string());
        let req = awtest::TestRequest::default()
            .insert_header(("x-mint-secret", "wrong"))
            .to_http_request();
        let result = mint_tokens(
            req,
            web::Data::new(cfg),
            web::Data::new(lazy_pool()),
            web::Json(MintTokenRequest { user_id: "u1".to_string() }),
        )
        .await;
        assert!(matches!(result, Err(AuthError::MintUnauthorized)));
    }

    #[actix_web::test]
    async fn oauth2_token_exchange_rejects_an_unknown_provider() {
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_config()))
                .app_data(web::Data::new(lazy_pool()))
                .route("/oauth/{provider}/token", web::post().to(oauth2_token_exchange)),
        )
        .await;

        let req = awtest::TestRequest::post()
            .uri("/oauth/not-a-provider/token")
            .set_json(serde_json::json!({ "code": "x" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
    }

    #[actix_web::test]
    async fn oauth2_authorize_rejects_an_unconfigured_provider() {
        // test_config() leaves github_oauth as None.
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_config()))
                .route("/oauth/{provider}/authorize", web::get().to(oauth2_authorize)),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/oauth/github/authorize")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::SERVICE_UNAVAILABLE);
    }

    // ---- integration against a real Postgres (skips if DATABASE_URL is unset/unreachable) ----

    #[actix_web::test]
    async fn mint_then_refresh_rotates_the_token_and_rejects_reuse() {
        let Some(pool) = live_pool().await else {
            eprintln!("skipping: DATABASE_URL not set/unreachable (see backend/docker-compose.yml)");
            return;
        };
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_config()))
                .app_data(web::Data::new(pool))
                .route("/token", web::post().to(mint_tokens))
                .route("/refresh", web::post().to(refresh_tokens)),
        )
        .await;

        let mint_req = awtest::TestRequest::post()
            .uri("/token")
            .set_json(serde_json::json!({ "user_id": "integration-user" }))
            .to_request();
        let mint_resp = awtest::call_service(&app, mint_req).await;
        assert_eq!(mint_resp.status(), actix_web::http::StatusCode::OK);
        let mint_body: serde_json::Value = awtest::read_body_json(mint_resp).await;
        let refresh_token = mint_body["refresh_token"].as_str().unwrap().to_string();

        let refresh_req = awtest::TestRequest::post()
            .uri("/refresh")
            .set_json(serde_json::json!({ "refresh_token": refresh_token }))
            .to_request();
        let refresh_resp = awtest::call_service(&app, refresh_req).await;
        assert_eq!(refresh_resp.status(), actix_web::http::StatusCode::OK);
        let refresh_body: serde_json::Value = awtest::read_body_json(refresh_resp).await;
        let new_refresh = refresh_body["refresh_token"].as_str().unwrap();
        assert_ne!(new_refresh, refresh_token, "refresh must rotate the token");

        // The rotated-away (now effectively revoked) token must be rejected —
        // this is the "revoked/expired refresh" regression this file had zero
        // coverage for.
        let reuse_req = awtest::TestRequest::post()
            .uri("/refresh")
            .set_json(serde_json::json!({ "refresh_token": refresh_token }))
            .to_request();
        let reuse_resp = awtest::call_service(&app, reuse_req).await;
        assert_eq!(reuse_resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn refresh_with_a_bogus_token_is_unauthorized() {
        let Some(pool) = live_pool().await else {
            eprintln!("skipping: DATABASE_URL not set/unreachable (see backend/docker-compose.yml)");
            return;
        };
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_config()))
                .app_data(web::Data::new(pool))
                .route("/refresh", web::post().to(refresh_tokens)),
        )
        .await;

        let req = awtest::TestRequest::post()
            .uri("/refresh")
            .set_json(serde_json::json!({ "refresh_token": "not-a-real-token" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }
}
