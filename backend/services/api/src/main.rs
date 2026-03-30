use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use deadpool_redis::{redis::AsyncCommands, Config as RedisConfig, Pool as RedisPool, Runtime};
use serde::{Deserialize, Serialize};
mod metrics;

use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{runtime, trace::{self, TracerProvider}, Resource};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Registry};

use actix_cors::Cors;
use actix_web::{
    dev::Server, http::StatusCode, middleware, web, App, HttpResponse, HttpServer, ResponseError,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::future::{pending, Future};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use actix_web::{http::StatusCode, middleware, web, App, HttpResponse, HttpServer, ResponseError};
use deadpool_redis::{redis::AsyncCommands, Config, Pool, Runtime};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use stellar_discovery::{create_discovery, ServiceInfo};
use utoipa::{OpenApi, ToSchema};
use utoipa_swagger_ui::SwaggerUi;
use uuid::Uuid;

pub mod middleware;
use middleware::{AuthMiddleware, AuthMiddlewareInner};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessClaims {
    pub sub: String,
    pub family_id: uuid::Uuid,
    pub exp: i64,
    pub iat: i64,
}

#[derive(thiserror::Error, Debug)]
pub enum AuthError {
    #[error("Missing or invalid Authorization header")]
    MissingHeader,
    #[error("Invalid JWT token")]
    InvalidToken(#[from] jsonwebtoken::errors::Error),
}

impl actix_web::ResponseError for AuthError {
    fn error_response(&self) -> HttpResponse {
        let response: ApiResponse<serde_json::Value> = ApiResponse::err(self.to_string());
        HttpResponse::Unauthorized().json(response)
    }
}

async fn get_claims(req: &actix_web::HttpRequest) -> Result<AccessClaims, AuthError> {
    let token = req.headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(AuthError::MissingHeader)?;

    let jwt_secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");
    let mut validation = Validation::default();
    validation.validate_exp = true;
    let claims = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &validation,
    )?
    .claims;

    Ok(claims)
}

use actix_web::dev::{Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::Error;
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, DecodingKey, Validation};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessClaims {
    pub sub: String,
    pub family_id: uuid::Uuid,
    pub exp: i64,
    pub iat: i64,
}

#[derive(thiserror::Error, Debug)]
pub enum AuthError {
    #[error("Missing or invalid Authorization header")]
    MissingHeader,
    #[error("Invalid JWT token")]
    InvalidToken(#[from] jsonwebtoken::errors::Error),
}

mod webhooks;

// ── Request / Response types ─────────────────────────────────────────────────
impl actix_web::ResponseError for AuthError {
    fn error_response(&self) -> HttpResponse {
        let response: ApiResponse<serde_json::Value> = ApiResponse::err(self.to_string());
        HttpResponse::Unauthorized().json(response)
    }
}

async fn get_claims(req: &actix_web::HttpRequest) -> Result<AccessClaims, AuthError> {
    let token = req.headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(AuthError::MissingHeader)?;

    let jwt_secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");
    let mut validation = Validation::default();
    validation.validate_exp = true;
    let claims = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &validation,
    )?
    .claims;

    Ok(claims)
}

#[derive(Clone, Serialize, Deserialize, Debug, ToSchema)]
pub struct BountyRequest {
    /// Stellar address of the bounty creator
    pub creator: String,
    pub title: String,
    pub description: String,
    /// Budget in stroops (1 XLM = 10_000_000 stroops)
    pub budget: i128,
    /// Unix timestamp for the deadline
    pub deadline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug, ToSchema)]
pub struct BountyApplication {
    pub bounty_id: u64,
    /// Stellar address of the applicant
    pub freelancer: String,
    pub proposal: String,
    pub proposed_budget: i128,
    /// Estimated timeline in days
    pub timeline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug, ToSchema)]
pub struct FreelancerRegistration {
    pub name: String,
    pub discipline: String,
    pub bio: String,
}

// Generic envelope — no ToSchema bound so it works with any Serialize T.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[derive(Clone, Serialize, Deserialize, Debug, ToSchema)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub message: Option<String>,
}

impl<T> ApiResponse<T> {
    fn ok(data: T, message: Option<String>) -> Self {
        Self { success: true, data: Some(data), error: None, message }
    }

