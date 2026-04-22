use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use tracing_subscriber;

// ==================== Domain Models ====================

/// Machine-readable error codes returned by the API.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApiErrorCode {
    BadRequest,
    ValidationError,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    UnprocessableEntity,
    InternalServerError,
    ServiceUnavailable,
}

/// Per-field validation error detail.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

/// Structured error payload included in failed responses.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct ApiError {
    pub code: ApiErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_errors: Option<Vec<FieldError>>,
}

impl ApiError {
    pub fn new(code: ApiErrorCode, message: impl Into<String>) -> Self {
        ApiError { code, message: message.into(), field_errors: None }
    }

    pub fn with_field_errors(
        code: ApiErrorCode,
        message: impl Into<String>,
        field_errors: Vec<FieldError>,
    ) -> Self {
        ApiError { code, message: message.into(), field_errors: Some(field_errors) }
    }

    pub fn not_found(resource: impl Into<String>) -> Self {
        ApiError::new(ApiErrorCode::NotFound, format!("{} not found", resource.into()))
    }

    pub fn internal() -> Self {
        ApiError::new(ApiErrorCode::InternalServerError, "An unexpected error occurred")
    }
}

/// Pagination metadata for list responses.
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct PaginationMeta {
    pub page: u32,
    pub limit: u32,
    pub total: u64,
    pub total_pages: u32,
}

impl PaginationMeta {
    pub fn new(page: u32, limit: u32, total: u64) -> Self {
        let total_pages = ((total as f64) / (limit as f64)).ceil() as u32;
        PaginationMeta { page, limit, total, total_pages }
    }
}

/// Paginated list payload.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PaginatedData<T> {
    pub items: Vec<T>,
    pub pagination: PaginationMeta,
}

impl<T> PaginatedData<T> {
    pub fn new(items: Vec<T>, page: u32, limit: u32, total: u64) -> Self {
        PaginatedData { items, pagination: PaginationMeta::new(page, limit, total) }
    }
}

/// Envelope wrapping every API response.
///
/// On success: `success=true`, `data=Some(T)`, `error=None`.
/// On failure: `success=false`, `data=None`, `error=Some(ApiError)`.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<ApiError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn ok(data: T, message: Option<String>) -> Self {
        ApiResponse { success: true, data: Some(data), error: None, message }
    }

    pub fn err(error: ApiError) -> Self {
        ApiResponse { success: false, data: None, error: Some(error), message: None }
    }
}

// ==================== Request Models ====================

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BountyRequest {
    pub creator: String,
    pub title: String,
    pub description: String,
    pub budget: i128,
    pub deadline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BountyApplication {
    pub bounty_id: u64,
    pub freelancer: String,
    pub proposal: String,
    pub proposed_budget: i128,
    pub timeline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FreelancerRegistration {
    pub name: String,
    pub discipline: String,
    pub bio: String,
}

// ==================== Routes ====================

/// Health check endpoint
async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "stellar-api",
        "version": "0.1.0"
    }))
}

/// Create a new bounty
async fn create_bounty(
    body: web::Json<BountyRequest>,
) -> HttpResponse {
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

/// List all bounties
async fn list_bounties() -> HttpResponse {
    tracing::info!("Fetching bounties list");

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "bounties": [],
            "total": 0,
            "page": 1,
            "limit": 10
        }),
        None,
    );

    HttpResponse::Ok().json(response)
}

/// Get bounty by ID
async fn get_bounty(path: web::Path<u64>) -> HttpResponse {
    let bounty_id = path.into_inner();
    tracing::info!("Fetching bounty: {}", bounty_id);

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "id": bounty_id,
            "title": "Sample Bounty",
            "status": "open"
        }),
        None,
    );

    HttpResponse::Ok().json(response)
}

/// Apply for a bounty
async fn apply_for_bounty(
    path: web::Path<u64>,
    body: web::Json<BountyApplication>,
) -> HttpResponse {
    let bounty_id = path.into_inner();
    tracing::info!("Applying for bounty {}: {}", bounty_id, body.freelancer);

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

/// Register freelancer
async fn register_freelancer(
    body: web::Json<FreelancerRegistration>,
) -> HttpResponse {
    tracing::info!("Registering freelancer: {}", body.name);

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "freelancer_id": 1,
            "name": body.name,
            "discipline": body.discipline,
            "verified": false
        }),
        Some("Freelancer registered successfully".to_string()),
    );

    HttpResponse::Created().json(response)
}

/// List freelancers
async fn list_freelancers(query: web::Query<std::collections::HashMap<String, String>>) -> HttpResponse {
    let discipline = query.get("discipline").cloned().unwrap_or_default();
    tracing::info!("Listing freelancers with filter: {}", discipline);

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "freelancers": [],
            "total": 0,
            "filters": { "discipline": discipline }
        }),
        None,
    );

    HttpResponse::Ok().json(response)
}

/// Get freelancer profile
async fn get_freelancer(path: web::Path<String>) -> HttpResponse {
    let address = path.into_inner();
    tracing::info!("Fetching freelancer: {}", address);

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "address": address,
            "name": "John Doe",
            "discipline": "UI/UX Design",
            "rating": 4.8,
            "completed_projects": 25
        }),
        None,
    );

    HttpResponse::Ok().json(response)
}

