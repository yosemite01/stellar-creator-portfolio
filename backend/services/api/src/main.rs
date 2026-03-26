use actix_cors::Cors;
use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use deadpool_redis::{redis::AsyncCommands, Config, Pool, Runtime};
use serde::{Deserialize, Serialize};
use tracing_subscriber;
#[derive(Clone, Serialize, Deserialize, Debug)]
use utoipa::{OpenApi, ToSchema};
use utoipa_swagger_ui::SwaggerUi;

// ── Request / Response types ─────────────────────────────────────────────────

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

#[derive(Clone, Serialize, Deserialize, Debug, ToSchema)]
pub struct ApiResponse<T: ToSchema> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub message: Option<String>,
}

impl<T: ToSchema> ApiResponse<T> {
    fn ok(data: T, message: Option<String>) -> Self {
        ApiResponse { success: true, data: Some(data), error: None, message }
    }

    #[allow(dead_code)]
    fn err(error: String) -> Self
    where
        T: Default,
    {
        ApiResponse { success: false, data: None, error: Some(error), message: None }
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// Health check
#[utoipa::path(
    get, path = "/health",
    responses((status = 200, description = "Service is healthy"))
)]
async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "stellar-api",
        "version": "0.1.0"
    }))
}

/// Create a new bounty
#[utoipa::path(
    post, path = "/api/bounties",
    request_body = BountyRequest,
    responses(
        (status = 201, description = "Bounty created"),
        (status = 400, description = "Invalid request body"),
    )
)]
async fn create_bounty(body: web::Json<BountyRequest>) -> HttpResponse {
    tracing::info!("Creating bounty: {:?}", body.title);
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "bounty_id": 1,
            "creator": body.creator,
            "title": body.title,
            "budget": body.budget,
            "status": "open"
        }),
        Some("Bounty created successfully".to_string()),
    );
    HttpResponse::Created().json(response)
}

/// List bounties (paginated)
#[utoipa::path(
    get, path = "/api/bounties",
    params(
        ("page" = Option<u32>, Query, description = "Page number (default 1)"),
        ("limit" = Option<u32>, Query, description = "Items per page (default 10)"),
        ("status" = Option<String>, Query, description = "Filter by status: open | in-progress | completed"),
    ),
    responses((status = 200, description = "Paginated list of bounties"))
)]
async fn list_bounties() -> HttpResponse {
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "bounties": [], "total": 0, "page": 1, "limit": 10 }),
        None,
    );
    HttpResponse::Ok().json(response)
}

/// Get a single bounty by ID
#[utoipa::path(
    get, path = "/api/bounties/{id}",
    params(("id" = u64, Path, description = "Bounty ID")),
    responses(
        (status = 200, description = "Bounty details"),
        (status = 404, description = "Bounty not found"),
    )
)]
async fn get_bounty(path: web::Path<u64>) -> HttpResponse {
    let bounty_id = path.into_inner();
    let cache_key = format!("api:bounty:{}", bounty_id);

    if let Ok(mut conn) = redis.get().await {
        if let Ok(cached_data) = conn.get::<_, String>(&cache_key).await {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cached_data) {
                tracing::debug!("Cache hit for {}", cache_key);
                return HttpResponse::Ok().json(ApiResponse::ok(parsed, None));
            }
        }
    }

    let data = serde_json::json!({ "id": bounty_id, "title": "Sample Bounty", "status": "open" });

    if let Ok(mut conn) = redis.get().await {
        let _ = conn.set_ex::<_, _, ()>(&cache_key, data.to_string(), 60).await;
    }

    HttpResponse::Ok().json(ApiResponse::ok(data, None))
}

/// Apply for a bounty
#[utoipa::path(
    post, path = "/api/bounties/{id}/apply",
    params(("id" = u64, Path, description = "Bounty ID")),
    request_body = BountyApplication,
    responses(
        (status = 201, description = "Application submitted"),
        (status = 400, description = "Invalid request body"),
        (status = 404, description = "Bounty not found"),
    )
)]
async fn apply_for_bounty(
    path: web::Path<u64>,
    body: web::Json<BountyApplication>,
) -> HttpResponse {
    let bounty_id = path.into_inner();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "application_id": 1,
            "bounty_id": bounty_id,
            "freelancer": body.freelancer,
            "status": "pending"
        }),
        Some("Application submitted successfully".to_string()),
    );
    HttpResponse::Created().json(response)
}

/// Register a freelancer profile
#[utoipa::path(
    post, path = "/api/freelancers/register",
    request_body = FreelancerRegistration,
    responses(
        (status = 201, description = "Freelancer registered"),
        (status = 409, description = "Address already registered"),
    )
)]
async fn register_freelancer(body: web::Json<FreelancerRegistration>) -> HttpResponse {
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "name": body.name, "discipline": body.discipline, "verified": false }),
        Some("Freelancer registered successfully".to_string()),
    );
    HttpResponse::Created().json(response)
}

