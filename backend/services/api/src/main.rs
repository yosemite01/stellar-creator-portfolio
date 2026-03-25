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
pub struct BountyListParams {
    pub page: Option<u64>,
    pub limit: Option<u64>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    // Filter parameters
    pub status: Option<String>,        // open, in_progress, completed, cancelled
    pub min_budget: Option<i128>,     // Minimum budget filter
    pub max_budget: Option<i128>,     // Maximum budget filter
    pub creator: Option<String>,       // Filter by creator address
    pub search: Option<String>,        // Search in title/description
}

#[derive(Debug, Deserialize)]
pub struct FreelancerListParams {
    pub page: Option<u64>,
    pub limit: Option<u64>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    // Filter parameters
    pub discipline: Option<String>,    // Filter by discipline
    pub min_rating: Option<f64>,      // Minimum rating filter
    pub max_completed: Option<u64>,   // Max completed projects filter
    pub verified: Option<bool>,        // Verified freelancers only
    pub search: Option<String>,        // Search in name/bio
}

fn validate_bounty_status(status: &str) -> Option<String> {
    let valid = match status.to_lowercase().as_str() {
        "open" | "in_progress" | "completed" | "cancelled" => status.to_lowercase(),
        _ => return None,
    };
    Some(valid)
}

fn validate_discipline(discipline: &str) -> String {
    let d = discipline.to_lowercase();
    let valid_disciplines = [
        "frontend", "backend", "fullstack", "devops", "mobile",
        "blockchain", "ai", "ml", "security", "data",
        "ux", "ui", "design", "marketing", "writing",
    ];
    if valid_disciplines.contains(&d.as_str()) {
        d
    } else {
        discipline.to_string()
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

async fn list_bounties(
    query: web::Query<BountyListParams>,
) -> HttpResponse {
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(10).min(100);
    let sort_by = query.sort_by.clone().unwrap_or_else(|| "created_at".to_string());
    let sort_order = query.sort_order.clone().unwrap_or_else(|| "desc".to_string());

    // Build filters
    let status = query.status.as_ref()
        .and_then(|s| validate_bounty_status(s))
        .map(|s| {
            tracing::debug!(user_action = "filter", field = "status", value = %s, "Applying status filter");
            s
        });

    let min_budget = query.min_budget.map(|b| {
        tracing::debug!(user_action = "filter", field = "min_budget", value = %b, "Applying budget filter");
        b
    });

    let max_budget = query.max_budget.map(|b| {
        tracing::debug!(user_action = "filter", field = "max_budget", value = %b, "Applying budget filter");
        b
    });

    let creator = query.creator.as_ref().map(|c| {
        tracing::debug!(user_action = "filter", field = "creator", value = %c, "Applying creator filter");
        c.clone()
    });

    let search = query.search.as_ref().map(|s| {
        tracing::debug!(user_action = "filter", field = "search", value = %s, "Applying search filter");
        s.clone()
    });

    tracing::info!(
        user_action = "list_bounties",
        page = %page,
        limit = %limit,
        sort_by = %sort_by,
        sort_order = %sort_order,
        status = ?status,
        min_budget = ?min_budget,
        max_budget = ?max_budget,
        has_creator_filter = %creator.is_some(),
        has_search_filter = %search.is_some(),
        "Listing bounties with filters"
    );

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "bounties": [],
            "total": 0,
            "page": page,
            "limit": limit,
            "sort": {
                "by": sort_by,
                "order": sort_order
            },
            "filters": {
                "status": status,
                "min_budget": min_budget,
                "max_budget": max_budget,
                "creator": creator,
                "search": search
            }
        }),
        None,
    );
    HttpResponse::Ok().json(response)
}