    #[allow(dead_code)]
    fn err(error: String) -> Self
    where
        T: Default,
    {
        Self { success: false, data: None, error: Some(error), message: None }
    }
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("Invalid request: {0}")]
    BadRequest(String),
    #[error("Resource not found: {0}")]
    NotFound(String),
    #[error("Resource conflict: {0}")]
    Conflict(String),
    #[error("Database operation failed")]
    Database(#[source] sqlx::Error),
    #[error("Network operation failed")]
    Network(String),
    #[error("Contract invocation failed")]
    ContractInvocation(String),
    #[error("Failed to serialize response")]
    Serialization(#[from] serde_json::Error),
}

impl ApiError {
    fn status_code(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
            Self::Network(_) => StatusCode::BAD_GATEWAY,
            Self::ContractInvocation(_) => StatusCode::BAD_GATEWAY,
            Self::Serialization(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn public_message(&self) -> String {
        match self {
            Self::Database(_) => "A database error occurred".to_string(),
            Self::Network(_) => "A network error occurred".to_string(),
            Self::ContractInvocation(_) => "A contract invocation error occurred".to_string(),
            _ => self.to_string(),
        }
    }
}

impl ResponseError for ApiError {
    fn status_code(&self) -> StatusCode {
        ApiError::status_code(self)
    }

    fn error_response(&self) -> HttpResponse {
        if ApiError::status_code(self).is_server_error() {
            tracing::error!("API error response: {self}");
        } else {
            tracing::warn!("API client error response: {self}");
        }
        let response: ApiResponse<serde_json::Value> = ApiResponse::err(self.public_message());
        HttpResponse::build(ApiError::status_code(self)).json(response)
    }
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct BountyRecord {
    id: i64,
    creator: String,
    title: String,
    description: Option<String>,
    budget: i64,
    deadline: Option<i64>,
    status: String,
    created_at: Option<i64>,
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct ApplicationRecord {
    application_id: i64,
    bounty_id: i64,
    freelancer: String,
    proposal: Option<String>,
    proposed_budget: Option<i64>,
    timeline: Option<i64>,
    status: String,
    created_at: Option<i64>,
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct FreelancerRecord {
    address: String,
    name: String,
    discipline: String,
    bio: Option<String>,
    verified: bool,
    rating: f64,
    completed_projects: i64,
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct EscrowRecord {
    id: i64,
    payer_address: String,
    payee_address: String,
    amount: i64,
    status: String,
    release_condition: Option<String>,
    created_at: Option<i64>,
    released_at: Option<i64>,
}

fn value_response<T>(data: &T) -> Result<serde_json::Value, ApiError>
where
    T: Serialize,
{
    serde_json::to_value(data).map_err(ApiError::from)
}

fn parse_i64(value: i128, field: &str) -> Result<i64, ApiError> {
    i64::try_from(value)
        .map_err(|_| ApiError::BadRequest(format!("{field} is outside the supported range")))
}

fn parse_u64_to_i64(value: u64, field: &str) -> Result<i64, ApiError> {
    i64::try_from(value)
        .map_err(|_| ApiError::BadRequest(format!("{field} is outside the supported range")))
}

#[derive(Debug, PartialEq, Eq)]
enum ShutdownSignal {
    SigInt,
    SigTerm,
}

async fn select_shutdown_signal<SigInt, SigTerm>(sigint: SigInt, sigterm: SigTerm) -> ShutdownSignal
where
    SigInt: Future<Output = ()>,
    SigTerm: Future<Output = ()>,
{
    tokio::select! {
        _ = sigint => ShutdownSignal::SigInt,
        _ = sigterm => ShutdownSignal::SigTerm,
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    let signal = {
        use tokio::signal::unix::{signal, SignalKind};

        select_shutdown_signal(
            async {
                if let Err(error) = tokio::signal::ctrl_c().await {
                    tracing::error!(%error, "failed to listen for SIGINT");
                    pending::<()>().await;
                }
            },
            async {
                match signal(SignalKind::terminate()) {
                    Ok(mut sigterm) => {
                        sigterm.recv().await;
                    }
                    Err(error) => {
                        tracing::error!(%error, "failed to listen for SIGTERM");
                        pending::<()>().await;
                    }
                }
            },
        )
        .await
    };

    #[cfg(not(unix))]
    let signal = {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to listen for SIGINT");
            pending::<()>().await;
        }
        ShutdownSignal::SigInt
    };

    tracing::info!(
        ?signal,
        "shutdown signal received; starting graceful shutdown"
    );
}

fn configure_api_routes(cfg: &mut web::ServiceConfig, redis: deadpool_redis::Pool) {
    // ── Rate limit tiers ─────────────────────────────────────────────────────
    // Writes: 30 req / 60 s per IP
    let write_rl = RateLimit::new(
        redis.clone(),
        RateLimitConfig::new("api_write", 30, 60),
    );
    // Reads: 120 req / 60 s per IP
    let read_rl = RateLimit::new(
        redis.clone(),
        RateLimitConfig::new("api_read", 120, 60),
    );
    // Auth-adjacent / sensitive paths: 10 req / 60 s per IP
    let strict_rl = RateLimit::new(
        redis.clone(),
        RateLimitConfig::new("api_strict", 10, 60),
    );

    cfg
        // Health — no rate limit; monitoring tools poll this endpoint.
        .route("/health", web::get().to(health))

        // ── /api/v1 — versioned routes ────────────────────────────────────
        .service(
            web::scope("/api/v1")
                // Write endpoints
                .service(
                    web::scope("")
                        .wrap(write_rl)
                        .route("/bounties", web::post().to(create_bounty))
                        .route("/bounties/{id}/apply", web::post().to(apply_for_bounty))
                        .route("/freelancers/register", web::post().to(register_freelancer))
                        .route("/escrow/{id}/release", web::post().to(release_escrow)),
                )
                // Read endpoints
                .service(
                    web::scope("")
                        .wrap(read_rl)
                        .route("/bounties", web::get().to(list_bounties))
                        .route("/bounties/{id}", web::get().to(get_bounty))
                        .route("/freelancers", web::get().to(list_freelancers))
                        .route("/freelancers/{address}", web::get().to(get_freelancer))
                        .route("/escrow/{id}", web::get().to(get_escrow)),
                )
                // Webhook management
                .service(
                    web::scope("/webhooks")
                        .wrap(strict_rl)
                        .route("", web::post().to(webhooks::register_webhook))
                        .route("", web::get().to(webhooks::list_webhooks))
                        .route("/{id}", web::delete().to(webhooks::delete_webhook)),
                ),
        )

        // ── /api — unversioned redirects to /api/v1 (backward compat) ────
        .service(
            web::scope("/api")
                .route("/bounties",                  web::get().to(redirect_to_v1))
                .route("/bounties",                  web::post().to(redirect_to_v1))
                .route("/bounties/{tail:.*}",        web::route().to(redirect_to_v1))
                .route("/freelancers",               web::get().to(redirect_to_v1))
                .route("/freelancers/{tail:.*}",     web::route().to(redirect_to_v1))
                .route("/escrow/{tail:.*}",          web::route().to(redirect_to_v1))
                .route("/webhooks",                  web::get().to(redirect_to_v1))
                .route("/webhooks",                  web::post().to(redirect_to_v1))
                .route("/webhooks/{tail:.*}",        web::route().to(redirect_to_v1)),
        );
}

/// Redirect unversioned `/api/<path>` requests to `/api/v1/<path>` with 308
/// (Permanent Redirect, method-preserving) so existing clients keep working
/// while being nudged toward the versioned URL.
async fn redirect_to_v1(req: actix_web::HttpRequest) -> HttpResponse {
    let path = req.uri().path();
    // Replace the first `/api/` segment with `/api/v1/`
    let versioned = if let Some(rest) = path.strip_prefix("/api/") {
        format!("/api/v1/{rest}")
    } else {
        format!("/api/v1{path}")
    };
    let location = match req.uri().query() {
        Some(q) => format!("{versioned}?{q}"),
        None => versioned,
    };
    HttpResponse::PermanentRedirect()
        .insert_header(("Location", location))
        .finish()
}

fn build_http_server(
    listener: TcpListener,
    state: AppState,
    openapi: utoipa::openapi::OpenApi,
) -> std::io::Result<Server> {
    Ok(HttpServer::new(move || {
        let redis = state.redis.clone();
        App::new()
            .app_data(web::Data::new(state.clone()))
            .wrap(RequestId)
            .wrap(Cors::permissive())
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            .service(
                SwaggerUi::new("/swagger-ui/{_:.*}").url("/api-docs/openapi.json", openapi.clone()),
            )
            .configure(move |cfg| configure_api_routes(cfg, redis.clone()))
    })
    .shutdown_signal(shutdown_signal())
    .listen(listener)?
    .run())
}

/// Health check — verifies database, Redis, and Stellar RPC connectivity.
#[utoipa::path(
    get, path = "/health",
    responses(
        (status = 200, description = "Service and all dependencies are healthy"),
        (status = 503, description = "One or more dependencies are unavailable"),
    )
)]
async fn health(req: HttpRequest, state: web::Data<AppState>) -> HttpResponse {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());
    tracing::info!(request_id = %request_id, "Health check requested");

    // ── Database ping ────────────────────────────────────────────────────
    let db_status = match sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
    {
        Ok(_) => {
            tracing::debug!(request_id = %request_id, "Database ping OK");
            serde_json::json!({ "status": "ok" })
        }
        Err(e) => {
            tracing::error!(request_id = %request_id, error = %e, "Database ping failed");
            serde_json::json!({ "status": "error", "message": "database unreachable" })
        }
    };
    let db_healthy = db_status["status"] == "ok";

    // ── Redis ping ───────────────────────────────────────────────────────
    let redis_status = match state.redis.get().await {
        Ok(mut conn) => {
            match deadpool_redis::redis::cmd("PING")
                .query_async::<String>(&mut conn)
                .await
            {
                Ok(_) => {
                    tracing::debug!(request_id = %request_id, "Redis ping OK");
                    serde_json::json!({ "status": "ok" })
                }
                Err(e) => {
                    tracing::error!(request_id = %request_id, error = %e, "Redis PING command failed");
                    serde_json::json!({ "status": "error", "message": "redis ping failed" })
                }
            }
        }
        Err(e) => {
            tracing::error!(request_id = %request_id, error = %e, "Failed to acquire Redis connection");
            serde_json::json!({ "status": "error", "message": "redis connection unavailable" })
        }
    };
    let redis_healthy = redis_status["status"] == "ok";

    // ── Stellar RPC / contract status ────────────────────────────────────
    // We check reachability of the RPC node and whether contract IDs are configured.
    let contracts_configured = !state.bounty_contract_id.is_empty()
        && !state.escrow_contract_id.is_empty()
        && !state.freelancer_contract_id.is_empty();

    let rpc_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let rpc_body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getHealth"
    });

    let stellar_status = match rpc_client
        .post(&state.stellar_rpc_url)
        .json(&rpc_body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            tracing::debug!(request_id = %request_id, "Stellar RPC reachable");
            serde_json::json!({
                "status": "ok",
                "rpc_url": state.stellar_rpc_url,
                "contracts_configured": contracts_configured,
                "contracts": {
                    "bounty": if state.bounty_contract_id.is_empty() { "not_configured" } else { "configured" },
                    "escrow": if state.escrow_contract_id.is_empty() { "not_configured" } else { "configured" },
                    "freelancer": if state.freelancer_contract_id.is_empty() { "not_configured" } else { "configured" },
                }
            })
        }
        Ok(resp) => {
            tracing::warn!(
                request_id = %request_id,
                status = %resp.status(),
                "Stellar RPC returned non-success status"
            );
            serde_json::json!({
                "status": "degraded",
                "rpc_url": state.stellar_rpc_url,
                "message": format!("rpc returned status {}", resp.status()),
                "contracts_configured": contracts_configured,
            })
        }
        Err(e) => {
            tracing::error!(request_id = %request_id, error = %e, "Stellar RPC unreachable");
            serde_json::json!({
                "status": "error",
                "rpc_url": state.stellar_rpc_url,
                "message": "stellar rpc unreachable",
                "contracts_configured": contracts_configured,
            })
        }
    };
    // Stellar RPC being unreachable is degraded, not critical — the API still
    // functions without live contract calls in most read paths.
    let stellar_healthy = stellar_status["status"] != "error";

    let all_healthy = db_healthy && redis_healthy;
    let overall = if all_healthy && stellar_healthy {
        "healthy"
    } else if all_healthy {
        "degraded"
    } else {
        "unhealthy"
    };

    let body = serde_json::json!({
        "status": overall,
        "service": "stellar-api",
        "version": env!("CARGO_PKG_VERSION"),
        "dependencies": {
            "database": db_status,
            "redis": redis_status,
            "stellar": stellar_status,
        }
    });

    if all_healthy {
        HttpResponse::Ok().json(body)
    } else {
        HttpResponse::ServiceUnavailable().json(body)
    }
}

/// Create a new bounty
#[utoipa::path(
    post, path = "/api/v1/bounties",
    request_body = BountyRequest,
    responses(
        (status = 201, description = "Bounty created"),
        (status = 400, description = "Invalid request body"),
        (status = 500, description = "Database error"),
    )
)]
async fn create_bounty(redis: web::Data<Pool>, body: web::Json<BountyRequest>) -> HttpResponse {
    tracing::info!("Creating bounty: {:?}", body.title);
    let data = serde_json::json!({
        "bounty_id": 1,
        "creator": body.creator,
        "title": body.title,
        "budget": body.budget,
        "status": "open"
    });
    webhooks::trigger_webhooks(&redis, "bounty.created", data.clone()).await;
    HttpResponse::Created().json(ApiResponse::ok(data, Some("Bounty created successfully".into())))
async fn create_bounty(pool: web::Data<PgPool>, body: web::Json<BountyRequest>) -> Result<HttpResponse, ApiError> {
    tracing::info!("Creating bounty: {:?}", body.title);

    let budget = match parse_i64(body.budget, "budget") {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    let deadline = match parse_u64_to_i64(body.deadline, "deadline") {
        Ok(value) => value,
        Err(error) => return Err(error),
    };

    let bounty = match sqlx::query_as::<_, BountyRecord>(
        r#"
        INSERT INTO bounties (creator_address, title, description, budget, deadline)
        VALUES ($1, $2, $3, $4, TO_TIMESTAMP($5::double precision))
        RETURNING
            id,
            creator_address AS creator,
            title,
            description,
            budget::BIGINT AS budget,
            EXTRACT(EPOCH FROM deadline)::BIGINT AS deadline,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        "#,
    )
    .bind(&body.creator)
    .bind(&body.title)
    .bind(&body.description)
    .bind(budget)
    .bind(deadline)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(record) => record,
        Err(error) => {
            tracing::error!("Failed to create bounty: {error}");
            return Err(ApiError::Database(error));
        }
    };

    let data = value_response(&bounty)?;

    Ok(HttpResponse::Created().json(ApiResponse::ok(data, Some("Bounty created successfully".to_string()))))
}

/// List bounties (paginated, optionally full-text searched)
#[utoipa::path(
    get, path = "/api/v1/bounties",
    params(
        ("q"      = Option<String>, Query, description = "Full-text search query"),
        ("status" = Option<String>, Query, description = "Filter by status: open | in-progress | completed"),
        ("page"   = Option<i64>,   Query, description = "Page number (default 1)"),
        ("limit"  = Option<i64>,   Query, description = "Results per page, 1-100 (default 10)"),
    ),
    responses(
        (status = 200, description = "Paginated list of bounties"),
        (status = 500, description = "Database error"),
    )
)]
async fn list_bounties(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, ApiError> {
    let request_id = get_request_id(&req).unwrap_or_else(|| "unknown".to_string());

    let page  = query.get("page").and_then(|v| v.parse::<i64>().ok()).unwrap_or(1).max(1);
    let limit = query.get("limit").and_then(|v| v.parse::<i64>().ok()).unwrap_or(10).clamp(1, 100);
    let offset = (page - 1) * limit;
    let status = query.get("status").cloned();

    // Sanitise and normalise the search query.
    // websearch_to_tsquery understands quoted phrases and `-word` exclusions,
    // which is friendlier for end-users than plainto_tsquery.
    let search_query: Option<String> = query
        .get("q")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    tracing::info!(
        request_id = %request_id,
        ?status,
        search = ?search_query,
        page,
        limit,
        "Listing bounties"
    );

    // ── Count ────────────────────────────────────────────────────────────────
    let total = match sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::BIGINT
        FROM   bounties
        WHERE  ($1::TEXT IS NULL OR status = $1)
          AND  ($2::TEXT IS NULL OR fts @@ websearch_to_tsquery('english', $2))
        "#,
    )
    .bind(status.clone())
    .bind(search_query.clone())
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(n) => n,
        Err(error) => {
            tracing::error!(request_id = %request_id, "Failed to count bounties: {error}");
            return Err(ApiError::Database(error));
        }
    };

    // ── Rows — ranked by relevance when a query is present ──────────────────
    let bounties = match sqlx::query_as::<_, BountyRecord>(
        r#"
        SELECT
            id,
            creator_address AS creator,
            title,
            description,
            budget::BIGINT AS budget,
            EXTRACT(EPOCH FROM deadline)::BIGINT AS deadline,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        FROM bounties
        WHERE ($1::TEXT IS NULL OR status = $1)
          AND ($2::TEXT IS NULL OR fts @@ websearch_to_tsquery('english', $2))
        ORDER BY
            CASE WHEN $2::TEXT IS NOT NULL
                 THEN ts_rank(fts, websearch_to_tsquery('english', $2))
                 ELSE 0
            END DESC,
            created_at DESC,
            id DESC
        LIMIT  $3
        OFFSET $4
        "#,
    )
    .bind(status.clone())
    .bind(search_query.clone())
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!(request_id = %request_id, "Failed to list bounties: {error}");
            return Err(ApiError::Database(error));
        }
    };

    Ok(HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({
            "bounties": bounties,
            "total":    total,
            "page":     page,
            "limit":    limit,
            "filters": {
                "status": status.unwrap_or_default(),
                "q":      search_query.unwrap_or_default(),
            }
        }),
        None,
    )))
}

