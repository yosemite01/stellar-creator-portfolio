use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use serde::{Deserialize, Serialize};
use tracing_subscriber;
use validator::Validate;

#[derive(Clone, Serialize, Deserialize, Debug, Validate)]
pub struct BountyRequest {
    #[validate(length(min = 1, max = 200, message = "Title must be between 1 and 200 characters"))]
    pub creator: String,
    #[validate(length(min = 1, max = 200, message = "Title must be between 1 and 200 characters"))]
    pub title: String,
    #[validate(length(min = 1, max = 5000, message = "Description must be between 1 and 5000 characters"))]
    pub description: String,
    #[validate(range(min = 1, message = "Budget must be positive"))]
    pub budget: i128,
    #[validate(range(min = 1, message = "Deadline must be a future timestamp"))]
    pub deadline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug, Validate)]
pub struct BountyApplication {
    #[validate(range(min = 1, message = "Bounty ID must be positive"))]
    pub bounty_id: u64,
    #[validate(length(min = 1, message = "Freelancer address is required"))]
    pub freelancer: String,
    #[validate(length(min = 1, max = 2000, message = "Proposal must be between 1 and 2000 characters"))]
    pub proposal: String,
    #[validate(range(min = 1, message = "Proposed budget must be positive"))]
    pub proposed_budget: i128,
    #[validate(range(min = 1, message = "Timeline must be at least 1 hour"))]
    pub timeline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug, Validate)]
pub struct FreelancerRegistration {
    #[validate(length(min = 1, max = 100, message = "Name must be between 1 and 100 characters"))]
    pub name: String,
    #[validate(length(min = 1, max = 100, message = "Discipline must be between 1 and 100 characters"))]
    pub discipline: String,
    #[validate(length(max = 2000, message = "Bio must be at most 2000 characters"))]
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

fn validate_request<T: Validate>(req: &T) -> Option<String> {
    if let Err(errors) = req.validate() {
        let error_messages: Vec<String> = errors
            .field_errors()
            .iter()
            .flat_map(|(field, errors)| {
                errors.iter().map(move |e| {
                    e.message
                        .clone()
                        .map(|m| m.to_string())
                        .unwrap_or_else(|| format!("Invalid value for {}", field))
                })
            })
            .collect();
        Some(error_messages.join("; "))
    } else {
        None
    }
}

async fn create_bounty(body: web::Json<BountyRequest>) -> HttpResponse {
    if let Some(err_msg) = validate_request(&body) {
        tracing::warn!("Invalid bounty request: {}", err_msg);
        return HttpResponse::BadRequest().json(ApiResponse::<()>::err(err_msg));
    }

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
    if let Some(err_msg) = validate_request(&body) {
        tracing::warn!("Invalid application request: {}", err_msg);
        return HttpResponse::BadRequest().json(ApiResponse::<()>::err(err_msg));
    }

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
    if let Some(err_msg) = validate_request(&body) {
        tracing::warn!("Invalid freelancer registration: {}", err_msg);
        return HttpResponse::BadRequest().json(ApiResponse::<()>::err(err_msg));
    }

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
    if address.is_empty() {
        return HttpResponse::BadRequest().json(
            ApiResponse::<()>::err("Address cannot be empty".to_string()),
        );
    }
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
    fn test_bounty_request_validation_empty_title() {
        let req = BountyRequest {
            creator: "creator1".to_string(),
            title: "".to_string(),
            description: "desc".to_string(),
            budget: 100,
            deadline: 9999999999,
        };
        assert!(validate_request(&req).is_some());
    }

    #[test]
    fn test_bounty_request_validation_negative_budget() {
        let req = BountyRequest {
            creator: "creator1".to_string(),
            title: "Valid Title".to_string(),
            description: "desc".to_string(),
            budget: -100,
            deadline: 9999999999,
        };
        assert!(validate_request(&req).is_some());
    }

    #[test]
    fn test_bounty_request_validation_valid() {
        let req = BountyRequest {
            creator: "creator1".to_string(),
            title: "Valid Title".to_string(),
            description: "Valid description".to_string(),
            budget: 100,
            deadline: 9999999999,
        };
        assert!(validate_request(&req).is_none());
    }

    #[test]
    fn test_freelancer_registration_validation_empty_name() {
        let req = FreelancerRegistration {
            name: "".to_string(),
            discipline: "Rust Developer".to_string(),
            bio: "Bio".to_string(),
        };
        assert!(validate_request(&req).is_some());
    }

    #[test]
    fn test_freelancer_registration_validation_valid() {
        let req = FreelancerRegistration {
            name: "John Doe".to_string(),
            discipline: "Rust Developer".to_string(),
            bio: "Expert Rust developer".to_string(),
        };
        assert!(validate_request(&req).is_none());
    }
}