/// List freelancers
#[utoipa::path(
    get, path = "/api/freelancers",
    params(
        ("discipline" = Option<String>, Query, description = "Filter by discipline"),
        ("page" = Option<u32>, Query, description = "Page number"),
        ("limit" = Option<u32>, Query, description = "Items per page"),
    ),
    responses((status = 200, description = "Paginated list of freelancers"))
)]
async fn list_freelancers(
    query: web::Query<std::collections::HashMap<String, String>>,
    redis: web::Data<Pool>,
) -> HttpResponse {
    let discipline = query.get("discipline").cloned().unwrap_or_default();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "freelancers": [], "total": 0, "filters": { "discipline": discipline } }),
        None,
    );
    HttpResponse::Ok().json(response)
}

/// Get a freelancer by Stellar address
#[utoipa::path(
    get, path = "/api/freelancers/{address}",
    params(("address" = String, Path, description = "Stellar address")),
    responses(
        (status = 200, description = "Freelancer profile"),
        (status = 404, description = "Freelancer not found"),
    )
)]
async fn get_freelancer(path: web::Path<String>) -> HttpResponse {
    let address = path.into_inner();
    let cache_key = format!("api:freelancer:{}", address);

    if let Ok(mut conn) = redis.get().await {
        if let Ok(cached_data) = conn.get::<_, String>(&cache_key).await {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&cached_data) {
                tracing::debug!("Cache hit for {}", cache_key);
                return HttpResponse::Ok().json(ApiResponse::ok(parsed, None));
            }
        }
    }

    let data = serde_json::json!({
        "address": address,
        "discipline": "UI/UX Design",
        "rating": 4.8,
        "completed_projects": 0
    });

    if let Ok(mut conn) = redis.get().await {
        let _ = conn.set_ex::<_, _, ()>(&cache_key, data.to_string(), 60).await;
    }

    HttpResponse::Ok().json(ApiResponse::ok(data, None))
}

/// Get escrow details
#[utoipa::path(
    get, path = "/api/escrow/{id}",
    params(("id" = u64, Path, description = "Escrow ID")),
    responses(
        (status = 200, description = "Escrow details"),
        (status = 404, description = "Escrow not found"),
    )
)]
async fn get_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": escrow_id, "status": "active", "amount": 0 }),
        None,
    );
    HttpResponse::Ok().json(response)
}

/// Release escrowed funds
#[utoipa::path(
    post, path = "/api/escrow/{id}/release",
    params(("id" = u64, Path, description = "Escrow ID")),
    responses(
        (status = 200, description = "Funds released"),
        (status = 403, description = "Not authorised to release"),
        (status = 404, description = "Escrow not found"),
    )
)]
async fn release_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": escrow_id, "status": "released" }),
        Some("Funds released successfully".to_string()),
    );
    HttpResponse::Ok().json(response)
}

// ── OpenAPI spec ─────────────────────────────────────────────────────────────

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
    ),
    components(schemas(BountyRequest, BountyApplication, FreelancerRegistration)),
    tags(
        (name = "bounties",    description = "Bounty management"),
        (name = "freelancers", description = "Freelancer registry"),
        (name = "escrow",      description = "Payment escrow"),
    )
)]
pub struct ApiDoc;

// ── Entry point ───────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_api=debug".to_string()),
        )
        .init();

    let port = std::env::var("API_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .expect("API_PORT must be a valid port number");

    let host = std::env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let cfg = Config::from_url(redis_url);
    let redis_pool = cfg.create_pool(Some(Runtime::Tokio1)).expect("Failed to create Redis pool");

    tracing::info!("Starting Stellar API on {}:{}", host, port);
    tracing::info!("Swagger UI available at http://{}:{}/swagger-ui/", host, port);

    let openapi = ApiDoc::openapi();

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(redis_pool.clone()))
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            // Swagger UI at /swagger-ui/
            .service(
                SwaggerUi::new("/swagger-ui/{_:.*}")
                    .url("/api-docs/openapi.json", openapi.clone()),
            )
            // API routes
            .route("/health", web::get().to(health))
            .route("/api/bounties", web::post().to(create_bounty))
            .route("/api/bounties", web::get().to(list_bounties))
            .route("/api/bounties/{id}", web::get().to(get_bounty))
            .route("/api/bounties/{id}/apply", web::post().to(apply_for_bounty))
            .route("/api/freelancers/register", web::post().to(register_freelancer))
            .route("/api/freelancers", web::get().to(list_freelancers))
            .route("/api/freelancers/{address}", web::get().to(get_freelancer))
            .route("/api/escrow/{id}", web::get().to(get_escrow))
            .route("/api/escrow/{id}/release", web::post().to(release_escrow))
    })
    .bind((host.as_str(), port))?
    .run()
    .await
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_response_ok() {
        let response: ApiResponse<String> = ApiResponse::ok("test".to_string(), None);
        assert!(response.success);
        assert_eq!(response.data, Some("test".to_string()));
    }

    #[test]
    fn test_api_response_err() {
        let response: ApiResponse<String> = ApiResponse::err("error".to_string());
        assert!(!response.success);
        assert_eq!(response.error, Some("error".to_string()));
    }

    #[test]
    fn test_openapi_spec_is_valid() {
        let spec = ApiDoc::openapi();
        // Ensure all expected paths are present
        let paths = &spec.paths.paths;
        assert!(paths.contains_key("/health"));
        assert!(paths.contains_key("/api/bounties"));
        assert!(paths.contains_key("/api/freelancers"));
        assert!(paths.contains_key("/api/escrow/{id}"));
    }
}
