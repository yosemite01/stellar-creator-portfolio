use actix_web::{middleware, web, App, HttpResponse, HttpServer, HttpRequest, HttpMessage};
use actix_cors::Cors;
use serde::{Deserialize, Serialize};
use tracing_subscriber;

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

    #[allow(dead_code)]
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

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "stellar-api",
        "version": "0.1.0"
    }))
}

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

async fn list_bounties() -> HttpResponse {
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "bounties": [], "total": 0, "page": 1, "limit": 10 }),
        None,
    );
    HttpResponse::Ok().json(response)
}

async fn get_bounty(path: web::Path<u64>) -> HttpResponse {
    let bounty_id = path.into_inner();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": bounty_id, "title": "Sample Bounty", "status": "open" }),
        None,
    );
    HttpResponse::Ok().json(response)
}

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

async fn register_freelancer(body: web::Json<FreelancerRegistration>) -> HttpResponse {
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "name": body.name,
            "discipline": body.discipline,
            "verified": false
        }),
        Some("Freelancer registered successfully".to_string()),
    );
    HttpResponse::Created().json(response)
}

async fn list_freelancers(
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let discipline = query.get("discipline").cloned().unwrap_or_default();
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

async fn get_freelancer(path: web::Path<String>) -> HttpResponse {
    let address = path.into_inner();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "address": address,
            "discipline": "UI/UX Design",
            "rating": 4.8,
            "completed_projects": 0
        }),
        None,
    );
    HttpResponse::Ok().json(response)
}

async fn get_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": escrow_id, "status": "active", "amount": 0 }),
        None,
    );
    HttpResponse::Ok().json(response)
}

async fn release_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": escrow_id, "status": "released" }),
        Some("Funds released successfully".to_string()),
    );
    HttpResponse::Ok().json(response)
}

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

    tracing::info!("Starting Stellar API on {}:{}", host, port);

    HttpServer::new(|| {
        // CORS middleware configuration
        let cors = Cors::default()
            .allow_any_origin()
            .allowed_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
            .allowed_headers(vec![
                actix_web::http::header::AUTHORIZATION,
                actix_web::http::header::ACCEPT,
                actix_web::http::header::CONTENT_TYPE,
            ])
            .max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
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
