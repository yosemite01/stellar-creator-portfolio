use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{Duration, Utc};
use oauth2::basic::BasicClient;
use oauth2::reqwest::async_http_client;
use oauth2::{AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, RedirectUrl, Scope, TokenResponse, TokenUrl};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
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
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

pub async fn register(
    pool: web::Data<PgPool>,
    config: web::Data<Config>,
    body: web::Json<RegisterRequest>,
) -> Result<HttpResponse, AuthError> {
    if db::find_user_by_email(pool.get_ref(), &body.email).await?.is_some() {
        return Err(AuthError::EmailAlreadyInUse);
    }

    let salt = bcrypt::DEFAULT_COST;
    let password_hash = bcrypt::hash(&body.password, salt).map_err(|_| AuthError::InternalError)?;

    let user = db::create_user(
        pool.get_ref(),
        &body.email,
        Some(&password_hash),
        body.display_name.as_deref(),
        None,
        None,
        None,
    )
    .await?;

    mint_tokens_for_user(&user.id.to_string(), &config, pool.get_ref()).await
}

pub async fn login(
    pool: web::Data<PgPool>,
    config: web::Data<Config>,
    body: web::Json<LoginRequest>,
) -> Result<HttpResponse, AuthError> {
    let user = db::find_user_by_email(pool.get_ref(), &body.email)
        .await?
        .ok_or(AuthError::InvalidCredentials)?;

    let password_hash = user.password_hash.ok_or(AuthError::InvalidCredentials)?;
    if !bcrypt::verify(&body.password, &password_hash).map_err(|_| AuthError::InternalError)? {
        return Err(AuthError::InvalidCredentials);
    }

    mint_tokens_for_user(&user.id.to_string(), &config, pool.get_ref()).await
}

#[derive(Deserialize)]
pub struct OAuthAuthorizeRequest {
    #[serde(default)]
    pub redirect_uri: Option<String>,
}

fn build_oauth_client(
    provider: OAuthProvider,
    config: &OAuthProviderConfig,
    redirect_uri: &str,
) -> Result<BasicClient, AuthError> {
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

    let client = BasicClient::new(
        ClientId::new(config.client_id.clone()),
        Some(ClientSecret::new(config.client_secret.clone())),
        AuthUrl::new(auth_url.to_string()).map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?,
        Some(TokenUrl::new(token_url.to_string()).map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?),
    )
    .set_redirect_uri(
        RedirectUrl::new(redirect_uri.to_string()).map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?,
    );

    // No add_scope here, we'll add them when building the authorize_url
    Ok(client)
}