/// Escape escrow
async fn get_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    tracing::info!("Fetching escrow: {}", escrow_id);

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "id": escrow_id,
            "status": "active",
            "amount": 5000
        }),
        None,
    );

    HttpResponse::Ok().json(response)
}

/// Release escrow funds
async fn release_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    tracing::info!("Releasing escrow: {}", escrow_id);

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "id": escrow_id,
            "status": "released",
            "transaction_id": "tx_123456"
        }),
        Some("Funds released successfully".to_string()),
    );

    HttpResponse::Ok().json(response)
}

// ==================== Main ====================

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("info,stellar_api=debug")
        .init();

    tracing::info!("Starting Stellar API Server...");

    let port = std::env::var("API_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .expect("API_PORT must be a valid port number");

    let host = std::env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    tracing::info!("Server starting on {}:{}", host, port);

    HttpServer::new(|| {
        App::new()
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            // Health check
            .route("/health", web::get().to(health))
            // Bounty routes
            .route("/api/bounties", web::post().to(create_bounty))
            .route("/api/bounties", web::get().to(list_bounties))
            .route("/api/bounties/{id}", web::get().to(get_bounty))
            .route("/api/bounties/{id}/apply", web::post().to(apply_for_bounty))
            // Freelancer routes
            .route("/api/freelancers/register", web::post().to(register_freelancer))
            .route("/api/freelancers", web::get().to(list_freelancers))
            .route("/api/freelancers/{address}", web::get().to(get_freelancer))
            // Escrow routes
            .route("/api/escrow/{id}", web::get().to(get_escrow))
            .route("/api/escrow/{id}/release", web::post().to(release_escrow))
    })
    .bind((host.parse::<std::net::IpAddr>().unwrap(), port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── ApiResponse ───────────────────────────────────────────────────────────

    #[test]
    fn test_api_response_ok() {
        let response: ApiResponse<String> = ApiResponse::ok("test".to_string(), None);
        assert!(response.success);
        assert_eq!(response.data, Some("test".to_string()));
        assert!(response.error.is_none());
    }

    #[test]
    fn test_api_response_ok_with_message() {
        let response: ApiResponse<u32> =
            ApiResponse::ok(42, Some("Created successfully".to_string()));
        assert!(response.success);
        assert_eq!(response.data, Some(42));
        assert_eq!(response.message, Some("Created successfully".to_string()));
    }

    #[test]
    fn test_api_response_err() {
        let error = ApiError::new(ApiErrorCode::NotFound, "Bounty not found");
        let response: ApiResponse<String> = ApiResponse::err(error.clone());
        assert!(!response.success);
        assert!(response.data.is_none());
        assert_eq!(response.error, Some(error));
    }

    // ── ApiError ──────────────────────────────────────────────────────────────

    #[test]
    fn test_api_error_not_found() {
        let err = ApiError::not_found("Bounty");
        assert_eq!(err.code, ApiErrorCode::NotFound);
        assert_eq!(err.message, "Bounty not found");
        assert!(err.field_errors.is_none());
    }

    #[test]
    fn test_api_error_internal() {
        let err = ApiError::internal();
        assert_eq!(err.code, ApiErrorCode::InternalServerError);
    }

    #[test]
    fn test_api_error_with_field_errors() {
        let field_errors = vec![
            FieldError { field: "title".to_string(), message: "Title is required".to_string() },
            FieldError { field: "budget".to_string(), message: "Budget must be positive".to_string() },
        ];
        let err = ApiError::with_field_errors(
            ApiErrorCode::ValidationError,
            "Validation failed",
            field_errors.clone(),
        );
        assert_eq!(err.code, ApiErrorCode::ValidationError);
        assert_eq!(err.field_errors, Some(field_errors));
    }

    // ── PaginationMeta ────────────────────────────────────────────────────────

    #[test]
    fn test_pagination_meta_exact_pages() {
        let meta = PaginationMeta::new(1, 10, 30);
        assert_eq!(meta.total_pages, 3);
        assert_eq!(meta.total, 30);
    }

    #[test]
    fn test_pagination_meta_partial_last_page() {
        let meta = PaginationMeta::new(1, 10, 25);
        assert_eq!(meta.total_pages, 3);
    }

    #[test]
    fn test_pagination_meta_zero_total() {
        let meta = PaginationMeta::new(1, 10, 0);
        assert_eq!(meta.total_pages, 0);
    }

    // ── PaginatedData ─────────────────────────────────────────────────────────

    #[test]
    fn test_paginated_data() {
        let items = vec!["a", "b", "c"];
        let pd = PaginatedData::new(items.clone(), 2, 3, 9);
        assert_eq!(pd.items, items);
        assert_eq!(pd.pagination.page, 2);
        assert_eq!(pd.pagination.total_pages, 3);
    }

    // ── Serialisation ─────────────────────────────────────────────────────────

    #[test]
    fn test_api_error_code_serialises_screaming_snake_case() {
        let json = serde_json::to_string(&ApiErrorCode::ValidationError).unwrap();
        assert_eq!(json, "\"VALIDATION_ERROR\"");
    }

    #[test]
    fn test_field_errors_omitted_when_none() {
        let err = ApiError::new(ApiErrorCode::NotFound, "not found");
        let json = serde_json::to_value(&err).unwrap();
        assert!(json.get("field_errors").is_none());
    }
}
