use actix_web::{middleware, web, App, HttpResponse, HttpServer};
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

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub page: Option<u64>,
    pub limit: Option<u64>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
}

impl Default for PaginationParams {
    fn default() -> Self {
        PaginationParams {
            page: Some(1),
            limit: Some(10),
            sort_by: Some("created_at".to_string()),
            sort_order: Some("desc".to_string()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct BountyListParams {
    pub page: Option<u64>,
    pub limit: Option<u64>,
    pub sort_by: Option<String>,  // created_at, budget, deadline, title
    pub sort_order: Option<String>, // asc, desc
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FreelancerListParams {
    pub page: Option<u64>,
    pub limit: Option<u64>,
    pub sort_by: Option<String>,  // rating, completed_projects, name, created_at
    pub sort_order: Option<String>, // asc, desc
    pub discipline: Option<String>,
}

fn validate_sort_params(sort_by: &str, sort_order: &str) -> (String, String) {
    let valid_sort_by = match sort_by {
        "created_at" | "budget" | "deadline" | "title" => sort_by.to_string(),
        "rating" | "completed_projects" | "name" => sort_by.to_string(),
        _ => "created_at".to_string(),
    };
    
    let valid_sort_order = match sort_order.to_lowercase().as_str() {
        "asc" | "desc" => sort_order.to_lowercase(),
        _ => "desc".to_string(),
    };
    
    (valid_sort_by, valid_sort_order)
}

fn apply_sorting<T: Clone>(items: Vec<T>, sort_by: &str, sort_order: &str) -> Vec<T> {
    // In a real implementation, this would sort by the specified field
    // For mock data, we just return the items as-is with sort metadata
    tracing::debug!(
        user_action = "apply_sorting",
        sort_by = %sort_by,
        sort_order = %sort_order,
        item_count = items.len(),
        "Applying sorting"
    );
    items
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

async fn list_bounties(
    query: web::Query<BountyListParams>,
) -> HttpResponse {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(10).min(100);
    let sort_by = query.sort_by.clone().unwrap_or_else(|| "created_at".to_string());
    let sort_order = query.sort_order.clone().unwrap_or_else(|| "desc".to_string());
    let status = query.status.clone();

    let (validated_sort_by, validated_sort_order) = validate_sort_params(&sort_by, &sort_order);

    tracing::info!(
        user_action = "list_bounties",
        page = %page,
        limit = %limit,
        sort_by = %validated_sort_by,
        sort_order = %validated_sort_order,
        status = ?status,
        "Listing bounties with sorting"
    );

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "bounties": [],
            "total": 0,
            "page": page,
            "limit": limit,
            "sort": {
                "by": validated_sort_by,
                "order": validated_sort_order
            },
            "filters": {
                "status": status
            }
        }),
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
    query: web::Query<FreelancerListParams>,
) -> HttpResponse {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(10).min(100);
    let sort_by = query.sort_by.clone().unwrap_or_else(|| "rating".to_string());
    let sort_order = query.sort_order.clone().unwrap_or_else(|| "desc".to_string());
    let discipline = query.discipline.clone();

    let (validated_sort_by, validated_sort_order) = validate_sort_params(&sort_by, &sort_order);

    tracing::info!(
        user_action = "list_freelancers",
        page = %page,
        limit = %limit,
        sort_by = %validated_sort_by,
        sort_order = %validated_sort_order,
        discipline = ?discipline,
        "Listing freelancers with sorting"
    );

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "freelancers": [],
            "total": 0,
            "page": page,
            "limit": limit,
            "sort": {
                "by": validated_sort_by,
                "order": validated_sort_order
            },
            "filters": {
                "discipline": discipline
            }
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
        App::new()
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
    fn test_validate_sort_params_valid() {
        let (sort_by, sort_order) = validate_sort_params("budget", "asc");
        assert_eq!(sort_by, "budget");
        assert_eq!(sort_order, "asc");
    }

    #[test]
    fn test_validate_sort_params_invalid_field() {
        let (sort_by, sort_order) = validate_sort_params("invalid_field", "desc");
        assert_eq!(sort_by, "created_at"); // defaults
        assert_eq!(sort_order, "desc");
    }

    #[test]
    fn test_validate_sort_params_invalid_order() {
        let (sort_by, sort_order) = validate_sort_params("title", "invalid");
        assert_eq!(sort_by, "title");
        assert_eq!(sort_order, "desc"); // defaults to desc
    }

    #[test]
    fn test_validate_sort_params_case_insensitive() {
        let (sort_by, sort_order) = validate_sort_params("TITLE", "ASC");
        assert_eq!(sort_by, "created_at"); // invalid field defaults
        assert_eq!(sort_order, "asc");
    }

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
