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
pub struct Project {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub image: String,
    pub link: Option<String>,
    pub tags: Vec<String>,
    pub year: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Creator {
    pub id: String,
    pub name: String,
    pub title: String,
    pub discipline: String,
    pub bio: String,
    pub avatar: String,
    #[serde(rename = "coverImage")]
    pub cover_image: String,
    pub tagline: String,
    #[serde(rename = "linkedIn")]
    pub linked_in: String,
    pub twitter: String,
    pub portfolio: Option<String>,
    pub projects: Vec<Project>,
    pub skills: Vec<String>,
    pub stats: Option<CreatorStats>,
    #[serde(rename = "hourlyRate")]
    pub hourly_rate: Option<i32>,
    #[serde(rename = "responseTime")]
    pub response_time: Option<String>,
    pub availability: Option<String>,
    pub rating: Option<f32>,
    #[serde(rename = "reviewCount")]
    pub review_count: Option<i32>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CreatorStats {
    pub projects: i32,
    pub clients: i32,
    pub experience: i32,
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

/// List creators with optional filter by discipline
async fn list_creators(query: web::Query<std::collections::HashMap<String, String>>) -> HttpResponse {
    let discipline = query.get("discipline").cloned();
    let search = query.get("search").cloned();
    
    tracing::info!("Listing creators with filters - discipline: {:?}, search: {:?}", discipline, search);

    // Mock data for creators - in production this would fetch from database
    let all_creators: Vec<Creator> = vec![
        Creator {
            id: "alex-studio".to_string(),
            name: "Alex Chen".to_string(),
            title: "Product Designer".to_string(),
            discipline: "UI/UX Design".to_string(),
            bio: "Crafting intuitive digital experiences that solve real problems. Specialized in design systems and user-centered methodology.".to_string(),
            avatar: "/avatars/alex-chen.jpg".to_string(),
            cover_image: "/covers/design-studio.jpg".to_string(),
            tagline: "Design systems that scale".to_string(),
            linked_in: "https://linkedin.com/in/alexchen".to_string(),
            twitter: "https://x.com/alexchen".to_string(),
            portfolio: Some("https://alexchen.design".to_string()),
            projects: vec![],
            skills: vec!["Figma".to_string(), "Design Systems".to_string(), "Prototyping".to_string()],
            stats: Some(CreatorStats {
                projects: 45,
                clients: 20,
                experience: 8,
            }),
            hourly_rate: Some(150),
            response_time: Some("2 hours".to_string()),
            availability: Some("available".to_string()),
            rating: Some(4.9),
            review_count: Some(82),
        },
        Creator {
            id: "jordan-dev".to_string(),
            name: "Jordan Smith".to_string(),
            title: "Full Stack Developer".to_string(),
            discipline: "Software Development".to_string(),
            bio: "Experienced full-stack developer with expertise in React, Node.js, and cloud technologies.".to_string(),
            avatar: "/avatars/jordan-smith.jpg".to_string(),
            cover_image: "/covers/dev-workspace.jpg".to_string(),
            tagline: "Building scalable web applications".to_string(),
            linked_in: "https://linkedin.com/in/jordansmith".to_string(),
            twitter: "https://x.com/jordansmith".to_string(),
            portfolio: Some("https://jordansmith.dev".to_string()),
            projects: vec![],
            skills: vec!["React".to_string(), "Node.js".to_string(), "TypeScript".to_string(), "PostgreSQL".to_string()],
            stats: Some(CreatorStats {
                projects: 52,
                clients: 28,
                experience: 10,
            }),
            hourly_rate: Some(120),
            response_time: Some("1 hour".to_string()),
            availability: Some("limited".to_string()),
            rating: Some(4.8),
            review_count: Some(95),
        },
        Creator {
            id: "maya-content".to_string(),
            name: "Maya Rodriguez".to_string(),
            title: "Content Strategist".to_string(),
            discipline: "Content Creation".to_string(),
            bio: "Digital content strategist specializing in brand storytelling and audience engagement.".to_string(),
            avatar: "/avatars/maya-rodriguez.jpg".to_string(),
            cover_image: "/covers/content-creative.jpg".to_string(),
            tagline: "Stories that drive engagement".to_string(),
            linked_in: "https://linkedin.com/in/mayarodriguez".to_string(),
            twitter: "https://x.com/mayarodriguez".to_string(),
            portfolio: Some("https://mayarodriguez.com".to_string()),
            projects: vec![],
            skills: vec!["Copywriting".to_string(), "SEO".to_string(), "Social Media".to_string()],
            stats: Some(CreatorStats {
                projects: 38,
                clients: 15,
                experience: 6,
            }),
            hourly_rate: Some(85),
            response_time: Some("4 hours".to_string()),
            availability: Some("available".to_string()),
            rating: Some(4.7),
            review_count: Some(45),
        },
    ];

    // Filter creators based on query parameters
    let filtered_creators: Vec<Creator> = all_creators
        .into_iter()
        .filter(|creator| {
            if let Some(ref d) = discipline {
                if !creator.discipline.to_lowercase().contains(&d.to_lowercase()) {
                    return false;
                }
            }
            if let Some(ref s) = search {
                if !creator.name.to_lowercase().contains(&s.to_lowercase())
                    && !creator.bio.to_lowercase().contains(&s.to_lowercase())
                    && !creator.skills.iter().any(|skill| skill.to_lowercase().contains(&s.to_lowercase()))
                {
                    return false;
                }
            }
            true
        })
        .collect();

    let total = filtered_creators.len();

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "creators": filtered_creators,
            "total": total,
            "filters": {
                "discipline": discipline,
                "search": search
            }
        }),
        None,
    );

    HttpResponse::Ok().json(response)
}

/// Get a specific creator by ID
async fn get_creator(path: web::Path<String>) -> HttpResponse {
    let creator_id = path.into_inner();
    tracing::info!("Fetching creator: {}", creator_id);

    // Mock creator data - in production this would fetch from database
    let creator = match creator_id.as_str() {
        "alex-studio" => Some(Creator {
            id: "alex-studio".to_string(),
            name: "Alex Chen".to_string(),
            title: "Product Designer".to_string(),
            discipline: "UI/UX Design".to_string(),
            bio: "Crafting intuitive digital experiences that solve real problems. Specialized in design systems and user-centered methodology.".to_string(),
            avatar: "/avatars/alex-chen.jpg".to_string(),
            cover_image: "/covers/design-studio.jpg".to_string(),
            tagline: "Design systems that scale".to_string(),
            linked_in: "https://linkedin.com/in/alexchen".to_string(),
            twitter: "https://x.com/alexchen".to_string(),
            portfolio: Some("https://alexchen.design".to_string()),
            projects: vec![],
            skills: vec!["Figma".to_string(), "Design Systems".to_string(), "Prototyping".to_string()],
            stats: Some(CreatorStats {
                projects: 45,
                clients: 20,
                experience: 8,
            }),
            hourly_rate: Some(150),
            response_time: Some("2 hours".to_string()),
            availability: Some("available".to_string()),
            rating: Some(4.9),
            review_count: Some(82),
        }),
        _ => None,
    };

    match creator {
        Some(c) => {
            let response: ApiResponse<Creator> = ApiResponse::ok(c, None);
            HttpResponse::Ok().json(response)
        }
        None => {
            let response: ApiResponse<Creator> = ApiResponse::err(format!("Creator {} not found", creator_id));
            HttpResponse::NotFound().json(response)
        }
    }
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
            // Creator routes
            .route("/api/creators", web::get().to(list_creators))
            .route("/api/creators/{id}", web::get().to(get_creator))
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