/// Get a single bounty by ID
#[utoipa::path(
    get, path = "/api/v1/bounties/{id}",
    params(("id" = u64, Path, description = "Bounty ID")),
    responses(
        (status = 200, description = "Bounty details"),
        (status = 404, description = "Bounty not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn get_bounty(redis: web::Data<Pool>, path: web::Path<u64>) -> HttpResponse {
async fn get_bounty(
    path: web::Path<u64>,
    pool: web::Data<PgPool>,
    redis: web::Data<Pool>,
) -> Result<HttpResponse, ApiError> {
    let bounty_id = path.into_inner();
    let bounty_id_db = match parse_u64_to_i64(bounty_id, "id") {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    let cache_key = format!("api:bounty:{bounty_id}");

    if let Ok(mut conn) = redis.get().await {
        if let Ok(cached) = conn.get::<String, String>(cache_key.clone()).await {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cached) {
                tracing::debug!("Cache hit for {}", cache_key);
                return HttpResponse::Ok().json(ApiResponse::ok(parsed, None::<String>));
    match redis.get().await {
        Ok(mut conn) => {
            match conn.get::<_, String>(&cache_key).await {
                Ok(payload) => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&payload) {
                        tracing::debug!("Cache hit for {cache_key}");
                        return Ok(HttpResponse::Ok().json(ApiResponse::ok(parsed, None)));
                    }
                }
                Err(error) => {
                    tracing::error!("Redis GET failed for key {cache_key}: {error}");
                    return Err(ApiError::Network("Cache backend unavailable".to_string()));
                }
            }
        }
        Err(error) => {
            tracing::error!("Redis pool checkout failed: {error}");
            return Err(ApiError::Network("Cache backend unavailable".to_string()));
        }
    }

    let bounty = match sqlx::query_as::<_, BountyRecord>(
        r#"
        SELECT
            id,
            creator_address AS creator,
            title,
            description,
            budget::BIGINT AS budget,
            EXTRACT(EPOCH FROM deadline)::BIGINT AS deadline,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        FROM bounties
        WHERE id = $1
        "#,
    )
    .bind(bounty_id_db)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(record)) => record,
        Ok(None) => return Err(ApiError::NotFound(format!("Bounty {bounty_id} not found"))),
        Err(error) => {
            tracing::error!("Failed to fetch bounty {bounty_id}: {error}");
            return Err(ApiError::Database(error));
        }
    };

    let data = value_response(&bounty)?;

    if let Ok(mut conn) = redis.get().await {
        let _: Result<(), _> = conn.set_ex(cache_key, data.to_string(), 60).await;
    }

    HttpResponse::Ok().json(ApiResponse::ok(data, None::<String>))
    match redis.get().await {
        Ok(mut conn) => {
            if let Err(error) = conn.set_ex::<_, _, ()>(&cache_key, data.to_string(), 60).await {
                tracing::warn!("Redis SETEX failed for key {cache_key}: {error}");
            }
        }
        Err(error) => {
            tracing::warn!("Redis pool checkout failed: {error}");
        }
    }

    Ok(HttpResponse::Ok().json(ApiResponse::ok(data, None)))
}

/// Apply for a bounty
#[utoipa::path(
    post, path = "/api/v1/bounties/{id}/apply",
    params(("id" = u64, Path, description = "Bounty ID")),
    request_body = BountyApplication,
    responses(
        (status = 201, description = "Application submitted"),
        (status = 400, description = "Invalid request body"),
        (status = 404, description = "Bounty not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn apply_for_bounty(
    redis: web::Data<Pool>,
    path: web::Path<u64>,
    body: web::Json<BountyApplication>,
) -> HttpResponse {
    let bounty_id = path.into_inner();
    let data = serde_json::json!({
        "application_id": 1,
        "bounty_id": bounty_id,
        "freelancer": body.freelancer,
        "status": "pending"
    });
    webhooks::trigger_webhooks(&redis, "application.submitted", data.clone()).await;
    HttpResponse::Created()
        .json(ApiResponse::ok(data, Some("Application submitted successfully".to_string())))
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let bounty_id = match parse_u64_to_i64(path.into_inner(), "id") {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    let proposed_budget = match parse_i64(body.proposed_budget, "proposed_budget") {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    let timeline = match parse_u64_to_i64(body.timeline, "timeline") {
        Ok(value) => value,
        Err(error) => return Err(error),
    };

    let exists = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM bounties WHERE id = $1",
    )
    .bind(bounty_id)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(count) => count > 0,
        Err(error) => {
            tracing::error!("Failed to validate bounty {bounty_id}: {error}");
            return Err(ApiError::Database(error));
        }
    };

    if !exists {
        return Err(ApiError::NotFound(format!("Bounty {bounty_id} not found")));
    }

    let application = match sqlx::query_as::<_, ApplicationRecord>(
        r#"
        INSERT INTO applications (bounty_id, freelancer_address, proposal, proposed_budget, timeline)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
            id AS application_id,
            bounty_id,
            freelancer_address AS freelancer,
            proposal,
            proposed_budget::BIGINT AS proposed_budget,
            timeline::BIGINT AS timeline,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        "#,
    )
    .bind(bounty_id)
    .bind(&body.freelancer)
    .bind(&body.proposal)
    .bind(proposed_budget)
    .bind(timeline)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(record) => record,
        Err(error) => {
            tracing::error!("Failed to create application for bounty {bounty_id}: {error}");
            return Err(ApiError::Database(error));
        }
    };

    let data = value_response(&application)?;

    Ok(HttpResponse::Created().json(ApiResponse::ok(
        data,
        Some("Application submitted successfully".to_string()),
    )))
}

/// Register a freelancer profile
#[utoipa::path(
    post, path = "/api/v1/freelancers/register",
    request_body = FreelancerRegistration,
    responses(
        (status = 201, description = "Freelancer registered"),
        (status = 409, description = "Address already registered"),
        (status = 500, description = "Database error"),
    )
)]
async fn register_freelancer(body: web::Json<FreelancerRegistration>) -> HttpResponse {
    HttpResponse::Created().json(ApiResponse::ok(
        serde_json::json!({ "name": body.name, "discipline": body.discipline, "verified": false }),
        Some("Freelancer registered successfully".to_string()),
    ))
async fn register_freelancer(
    body: web::Json<FreelancerRegistration>,
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let generated_address = Uuid::new_v4().to_string();

    let freelancer = match sqlx::query_as::<_, FreelancerRecord>(
        r#"
        INSERT INTO freelancers (address, name, discipline, bio)
        VALUES ($1, $2, $3, $4)
        RETURNING
            address,
            name,
            discipline,
            bio,
            COALESCE(verified, false) AS verified,
            COALESCE(rating, 0)::DOUBLE PRECISION AS rating,
            COALESCE(completed_projects, 0)::BIGINT AS completed_projects
        "#,
    )
    .bind(&generated_address)
    .bind(&body.name)
    .bind(&body.discipline)
    .bind(&body.bio)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(record) => record,
        Err(error) => {
            tracing::error!("Failed to register freelancer {}: {error}", body.name);
            if let Some(constraint_error) = error.as_database_error() {
                if constraint_error.is_unique_violation() {
                    return Err(ApiError::Conflict("Freelancer already registered".to_string()));
                }
            }
            return Err(ApiError::Database(error));
        }
    };

    Ok(HttpResponse::Created().json(ApiResponse::ok(
        serde_json::json!({
            "name": freelancer.name,
            "discipline": freelancer.discipline,
            "verified": freelancer.verified
        }),
        Some("Freelancer registered successfully".to_string()),
    )))
}

