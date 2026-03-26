use actix_web::{web, HttpRequest, HttpResponse};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::config::Config;
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

fn extract_mint_header(req: &HttpRequest) -> Option<&str> {
    req.headers()
        .get("x-mint-secret")
        .and_then(|v| v.to_str().ok())
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