async fn get_bounty(path: web::Path<u64>) -> HttpResponse {
    let bounty_id = path.into_inner();
    tracing::info!(
        user_action = "get_bounty",
        entity_type = "bounty",
        entity_id = %bounty_id,
        "Fetching bounty"
    );
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
    tracing::info!(
        user_action = "apply_for_bounty",
        entity_type = "application",
        bounty_id = %bounty_id,
        freelancer = %body.freelancer,
        "Submitting bounty application"
    );
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
    tracing::info!(
        user_action = "register_freelancer",
        entity_type = "freelancer",
        name = %body.name,
        discipline = %body.discipline,
        "Registering freelancer"
    );
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

    // Build filters
    let discipline = query.discipline.as_ref().map(|d| {
        let validated = validate_discipline(d);
        tracing::debug!(user_action = "filter", field = "discipline", value = %validated, "Applying discipline filter");
        validated
    });

    let min_rating = query.min_rating.map(|r| {
        tracing::debug!(user_action = "filter", field = "min_rating", value = %r, "Applying rating filter");
        r
    });

    let max_completed = query.max_completed.map(|c| {
        tracing::debug!(user_action = "filter", field = "max_completed", value = %c, "Applying max completed filter");
        c
    });

    let verified = query.verified.map(|v| {
        tracing::debug!(user_action = "filter", field = "verified", value = %v, "Applying verified filter");
        v
    });

    let search = query.search.as_ref().map(|s| {
        tracing::debug!(user_action = "filter", field = "search", value = %s, "Applying search filter");
        s.clone()
    });

    tracing::info!(
        user_action = "list_freelancers",
        page = %page,
        limit = %limit,
        sort_by = %sort_by,
        sort_order = %sort_order,
        discipline = ?discipline,
        min_rating = ?min_rating,
        max_completed = ?max_completed,
        verified = ?verified,
        has_search_filter = %search.is_some(),
        "Listing freelancers with filters"
    );

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "freelancers": [],
            "total": 0,
            "page": page,
            "limit": limit,
            "sort": {
                "by": sort_by,
                "order": sort_order
            },
            "filters": {
                "discipline": discipline,
                "min_rating": min_rating,
                "max_completed": max_completed,
                "verified": verified,
                "search": search
            }
        }),
        None,
    );
    HttpResponse::Ok().json(response)
}

async fn get_freelancer(path: web::Path<String>) -> HttpResponse {
    let address = path.into_inner();
    tracing::info!(
        user_action = "get_freelancer",
        entity_type = "freelancer",
        entity_id = %address,
        "Fetching freelancer profile"
    );
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
    tracing::info!(
        user_action = "get_escrow",
        entity_type = "escrow",
        entity_id = %escrow_id,
        "Fetching escrow"
    );
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": escrow_id, "status": "active", "amount": 0 }),
        None,
    );
    HttpResponse::Ok().json(response)
}

async fn release_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    tracing::info!(
        user_action = "release_escrow",
        entity_type = "escrow",
        entity_id = %escrow_id,
        "Releasing escrow funds"
    );
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
    fn test_validate_bounty_status_valid() {
        assert_eq!(validate_bounty_status("open"), Some("open".to_string()));
        assert_eq!(validate_bounty_status("in_progress"), Some("in_progress".to_string()));
        assert_eq!(validate_bounty_status("completed"), Some("completed".to_string()));
        assert_eq!(validate_bounty_status("cancelled"), Some("cancelled".to_string()));
    }

    #[test]
    fn test_validate_bounty_status_case_insensitive() {
        assert_eq!(validate_bounty_status("OPEN"), Some("open".to_string()));
        assert_eq!(validate_bounty_status("In_Progress"), Some("in_progress".to_string()));
    }

    #[test]
    fn test_validate_bounty_status_invalid() {
        assert_eq!(validate_bounty_status("invalid"), None);
        assert_eq!(validate_bounty_status("pending"), None);
    }

    #[test]
    fn test_validate_discipline_valid() {
        assert_eq!(validate_discipline("backend"), "backend");
        assert_eq!(validate_discipline("frontend"), "frontend");
        assert_eq!(validate_discipline("blockchain"), "blockchain");
    }

    #[test]
    fn test_validate_discipline_case_insensitive() {
        assert_eq!(validate_discipline("BACKEND"), "backend");
        assert_eq!(validate_discipline("Blockchain"), "blockchain");
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