/// List freelancers
#[utoipa::path(
    get, path = "/api/v1/freelancers",
    params(
        PaginationParams,
        ("discipline" = Option<String>, Query, description = "Filter by discipline"),
    ),
    responses(
        (status = 200, description = "Paginated list of freelancers"),
        (status = 500, description = "Database error"),
    )
)]
async fn list_freelancers(
    req: HttpRequest,
    query: web::Query<std::collections::HashMap<String, String>>,
    _redis: web::Data<Pool>,
) -> HttpResponse {
    let discipline = query.get("discipline").cloned().unwrap_or_default();
    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({ "freelancers": [], "total": 0, "filters": { "discipline": discipline } }),
        None::<String>,
    ))
    pool: web::Data<PgPool>,
) -> Result<HttpResponse, ApiError> {
    let discipline = query.get("discipline").cloned();
    let page = query.get("page").and_then(|value| value.parse::<i64>().ok()).unwrap_or(1).max(1);
    let limit = query.get("limit").and_then(|value| value.parse::<i64>().ok()).unwrap_or(10).clamp(1, 100);
    let offset = (page - 1) * limit;

    let total = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM freelancers WHERE ($1::TEXT IS NULL OR discipline = $1)",
    )
    .bind(discipline.clone())
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(count) => count,
        Err(error) => {
            tracing::error!("Failed to count freelancers: {error}");
            return Err(ApiError::Database(error));
        }
    };

    let freelancers = match sqlx::query_as::<_, FreelancerRecord>(
        r#"
        SELECT
            address,
            name,
            discipline,
            bio,
            COALESCE(verified, false) AS verified,
            COALESCE(rating, 0)::DOUBLE PRECISION AS rating,
            COALESCE(completed_projects, 0)::BIGINT AS completed_projects
        FROM freelancers
        WHERE ($1::TEXT IS NULL OR discipline = $1)
        ORDER BY name ASC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(discipline.clone())
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!("Failed to list freelancers: {error}");
            return Err(ApiError::Database(error));
        }
    };

    Ok(HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({
            "freelancers": freelancers,
            "total": total,
            "filters": {
                "discipline": discipline.unwrap_or_default()
            }
        }),
        None,
    )))
}