async fn fetch_oauth_user_id(provider: OAuthProvider, access_token: &str) -> Result<String, AuthError> {
    let client = reqwest::Client::new();
    match provider {
        OAuthProvider::Google => {
            #[derive(serde::Deserialize)]
            struct GoogleProfile {
                sub: String,
                _email: Option<String>,
            }
            let profile: GoogleProfile = client
                .get("https://openidconnect.googleapis.com/v1/userinfo")
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?
                .error_for_status()
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?
                .json()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?;
            Ok(format!("google:{}", profile.sub))
        }
        OAuthProvider::GitHub => {
            #[derive(serde::Deserialize)]
            struct GitHubProfile {
                id: u64,
                _login: Option<String>,
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
                .json()
                .await
                .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?;
            Ok(format!("github:{}", profile.id))
        }
        OAuthProvider::Twitter => {
            #[derive(serde::Deserialize)]
            struct TwitterData {
                id: String,
                _username: Option<String>,
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
                .json()
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

fn extract_auth_claims(req: &HttpRequest, config: &Config) -> Result<crate::tokens::AccessClaims, AuthError> {
    let auth_header = req.headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or(AuthError::InternalError)?; // Or a more specific error

    if !auth_header.starts_with("Bearer ") {
        return Err(AuthError::InternalError);
    }

    let token = &auth_header[7..];
    crate::tokens::verify_access_token(token, &config.jwt_secret)
        .map_err(|_| AuthError::InternalError)
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
    provider: web::Path<String>,
    body: web::Json<OAuthTokenRequest>,
    config: web::Data<Config>,
    pool: web::Data<sqlx::PgPool>,
) -> Result<HttpResponse, AuthError> {
    let provider = OAuthProvider::from_str(provider.as_str())
        .ok_or_else(|| AuthError::InvalidOAuthProvider(provider.into_inner()))?;

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
        .request_async(async_http_client)
        .await
        .map_err(|e| AuthError::OAuthFlowFailed(e.to_string()))?;

    let oauth_id = fetch_oauth_user_id(provider, token.access_token().secret()).await?;

    // Check if user exists, if not create one
    let provider_name = provider.to_string();
    let user = match db::find_user_by_oauth(pool.get_ref(), &provider_name, &oauth_id).await? {
        Some(u) => u,
        None => {
            // For OAuth users, we might not have an email immediately or we use the oauth_id as email placeholder
            // Ideally we should fetch email from the profile if available
            db::create_user(
                pool.get_ref(),
                &format!("{}@{}", oauth_id, provider_name),
                None,
                None,
                None,
                Some(&provider_name),
                Some(&oauth_id),
            )
            .await?
        }
    };

    mint_tokens_for_user(&user.id.to_string(), &config, pool.get_ref()).await
}

pub async fn oauth2_authorize(
    provider: web::Path<String>,
    query: web::Query<OAuthAuthorizeRequest>,
    config: web::Data<Config>,
) -> Result<HttpResponse, AuthError> {
    let provider = OAuthProvider::from_str(provider.as_str())
        .ok_or_else(|| AuthError::InvalidOAuthProvider(provider.into_inner()))?;

    let provider_config = config
        .oauth_provider_config(provider)
        .ok_or_else(|| AuthError::OAuthProviderNotConfigured(provider.to_string()))?;

    let redirect_uri = query
        .redirect_uri
        .clone()
        .unwrap_or_else(|| provider_config.redirect_uri.clone());

    let client = build_oauth_client(provider, provider_config, redirect_uri.as_str())?;
    
    let mut request = client.authorize_url(CsrfToken::new_random);
    
    // Add scopes here based on the provider
    let scopes = match provider {
        OAuthProvider::Google => vec!["openid", "email", "profile"],
        OAuthProvider::GitHub => vec!["read:user", "user:email"],
        OAuthProvider::Twitter => vec!["tweet.read", "users.read", "offline.access"],
    };
    
    for scope in scopes {
        request = request.add_scope(Scope::new(scope.to_string()));
    }

    let (authorize_url, csrf_state) = request.url();

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

pub async fn logout(
    pool: web::Data<PgPool>,
    body: web::Json<RefreshRequest>,
) -> Result<HttpResponse, AuthError> {
    let hash = hash_refresh_token(&body.refresh_token);
    db::delete_refresh_token(pool.get_ref(), &hash).await?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn logout_all(
    req: HttpRequest,
    config: web::Data<Config>,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, AuthError> {
    let claims = extract_auth_claims(&req, &config)?;
    db::delete_all_user_refresh_tokens(pool.get_ref(), &claims.sub).await?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn get_me(
    req: HttpRequest,
    config: web::Data<Config>,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, AuthError> {
    let claims = extract_auth_claims(&req, &config)?;
    let user_uuid = Uuid::parse_str(&claims.sub).map_err(|_| AuthError::InternalError)?;
    let user = db::find_user_by_id(pool.get_ref(), user_uuid)
        .await?
        .ok_or(AuthError::UserNotFound)?;

    Ok(HttpResponse::Ok().json(user))
}

pub async fn update_profile(
    req: HttpRequest,
    config: web::Data<Config>,
    pool: web::Data<PgPool>,
    body: web::Json<UpdateProfileRequest>,
) -> Result<HttpResponse, AuthError> {
    let claims = extract_auth_claims(&req, &config)?;
    let user_uuid = Uuid::parse_str(&claims.sub).map_err(|_| AuthError::InternalError)?;
    
    let user = db::update_user_profile(
        pool.get_ref(),
        user_uuid,
        body.display_name.as_deref(),
        body.avatar_url.as_deref(),
    )
    .await?;

    Ok(HttpResponse::Ok().json(user))
}

pub async fn change_password(
    req: HttpRequest,
    config: web::Data<Config>,
    pool: web::Data<PgPool>,
    body: web::Json<ChangePasswordRequest>,
) -> Result<HttpResponse, AuthError> {
    let claims = extract_auth_claims(&req, &config)?;
    let user_uuid = Uuid::parse_str(&claims.sub).map_err(|_| AuthError::InternalError)?;
    
    let user = db::find_user_by_id(pool.get_ref(), user_uuid)
        .await?
        .ok_or(AuthError::UserNotFound)?;

    let password_hash = user.password_hash.ok_or(AuthError::InvalidCredentials)?;
    if !bcrypt::verify(&body.current_password, &password_hash).map_err(|_| AuthError::InternalError)? {
        return Err(AuthError::InvalidCredentials);
    }

    let salt = bcrypt::DEFAULT_COST;
    let new_hash = bcrypt::hash(&body.new_password, salt).map_err(|_| AuthError::InternalError)?;

    db::update_user_password(pool.get_ref(), user_uuid, &new_hash).await?;
    
    // Invalidate all sessions on password change for security
    db::delete_all_user_refresh_tokens(pool.get_ref(), &claims.sub).await?;

    Ok(HttpResponse::Ok().json(json!({ "message": "password changed successfully" })))
}
