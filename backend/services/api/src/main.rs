use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tracing_subscriber;

// ==================== Data Models ====================

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

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub message: Option<String>,
}

impl<T> ApiResponse<T> {
    fn ok(data: T, message: Option<String>) -> Self {
        ApiResponse {
            success: true,
            data: Some(data),
            error: None,
            message,
        }
    }

    fn err(error: String) -> Self
    where
        T: Default,
    {
        ApiResponse {
            success: false,
            data: None,
            error: Some(error),
            message: None,
        }
    }
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

    // In a real implementation, this would interact with Soroban contract
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
}