/// Get a freelancer by Stellar address
#[utoipa::path(
    get, path = "/api/v1/freelancers/{address}",
    params(("address" = String, Path, description = "Stellar address")),
    responses(
        (status = 200, description = "Freelancer profile"),
        (status = 404, description = "Freelancer not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn get_freelancer(redis: web::Data<Pool>, path: web::Path<String>) -> HttpResponse {
async fn get_freelancer(
    path: web::Path<String>,
    pool: web::Data<PgPool>,
    redis: web::Data<Pool>,
) -> Result<HttpResponse, ApiError> {
    let address = path.into_inner();
    let cache_key = format!("api:freelancer:{address}");

    if let Ok(mut conn) = redis.get().await {
        if let Ok(cached) = conn.get::<String, String>(cache_key.clone()).await {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cached) {
                tracing::debug!("Cache hit for {}", cache_key);
                return HttpResponse::Ok().json(ApiResponse::ok(parsed, None::<String>));
    match redis.get().await {
        Ok(mut conn) => {
            match conn.get::<_, String>(&cache_key).await {
                Ok(payload) => {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&payload) {
                        tracing::debug!("Cache hit for {cache_key}");
                        return Ok(HttpResponse::Ok().json(ApiResponse::ok(parsed, None)));
                    }
                }
                Err(error) => {
                    tracing::error!("Redis GET failed for key {cache_key}: {error}");
                    return Err(ApiError::Network("Cache backend unavailable".to_string()));
                }
            }
        }
        Err(error) => {
            tracing::error!("Redis pool checkout failed: {error}");
            return Err(ApiError::Network("Cache backend unavailable".to_string()));
        }
    }

    let freelancer = match sqlx::query_as::<_, FreelancerRecord>(
        r#"
        SELECT
            address,
            name,
            discipline,
            bio,
            COALESCE(verified, false) AS verified,
            COALESCE(rating, 0)::DOUBLE PRECISION AS rating,
            COALESCE(completed_projects, 0)::BIGINT AS completed_projects
        FROM freelancers
        WHERE address = $1
        "#,
    )
    .bind(&address)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(record)) => record,
        Ok(None) => return Err(ApiError::NotFound(format!("Freelancer {address} not found"))),
        Err(error) => {
            tracing::error!("Failed to fetch freelancer {address}: {error}");
            return Err(ApiError::Database(error));
        }
    };

    if let Ok(mut conn) = redis.get().await {
        let _: Result<(), _> = conn.set_ex(cache_key, data.to_string(), 60).await;
    }

    HttpResponse::Ok().json(ApiResponse::ok(data, None::<String>))
    let data = value_response(&freelancer)?;

    match redis.get().await {
        Ok(mut conn) => {
            if let Err(error) = conn.set_ex::<_, _, ()>(&cache_key, data.to_string(), 60).await {
                tracing::warn!("Redis SETEX failed for key {cache_key}: {error}");
            }
        }
        Err(error) => {
            tracing::warn!("Redis pool checkout failed: {error}");
        }
    }

    Ok(HttpResponse::Ok().json(ApiResponse::ok(data, None)))
}

/// Get escrow details
#[utoipa::path(
    get, path = "/api/v1/escrow/{id}",
    params(("id" = u64, Path, description = "Escrow ID")),
    responses(
        (status = 200, description = "Escrow details"),
        (status = 404, description = "Escrow not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn get_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({ "id": escrow_id, "status": "active", "amount": 0 }),
        None::<String>,
    ))
async fn get_escrow(path: web::Path<u64>, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let escrow_id = match parse_u64_to_i64(path.into_inner(), "id") {
        Ok(value) => value,
        Err(error) => return Err(error),
    };

    let escrow = match sqlx::query_as::<_, EscrowRecord>(
        r#"
        SELECT
            id,
            payer_address,
            payee_address,
            amount::BIGINT AS amount,
            status,
            release_condition,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at,
            EXTRACT(EPOCH FROM released_at)::BIGINT AS released_at
        FROM escrow_accounts
        WHERE id = $1
        "#,
    )
    .bind(escrow_id)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(record)) => record,
        Ok(None) => return Err(ApiError::NotFound(format!("Escrow {escrow_id} not found"))),
        Err(error) => {
            tracing::error!("Failed to fetch escrow {escrow_id}: {error}");
            return Err(ApiError::Database(error));
        }
    };

    let data = value_response(&escrow)?;

    Ok(HttpResponse::Ok().json(ApiResponse::ok(data, None)))
}

/// Release escrowed funds
#[utoipa::path(
    post, path = "/api/v1/escrow/{id}/release",
    params(("id" = u64, Path, description = "Escrow ID")),
    responses(
        (status = 200, description = "Funds released"),
        (status = 403, description = "Not authorised to release"),
        (status = 404, description = "Escrow not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn release_escrow(redis: web::Data<Pool>, path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    let data = serde_json::json!({ "id": escrow_id, "status": "released" });
    webhooks::trigger_webhooks(&redis, "escrow.released", data.clone()).await;
    HttpResponse::Ok()
        .json(ApiResponse::ok(data, Some("Funds released successfully".to_string())))
}
async fn release_escrow(path: web::Path<u64>, pool: web::Data<PgPool>) -> Result<HttpResponse, ApiError> {
    let escrow_id = match parse_u64_to_i64(path.into_inner(), "id") {
        Ok(value) => value,
        Err(error) => return Err(error),
    };

    let escrow = match sqlx::query_as::<_, EscrowRecord>(
        r#"
        UPDATE escrow_accounts
        SET status = 'released', released_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING
            id,
            payer_address,
            payee_address,
            amount::BIGINT AS amount,
            status,
            release_condition,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at,
            EXTRACT(EPOCH FROM released_at)::BIGINT AS released_at
        "#,
    )
    .bind(escrow_id)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(record)) => record,
        Ok(None) => return Err(ApiError::NotFound(format!("Escrow {escrow_id} not found"))),
        Err(error) => {
            tracing::error!("Failed to release escrow {escrow_id}: {error}");
            return Err(ApiError::Database(error));
        }
    };

    // Placeholder branch for future contract-call integration.
    if std::env::var("SIMULATE_CONTRACT_FAILURE").as_deref() == Ok("1") {
        tracing::error!("Escrow contract invocation failed for escrow_id={escrow_id}");
        return Err(ApiError::ContractInvocation("Unable to release escrow on-chain".to_string()));
    }

    let data = value_response(&escrow)?;

    Ok(HttpResponse::Ok().json(ApiResponse::ok(data, Some("Funds released successfully".to_string()))))
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Stellar Creator Platform API",
        version = "0.1.0",
        description = "REST API for the Stellar Creator Portfolio & Bounty Marketplace",
        contact(name = "Stellar Team", email = "support@stellar.dev"),
        license(name = "MIT"),
    ),
    paths(
        health,
        create_bounty,
        list_bounties,
        get_bounty,
        apply_for_bounty,
        register_freelancer,
        list_freelancers,
        get_freelancer,
        get_escrow,
        release_escrow,
        webhooks::register_webhook,
        webhooks::list_webhooks,
        webhooks::delete_webhook,
    ),
    components(schemas(
        BountyRequest, BountyApplication, FreelancerRegistration,
        webhooks::WebhookRegistration, webhooks::Webhook,
        BountyRequest,
        BountyApplication,
        FreelancerRegistration,
        BountyRecord,
        ApplicationRecord,
        FreelancerRecord,
        EscrowRecord
    )),
    tags(
        (name = "bounties", description = "Bounty management"),
        (name = "freelancers", description = "Freelancer registry"),
        (name = "escrow",      description = "Payment escrow"),
        (name = "webhooks",    description = "Webhook registration & delivery"),
        (name = "escrow", description = "Payment escrow"),
    )
)]
pub struct ApiDoc;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: deadpool_redis::Pool,
    /// Soroban RPC endpoint, used for contract reachability check.
    pub stellar_rpc_url: String,
    /// Contract IDs populated from env — empty string means not configured.
    pub bounty_contract_id: String,
    pub escrow_contract_id: String,
    pub freelancer_contract_id: String,
}

#[actix_web::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    // Initialize OpenTelemetry
    let tracer_provider = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(std::env::var("OTLP_ENDPOINT").unwrap_or_else(|_| "http://jaeger:4317".to_string())),
        )
        .with_trace_config(
            trace::Config::default().with_resource(Resource::new(vec![KeyValue::new(
                opentelemetry_semantic_conventions::resource::SERVICE_NAME,
                "stellar-api",
            )])),
        )
        .install_batch(runtime::Tokio)
        .expect("Failed to initialize tracer");

    let tracer = tracer_provider.tracer("stellar-api");
    let telemetry = OpenTelemetryLayer::new(tracer);
    
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,stellar_api=debug"));

    let formatting_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stdout);

    Registry::default()
        .with(env_filter)
        .with(telemetry)
        .with(formatting_layer)
        .init();

    let port = std::env::var("API_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .expect("API_PORT must be a valid port number");
    let host = std::env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let redis_pool = Config::from_url(redis_url)
        .create_pool(Some(Runtime::Tokio1))
        .expect("Failed to create Redis pool");
    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set before starting stellar-api");
    let db_pool = PgPool::connect(&database_url)
        .await
        .unwrap_or_else(|error| panic!("Failed to connect to PostgreSQL using DATABASE_URL: {error}"));

    tracing::info!("Connected to database");

    let stellar_rpc_url = std::env::var("STELLAR_RPC_URL")
        .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".to_string());
    let bounty_contract_id = std::env::var("BOUNTY_CONTRACT_ID").unwrap_or_default();
    let escrow_contract_id = std::env::var("ESCROW_CONTRACT_ID").unwrap_or_default();
    let freelancer_contract_id = std::env::var("FREELANCER_CONTRACT_ID").unwrap_or_default();

    let state = AppState {
        db: db_pool,
        redis: redis_pool,
        stellar_rpc_url,
        bounty_contract_id,
        escrow_contract_id,
        freelancer_contract_id,
    };

    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let cfg = RedisConfig::from_url(redis_url);
    let redis_pool = cfg.create_pool(Some(Runtime::Tokio1)).expect("Failed to create Redis pool");
    let openapi = ApiDoc::openapi();

    let (prometheus, business_metrics) = metrics::setup_metrics();
    let business_metrics = web::Data::new(business_metrics);

    tracing::info!("Starting Stellar API on {}:{}", host, port);
    tracing::info!(
        "Swagger UI available at http://{}:{}/swagger-ui/",
        host,
        port
    );
    tracing::info!("Prometheus metrics available at http://{}:{}/metrics", host, port);

    let listener = TcpListener::bind((host.as_str(), port))?;
    build_http_server(listener, state, openapi)?.await?;
    tracing::info!("Stellar API shutdown complete");
    Ok(())
    let server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(db_pool.clone()))
            .app_data(web::Data::new(redis_pool.clone()))
            .app_data(business_metrics.clone())
            .wrap(prometheus.clone())
            .wrap(Cors::permissive())
            .wrap(tracing_actix_web::TracingLogger::default())
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            .service(
                SwaggerUi::new("/swagger-ui/{_:.*}").url("/api-docs/openapi.json", openapi.clone()),
            )
            .route("/health", web::get().to(health))
            .route("/api/v1/bounties", web::post().to(create_bounty))
            .route("/api/v1/bounties", web::get().to(list_bounties))
            .route("/api/v1/bounties/{id}", web::get().to(get_bounty))
            .route("/api/v1/bounties/{id}/apply", web::post().to(apply_for_bounty))
            .route("/api/v1/freelancers/register", web::post().to(register_freelancer))
            .route("/api/v1/freelancers", web::get().to(list_freelancers))
            .route("/api/v1/freelancers/{address}", web::get().to(get_freelancer))
            .route("/api/v1/escrow/{id}", web::get().to(get_escrow))
            .route("/api/v1/escrow/{id}/release", web::post().to(release_escrow))
            .route("/api/v1/webhooks", web::post().to(webhooks::register_webhook))
            .route("/api/v1/webhooks", web::get().to(webhooks::list_webhooks))
            .route("/api/v1/webhooks/{id}", web::delete().to(webhooks::delete_webhook))
            // ── File upload routes ───────────────────────────────────────
            .route("/api/v1/upload/avatar", web::post().to(upload::upload_avatar))
            .route("/api/v1/upload/project-image", web::post().to(upload::upload_project_image))
            .route("/api/v1/upload/bounty-attachment", web::post().to(upload::upload_bounty_attachment))
            .route("/api/v1/uploads", web::get().to(upload::list_uploads))
            .route("/api/v1/uploads/{category}/{filename}", web::get().to(upload::serve_upload))
            .route("/api/v1/uploads/{id}", web::delete().to(upload::delete_upload))
            // ── Backward-compat redirects: /api/* → /api/v1/* ───────────
            .route("/api/bounties",              web::get().to(redirect_to_v1))
            .route("/api/bounties",              web::post().to(redirect_to_v1))
            .route("/api/bounties/{tail:.*}",    web::route().to(redirect_to_v1))
            .route("/api/freelancers",           web::get().to(redirect_to_v1))
            .route("/api/freelancers/{tail:.*}", web::route().to(redirect_to_v1))
            .route("/api/escrow/{tail:.*}",      web::route().to(redirect_to_v1))
            .route("/api/webhooks",              web::get().to(redirect_to_v1))
            .route("/api/webhooks",              web::post().to(redirect_to_v1))
            .route("/api/webhooks/{tail:.*}",    web::route().to(redirect_to_v1))
    })
    .bind((config.api_host.as_str(), config.api_port))?
    .run()
    .await;

    // Deregister from service discovery on shutdown
    if let Err(e) = discovery.deregister(&service_id).await {
        tracing::warn!("Service discovery deregistration failed: {e}");
    }

    server
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{body::to_bytes, http::StatusCode, test, App};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;
    use tokio::sync::{oneshot, Notify};
    use tokio::time::{sleep, timeout, Duration};
    use actix_web::http::StatusCode;

    #[test]
    fn test_api_response_ok() {
        let response = ApiResponse::ok("test".to_string(), None::<String>);
        assert!(response.success);
        assert_eq!(response.data, Some("test".to_string()));
    }

    #[test]
    fn test_api_response_err() {
        let response = ApiResponse::<String>::err("error".to_string());
        assert!(!response.success);
        assert_eq!(response.error, Some("error".to_string()));
    }

    #[test]
    fn test_openapi_spec_is_valid() {
        let spec = ApiDoc::openapi();
        let paths = &spec.paths.paths;
        assert!(paths.contains_key("/health"));
        assert!(paths.contains_key("/api/v1/bounties"));
        assert!(paths.contains_key("/api/v1/freelancers"));
        assert!(paths.contains_key("/api/v1/escrow/{id}"));
        assert!(paths.contains_key("/api/v1/webhooks"));
    }

    #[test]
    fn redirect_to_v1_builds_correct_location() {
        // Simulate the path rewrite logic used in redirect_to_v1
        let cases = vec![
            ("/api/bounties",           "/api/v1/bounties"),
            ("/api/bounties/42",        "/api/v1/bounties/42"),
            ("/api/freelancers",        "/api/v1/freelancers"),
            ("/api/escrow/7/release",   "/api/v1/escrow/7/release"),
            ("/api/webhooks",           "/api/v1/webhooks"),
        ];
        for (input, expected) in cases {
            let versioned = if let Some(rest) = input.strip_prefix("/api/") {
                format!("/api/v1/{rest}")
            } else {
                format!("/api/v1{input}")
            };
            assert_eq!(versioned, expected, "failed for input {input}");
        }
    }

    #[test]
    fn api_error_status_mappings_are_correct() {
        assert_eq!(ApiError::BadRequest("x".to_string()).status_code(), StatusCode::BAD_REQUEST);
        assert_eq!(ApiError::NotFound("x".to_string()).status_code(), StatusCode::NOT_FOUND);
        assert_eq!(ApiError::Conflict("x".to_string()).status_code(), StatusCode::CONFLICT);
        assert_eq!(ApiError::Network("x".to_string()).status_code(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            ApiError::ContractInvocation("x".to_string()).status_code(),
            StatusCode::BAD_GATEWAY
        );
    }

    #[actix_web::test]
    async fn shutdown_signal_selector_resolves_on_sigint() {
        let (sigint_tx, sigint_rx) = oneshot::channel::<()>();
        let (_sigterm_tx, sigterm_rx) = oneshot::channel::<()>();

        let shutdown = tokio::spawn(select_shutdown_signal(
            async move {
                let _ = sigint_rx.await;
            },
            async move {
                let _ = sigterm_rx.await;
            },
        ));

        sigint_tx.send(()).expect("sigint send should succeed");

        assert_eq!(
            shutdown.await.expect("join should succeed"),
            ShutdownSignal::SigInt
        );
    }

    #[actix_web::test]
    async fn shutdown_signal_selector_returns_first_completed_signal() {
        let (sigint_tx, sigint_rx) = oneshot::channel::<()>();
        let (sigterm_tx, sigterm_rx) = oneshot::channel::<()>();

        let shutdown = tokio::spawn(select_shutdown_signal(
            async move {
                let _ = sigint_rx.await;
            },
            async move {
                let _ = sigterm_rx.await;
            },
        ));

        sigterm_tx.send(()).expect("sigterm send should succeed");
        let _ = sigint_tx.send(());

        assert_eq!(
            shutdown.await.expect("join should succeed"),
            ShutdownSignal::SigTerm
        );
    }

    #[actix_web::test]
    async fn server_drains_in_flight_requests_during_graceful_shutdown() {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).expect("listener should bind to an open port");
        let address = listener
            .local_addr()
            .expect("listener should expose its bound address");
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let server = HttpServer::new({
            let started = Arc::clone(&started);
            let release = Arc::clone(&release);

            move || {
                let started = Arc::clone(&started);
                let release = Arc::clone(&release);

                App::new().route(
                    "/slow",
                    web::get().to(move || {
                        let started = Arc::clone(&started);
                        let release = Arc::clone(&release);

                        async move {
                            started.notify_one();
                            release.notified().await;
                            HttpResponse::Ok().body("done")
                        }
                    }),
                )
            }
        })
        .shutdown_signal(async move {
            let _ = shutdown_rx.await;
        })
        .shutdown_timeout(1)
        .listen(listener)
        .expect("server should listen on the test socket")
        .run();

        let server_task = tokio::spawn(server);

        let response_task = tokio::spawn(async move {
            let mut stream = TcpStream::connect(address)
                .await
                .expect("request should connect while server is accepting traffic");
            let request = format!(
                "GET /slow HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
                address
            );
            stream
                .write_all(request.as_bytes())
                .await
                .expect("request should be written");

            let mut response = Vec::new();
            stream
                .read_to_end(&mut response)
                .await
                .expect("response should be readable");

            String::from_utf8(response).expect("response should be valid utf-8")
        });

        timeout(Duration::from_secs(1), started.notified())
            .await
            .expect("request should reach the handler before shutdown begins");
        shutdown_tx
            .send(())
            .expect("shutdown trigger should be delivered");

        sleep(Duration::from_millis(50)).await;
        release.notify_waiters();

        let response = timeout(Duration::from_secs(2), response_task)
            .await
            .expect("response task should finish before timeout")
            .expect("response task should not panic");
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("\r\ndone"));

        timeout(Duration::from_secs(2), server_task)
            .await
            .expect("server should finish graceful shutdown")
            .expect("server task should not panic")
            .expect("graceful shutdown should not return an error");

        assert!(
            TcpStream::connect(address).await.is_err(),
            "server should stop accepting new connections after shutdown"
        );
    }
}

