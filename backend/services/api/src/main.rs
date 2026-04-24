use actix_cors::Cors;
use actix_web::{http, web, App, HttpServer, HttpResponse, middleware};
use actix_web::dev::{Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::body::MessageBody;
use futures::future::{ok, Ready};
use serde::{Deserialize, Serialize};
use tracing_subscriber;

mod auth;
mod reputation;

pub const API_VERSION: &str = "1";
pub const API_PREFIX: &str = "/api/v1";

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
    #[serde(skip_serializing_if = "Option::is_none", rename = "fieldErrors")]
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
pub struct ReviewSubmission {
    #[serde(rename = "bountyId")]
    pub bounty_id: String,
    #[serde(rename = "creatorId")]
    pub creator_id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    #[serde(rename = "reviewerName")]
    pub reviewer_name: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EscrowCreateRequest {
    #[serde(rename = "bountyId")]
    pub bounty_id: String,
    #[serde(rename = "payerAddress")]
    pub payer_address: String,
    #[serde(rename = "payeeAddress")]
    pub payee_address: String,
    pub amount: i64,
    pub token: String,
    pub timelock: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EscrowRefundRequest {
    #[serde(rename = "authorizerAddress")]
    pub authorizer_address: String,
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

// ==================== Routes ====================

/// Shared helper: build a consistent JSON error response.
fn error_response(status: actix_web::http::StatusCode, code: ApiErrorCode, message: &str) -> HttpResponse {
    let body: ApiResponse<()> = ApiResponse::err(ApiError::new(code, message));
    HttpResponse::build(status)
        .content_type("application/json")
        .json(body)
}

/// Health check endpoint
async fn health() -> HttpResponse {
    HttpResponse::Ok()
        .content_type("application/json")
        .json(serde_json::json!({
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

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.creator.trim().is_empty() {
        field_errors.push(FieldError { field: "creator".into(), message: "creator is required".into() });
    }
    if body.title.trim().is_empty() {
        field_errors.push(FieldError { field: "title".into(), message: "title is required".into() });
    }
    if body.description.trim().is_empty() {
        field_errors.push(FieldError { field: "description".into(), message: "description is required".into() });
    }
    if body.budget <= 0 {
        field_errors.push(FieldError { field: "budget".into(), message: "budget must be positive".into() });
    }
    if body.deadline == 0 {
        field_errors.push(FieldError { field: "deadline".into(), message: "deadline is required".into() });
    }
    if !field_errors.is_empty() {
        let body: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
            ApiErrorCode::ValidationError,
            "Validation failed",
            field_errors,
        ));
        return HttpResponse::UnprocessableEntity()
            .content_type("application/json")
            .json(body);
    }

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

    HttpResponse::Created()
        .content_type("application/json")
        .json(response)
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

    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
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

    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
}

/// Apply for a bounty
async fn apply_for_bounty(
    path: web::Path<u64>,
    body: web::Json<BountyApplication>,
) -> HttpResponse {
    let bounty_id = path.into_inner();
    tracing::info!("Applying for bounty {}: {}", bounty_id, body.freelancer);

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.freelancer.trim().is_empty() {
        field_errors.push(FieldError { field: "freelancer".into(), message: "freelancer is required".into() });
    }
    if body.proposal.trim().is_empty() {
        field_errors.push(FieldError { field: "proposal".into(), message: "proposal is required".into() });
    }
    if body.proposed_budget <= 0 {
        field_errors.push(FieldError { field: "proposed_budget".into(), message: "proposed_budget must be positive".into() });
    }
    if !field_errors.is_empty() {
        let resp: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
            ApiErrorCode::ValidationError,
            "Validation failed",
            field_errors,
        ));
        return HttpResponse::UnprocessableEntity()
            .content_type("application/json")
            .json(resp);
    }

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "application_id": 1,
            "bounty_id": bounty_id,
            "freelancer": body.freelancer,
            "status": "pending"
        }),
        Some("Application submitted successfully".to_string()),
    );

    HttpResponse::Created()
        .content_type("application/json")
        .json(response)
}

/// Register freelancer
async fn register_freelancer(
    body: web::Json<FreelancerRegistration>,
) -> HttpResponse {
    tracing::info!("Registering freelancer: {}", body.name);

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.name.trim().is_empty() {
        field_errors.push(FieldError { field: "name".into(), message: "name is required".into() });
    }
    if body.discipline.trim().is_empty() {
        field_errors.push(FieldError { field: "discipline".into(), message: "discipline is required".into() });
    }
    if body.bio.trim().is_empty() {
        field_errors.push(FieldError { field: "bio".into(), message: "bio is required".into() });
    }
    if !field_errors.is_empty() {
        let body: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
            ApiErrorCode::ValidationError,
            "Validation failed",
            field_errors,
        ));
        return HttpResponse::UnprocessableEntity()
            .content_type("application/json")
            .json(body);
    }

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "freelancer_id": 1,
            "name": body.name,
            "discipline": body.discipline,
            "verified": false
        }),
        Some("Freelancer registered successfully".to_string()),
    );

    HttpResponse::Created()
        .content_type("application/json")
        .json(response)
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

    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
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

    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
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

    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
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
            HttpResponse::Ok()
                .content_type("application/json")
                .json(response)
        }
        None => {
            let response: ApiResponse<Creator> =
                ApiResponse::err(ApiError::not_found(format!("Creator {}", creator_id)));
            HttpResponse::NotFound()
                .content_type("application/json")
                .json(response)
        }
    }
}

/// Aggregated reputation and recent reviews for a creator profile.
async fn get_creator_reputation(path: web::Path<String>) -> HttpResponse {
    let creator_id = path.into_inner();
    tracing::info!("Fetching reputation for creator: {}", creator_id);

    let reviews = reputation::reviews_for_creator(&creator_id);
    let aggregation = reputation::aggregate_reviews(&reviews);
    let recent_reviews = reputation::recent_reviews(&reviews, 8);

    let payload = reputation::CreatorReputationPayload {
        creator_id: creator_id.clone(),
        aggregation,
        recent_reviews,
    };

    let response: ApiResponse<reputation::CreatorReputationPayload> =
        ApiResponse::ok(payload, None);
    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
}

/// Submit a review after bounty completion.
async fn submit_review(body: web::Json<ReviewSubmission>) -> HttpResponse {
    tracing::info!("Submitting review for creator: {}", body.creator_id);

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.bounty_id.trim().is_empty() {
        field_errors.push(FieldError { field: "bountyId".into(), message: "Bounty ID is required".into() });
    }
    if body.creator_id.trim().is_empty() {
        field_errors.push(FieldError { field: "creatorId".into(), message: "Creator ID is required".into() });
    }
    if !(1..=5).contains(&body.rating) {
        field_errors.push(FieldError { field: "rating".into(), message: "Rating must be between 1 and 5".into() });
    }
    if body.title.trim().is_empty() {
        field_errors.push(FieldError { field: "title".into(), message: "Title is required".into() });
    }
    if body.body.trim().is_empty() {
        field_errors.push(FieldError { field: "body".into(), message: "Feedback is required".into() });
    }
    if body.reviewer_name.trim().is_empty() {
        field_errors.push(FieldError { field: "reviewerName".into(), message: "Your name is required".into() });
    }
    if !field_errors.is_empty() {
        let resp: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
            ApiErrorCode::ValidationError,
            "Validation failed",
            field_errors,
        ));
        return HttpResponse::UnprocessableEntity()
            .content_type("application/json")
            .json(resp);
    }

    let review_id = format!("rev-{}-{}", body.creator_id, body.bounty_id);
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "reviewId": review_id }),
        Some("Review submitted successfully".to_string()),
    );
    HttpResponse::Created()
        .content_type("application/json")
        .json(response)
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

    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
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

    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
}

/// Create a new escrow
async fn create_escrow(body: web::Json<EscrowCreateRequest>) -> HttpResponse {
    tracing::info!("Creating escrow for bounty: {}", body.bounty_id);

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.bounty_id.trim().is_empty() {
        field_errors.push(FieldError { field: "bountyId".into(), message: "bountyId is required".into() });
    }
    if body.payer_address.trim().is_empty() {
        field_errors.push(FieldError { field: "payerAddress".into(), message: "payerAddress is required".into() });
    }
    if body.payee_address.trim().is_empty() {
        field_errors.push(FieldError { field: "payeeAddress".into(), message: "payeeAddress is required".into() });
    }
    if body.amount <= 0 {
        field_errors.push(FieldError { field: "amount".into(), message: "amount must be positive".into() });
    }
    if body.token.trim().is_empty() {
        field_errors.push(FieldError { field: "token".into(), message: "token is required".into() });
    }
    if !field_errors.is_empty() {
        let resp: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
            ApiErrorCode::ValidationError,
            "Validation failed",
            field_errors,
        ));
        return HttpResponse::UnprocessableEntity()
            .content_type("application/json")
            .json(resp);
    }

    let escrow_id: u64 = 1;
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "escrowId": escrow_id.to_string(),
            "txHash": format!("tx_escrow_{}", escrow_id),
            "operation": "deposit",
            "status": "pending",
            "timestamp": chrono_now()
        }),
        Some("Escrow created successfully".to_string()),
    );

    HttpResponse::Created()
        .content_type("application/json")
        .json(response)
}

/// Refund escrow to payer (work rejected or cancelled)
async fn refund_escrow(
    path: web::Path<u64>,
    body: web::Json<EscrowRefundRequest>,
) -> HttpResponse {
    let escrow_id = path.into_inner();
    tracing::info!("Refunding escrow {} to {}", escrow_id, body.authorizer_address);

    if body.authorizer_address.trim().is_empty() {
        let resp: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
            ApiErrorCode::ValidationError,
            "Validation failed",
            vec![FieldError { field: "authorizerAddress".into(), message: "authorizerAddress is required".into() }],
        ));
        return HttpResponse::UnprocessableEntity()
            .content_type("application/json")
            .json(resp);
    }

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "escrowId": escrow_id.to_string(),
            "txHash": format!("tx_refund_{}", escrow_id),
            "operation": "refund",
            "status": "pending",
            "timestamp": chrono_now()
        }),
        Some("Escrow refunded successfully".to_string()),
    );

    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
}

fn chrono_now() -> String {
    // Stable timestamp placeholder — real impl would use chrono or time crate
    "2026-01-01T00:00:00Z".to_string()
}

/// Middleware that injects `X-API-Version` into every response.
pub struct ApiVersionHeader;

impl<S, B> Transform<S, ServiceRequest> for ApiVersionHeader
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<B>;
    type Error = actix_web::Error;
    type Transform = ApiVersionHeaderMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, ()>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(ApiVersionHeaderMiddleware { service })
    }
}

pub struct ApiVersionHeaderMiddleware<S> {
    service: S,
}

impl<S, B> Service<ServiceRequest> for ApiVersionHeaderMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<B>;
    type Error = actix_web::Error;
    type Future = std::pin::Pin<Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>>>>;

    actix_web::dev::forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let fut = self.service.call(req);
        Box::pin(async move {
            let mut res = fut.await?;
            res.headers_mut().insert(
                http::header::HeaderName::from_static("x-api-version"),
                http::header::HeaderValue::from_static(API_VERSION),
            );
            Ok(res)
        })
    }
}

/// GET /api/versions — advertise supported API versions.
async fn api_versions() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "current": API_VERSION,
        "supported": ["1"],
        "deprecated": []
    }))
}

// ==================== CORS ====================

/// Build the CORS middleware from environment configuration.
///
/// Allowed origins are read from the `CORS_ALLOWED_ORIGINS` environment
/// variable as a comma-separated list (e.g. `http://localhost:3000,https://app.stellar.dev`).
/// When the variable is absent the default `http://localhost:3000` is used,
/// which covers local Next.js development.
///
/// All standard HTTP methods and the headers required by a JSON API
/// (`Content-Type`, `Authorization`, `Accept`) are permitted.
/// Credentials (cookies / auth headers) are allowed so wallet-auth flows work.
pub fn cors_middleware() -> Cors {
    let allowed_origins: Vec<String> = std::env::var("CORS_ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000".to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let mut cors = Cors::default()
        .allowed_methods(vec!["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        .allowed_headers(vec![
            http::header::CONTENT_TYPE,
            http::header::AUTHORIZATION,
            http::header::ACCEPT,
        ])
        .supports_credentials()
        .max_age(3600);

    for origin in &allowed_origins {
        cors = cors.allowed_origin(origin);
    }

    cors
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
            .wrap(cors_middleware())
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            .wrap(ApiVersionHeader)
            // Health check & version discovery (unversioned)
            .route("/health", web::get().to(health))
            .route("/api/versions", web::get().to(api_versions))
            // v1 public read-only routes
            .service(
                web::scope("/api/v1")
                    .route("/bounties", web::get().to(list_bounties))
                    .route("/bounties/{id}", web::get().to(get_bounty))
                    .route("/creators", web::get().to(list_creators))
                    .route("/creators/{id}", web::get().to(get_creator))
                    .route("/creators/{id}/reputation", web::get().to(get_creator_reputation))
                    .route("/reviews", web::post().to(submit_review))
                    .route("/freelancers", web::get().to(list_freelancers))
                    .route("/freelancers/{address}", web::get().to(get_freelancer))
                    .route("/escrow/{id}", web::get().to(get_escrow))
            )
            // Protected write routes — require valid JWT
            .service(
                web::scope("")
                    .wrap(auth::JwtMiddleware)
                    .route("/api/bounties", web::post().to(create_bounty))
                    .route("/api/bounties/{id}/apply", web::post().to(apply_for_bounty))
                    .route("/api/freelancers/register", web::post().to(register_freelancer))
                    .route("/api/escrow/create", web::post().to(create_escrow))
                    .route("/api/escrow/{id}/release", web::post().to(release_escrow))
                    .route("/api/escrow/{id}/refund", web::post().to(refund_escrow))
            )
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

    // ── CORS tests ────────────────────────────────────────────────────────────

    #[test]
    fn test_cors_middleware_builds_with_default_origin() {
        std::env::remove_var("CORS_ALLOWED_ORIGINS");
        let _cors = cors_middleware();
    }

    #[test]
    fn test_cors_middleware_builds_with_multiple_origins() {
        std::env::set_var(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:3000,https://app.stellar.dev",
        );
        let _cors = cors_middleware();
        std::env::remove_var("CORS_ALLOWED_ORIGINS");
    }

    #[actix_web::test]
    async fn test_cors_preflight_returns_200() {
        use actix_web::test as awtest;
        std::env::set_var("CORS_ALLOWED_ORIGINS", "http://localhost:3000");

        let app = awtest::init_service(
            App::new()
                .wrap(cors_middleware())
                .route("/health", web::get().to(health)),
        )
        .await;

        let req = awtest::TestRequest::default()
            .method(actix_web::http::Method::OPTIONS)
            .uri("/health")
            .insert_header(("Origin", "http://localhost:3000"))
            .insert_header(("Access-Control-Request-Method", "GET"))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert!(
            resp.status().is_success(),
            "preflight should return 2xx, got {}",
            resp.status()
        );
        let acao = resp
            .headers()
            .get("Access-Control-Allow-Origin")
            .expect("Access-Control-Allow-Origin header must be present");
        assert_eq!(acao, "http://localhost:3000");

        std::env::remove_var("CORS_ALLOWED_ORIGINS");
    }

    #[actix_web::test]
    async fn test_cors_disallowed_origin_has_no_acao_header() {
        use actix_web::test as awtest;
        std::env::set_var("CORS_ALLOWED_ORIGINS", "http://localhost:3000");

        let app = awtest::init_service(
            App::new()
                .wrap(cors_middleware())
                .route("/health", web::get().to(health)),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/health")
            .insert_header(("Origin", "https://evil.example.com"))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert!(
            resp.headers().get("Access-Control-Allow-Origin").is_none(),
            "disallowed origin must not receive ACAO header"
        );

        std::env::remove_var("CORS_ALLOWED_ORIGINS");
    }

    #[actix_web::test]
    async fn creator_reputation_integration_returns_aggregation() {
        use actix_web::test as awtest;

        let app = awtest::init_service(
            App::new().route(
                "/api/v1/creators/{id}/reputation",
                web::get().to(get_creator_reputation),
            ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/api/v1/creators/alex-studio/reputation")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["creatorId"], "alex-studio");
        let total = json["data"]["aggregation"]["totalReviews"].as_u64().unwrap();
        assert!(total >= 1);
        let avg = json["data"]["aggregation"]["averageRating"].as_f64().unwrap();
        assert!(avg > 0.0);
        assert!(json["data"]["recentReviews"].as_array().unwrap().len() >= 1);
    }

    #[actix_web::test]
    async fn escrow_get_integration_returns_active_payload() {
        use actix_web::test as awtest;

        let app = awtest::init_service(
            App::new().route("/api/v1/escrow/{id}", web::get().to(get_escrow)),
        )
        .await;

        let req = awtest::TestRequest::get().uri("/api/v1/escrow/7").to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["id"], 7);
        assert_eq!(json["data"]["status"], "active");
    }

    #[actix_web::test]
    async fn creator_reputation_unknown_id_returns_empty_aggregation() {
        use actix_web::test as awtest;

        let app = awtest::init_service(
            App::new().route(
                "/api/v1/creators/{id}/reputation",
                web::get().to(get_creator_reputation),
            ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/api/v1/creators/unknown-creator/reputation")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["data"]["aggregation"]["totalReviews"], 0);
        assert_eq!(json["data"]["aggregation"]["averageRating"], 0.0);
    }

    #[actix_web::test]
    async fn escrow_release_integration_returns_released_payload() {
        use actix_web::test as awtest;

        let app = awtest::init_service(
            App::new().route("/api/v1/escrow/{id}/release", web::post().to(release_escrow)),
        )
        .await;

        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/7/release")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["status"], "released");
        assert!(json["data"]["transaction_id"].is_string());
    }

    // ── JWT-protected route integration tests ─────────────────────────────────

    fn build_protected_app() -> actix_web::App<
        impl actix_web::dev::ServiceFactory<
            actix_web::dev::ServiceRequest,
            Config = (),
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
            InitError = (),
        >,
    > {
        App::new().service(
            web::scope("")
                .wrap(auth::JwtMiddleware)
                .route("/api/bounties", web::post().to(create_bounty))
                .route("/api/bounties/{id}/apply", web::post().to(apply_for_bounty))
                .route("/api/freelancers/register", web::post().to(register_freelancer))
                .route("/api/escrow/create", web::post().to(create_escrow))
                .route("/api/escrow/{id}/release", web::post().to(release_escrow))
                .route("/api/escrow/{id}/refund", web::post().to(refund_escrow))
        )
    }

    #[actix_web::test]
    async fn create_bounty_without_token_returns_401() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/bounties")
            .set_json(serde_json::json!({
                "creator": "wallet-1",
                "title": "Test",
                "description": "desc",
                "budget": 1000,
                "deadline": 9999999999u64
            }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn create_bounty_with_valid_token_returns_201() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");
        let token = auth::tests::make_token("wallet-1", "creator", 3600);

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/bounties")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({
                "creator": "wallet-1",
                "title": "Design Bounty",
                "description": "desc",
                "budget": 2000,
                "deadline": 9999999999u64
            }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::CREATED);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["title"], "Design Bounty");
    }

    #[actix_web::test]
    async fn apply_for_bounty_without_token_returns_401() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/bounties/1/apply")
            .set_json(serde_json::json!({
                "bounty_id": 1,
                "freelancer": "wallet-2",
                "proposal": "I can do this",
                "proposed_budget": 1800,
                "timeline": 7
            }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn register_freelancer_without_token_returns_401() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/freelancers/register")
            .set_json(serde_json::json!({
                "name": "Jane",
                "discipline": "Writing",
                "bio": "Writer"
            }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn release_escrow_without_token_returns_401() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/5/release")
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn release_escrow_with_valid_token_returns_200() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");
        let token = auth::tests::make_token("wallet-1", "creator", 3600);

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/5/release")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["status"], "released");
    }

    // ── Validation: create_bounty ─────────────────────────────────────────────

    fn build_public_write_app() -> actix_web::App<
        impl actix_web::dev::ServiceFactory<
            actix_web::dev::ServiceRequest,
            Config = (),
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
            InitError = (),
        >,
    > {
        App::new()
            .route("/api/v1/bounties", web::post().to(create_bounty))
            .route("/api/v1/bounties/{id}/apply", web::post().to(apply_for_bounty))
            .route("/api/v1/freelancers/register", web::post().to(register_freelancer))
    }

    #[actix_web::test]
    async fn create_bounty_empty_title_returns_422_with_field_error() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_public_write_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/bounties")
            .set_json(serde_json::json!({
                "creator": "wallet-1",
                "title": "",
                "description": "desc",
                "budget": 1000,
                "deadline": 9999999999u64
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array().unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"title"));
    }

    #[actix_web::test]
    async fn create_bounty_negative_budget_returns_422_with_field_error() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_public_write_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/bounties")
            .set_json(serde_json::json!({
                "creator": "wallet-1",
                "title": "Bounty",
                "description": "desc",
                "budget": -1,
                "deadline": 9999999999u64
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array().unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"budget"));
    }

    #[actix_web::test]
    async fn create_bounty_multiple_missing_fields_returns_all_errors() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_public_write_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/bounties")
            .set_json(serde_json::json!({
                "creator": "",
                "title": "",
                "description": "",
                "budget": 0,
                "deadline": 0u64
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let count = json["error"]["fieldErrors"].as_array().unwrap().len();
        assert!(count >= 4, "expected at least 4 field errors, got {count}");
    }

    // ── Validation: register_freelancer ───────────────────────────────────────

    #[actix_web::test]
    async fn register_freelancer_empty_discipline_returns_422() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_public_write_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/freelancers/register")
            .set_json(serde_json::json!({
                "name": "Jane",
                "discipline": "",
                "bio": "Writer"
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array().unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"discipline"));
    }

    #[actix_web::test]
    async fn register_freelancer_all_empty_returns_all_field_errors() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_public_write_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/freelancers/register")
            .set_json(serde_json::json!({ "name": "", "discipline": "", "bio": "" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"]["fieldErrors"].as_array().unwrap().len(), 3);
    }

    // ── Validation: apply_for_bounty ──────────────────────────────────────────

    #[actix_web::test]
    async fn apply_for_bounty_empty_proposal_returns_422() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_public_write_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/bounties/1/apply")
            .set_json(serde_json::json!({
                "bounty_id": 1,
                "freelancer": "wallet-2",
                "proposal": "",
                "proposed_budget": 500,
                "timeline": 7
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array().unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"proposal"));
    }

    // ── submit_review ─────────────────────────────────────────────────────────

    fn build_review_app() -> actix_web::App<
        impl actix_web::dev::ServiceFactory<
            actix_web::dev::ServiceRequest,
            Config = (),
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
            InitError = (),
        >,
    > {
        App::new().route("/api/v1/reviews", web::post().to(submit_review))
    }

    #[actix_web::test]
    async fn submit_review_valid_returns_201_with_review_id() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_review_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/reviews")
            .set_json(serde_json::json!({
                "bountyId": "b-1",
                "creatorId": "alex-studio",
                "rating": 5,
                "title": "Excellent work",
                "body": "Delivered on time and exceeded expectations.",
                "reviewerName": "Jane D."
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::CREATED);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert!(json["data"]["reviewId"].is_string());
    }

    #[actix_web::test]
    async fn submit_review_missing_fields_returns_422_with_all_errors() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_review_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/reviews")
            .set_json(serde_json::json!({
                "bountyId": "",
                "creatorId": "",
                "rating": 0,
                "title": "",
                "body": "",
                "reviewerName": ""
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
        let count = json["error"]["fieldErrors"].as_array().unwrap().len();
        assert_eq!(count, 6);
    }

    #[actix_web::test]
    async fn submit_review_rating_out_of_range_returns_422() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_review_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/reviews")
            .set_json(serde_json::json!({
                "bountyId": "b-1",
                "creatorId": "c-1",
                "rating": 6,
                "title": "Good",
                "body": "Nice work.",
                "reviewerName": "Alice"
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array().unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"rating"));
    }

    #[actix_web::test]
    async fn apply_for_bounty_zero_budget_returns_422() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_public_write_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/bounties/1/apply")
            .set_json(serde_json::json!({
                "bounty_id": 1,
                "freelancer": "wallet-2",
                "proposal": "I can do this",
                "proposed_budget": 0,
                "timeline": 7
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array().unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"proposed_budget"));
    }

    // ── POST /api/escrow/create ───────────────────────────────────────────────

    fn build_escrow_app() -> actix_web::App<
        impl actix_web::dev::ServiceFactory<
            actix_web::dev::ServiceRequest,
            Config = (),
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
            InitError = (),
        >,
    > {
        App::new()
            .route("/api/escrow/create", web::post().to(create_escrow))
            .route("/api/escrow/{id}/refund", web::post().to(refund_escrow))
    }

    #[actix_web::test]
    async fn create_escrow_without_token_returns_401() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/escrow/create")
            .set_json(serde_json::json!({
                "bountyId": "b-1",
                "payerAddress": "GPAYER",
                "payeeAddress": "GPAYEE",
                "amount": 1000,
                "token": "GUSDC"
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn create_escrow_with_valid_token_returns_201() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");
        let token = auth::tests::make_token("wallet-1", "creator", 3600);

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/escrow/create")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({
                "bountyId": "b-1",
                "payerAddress": "GPAYER",
                "payeeAddress": "GPAYEE",
                "amount": 2500,
                "token": "GUSDC"
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::CREATED);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["operation"], "deposit");
        assert_eq!(json["data"]["status"], "pending");
        assert!(json["data"]["escrowId"].is_string());
        assert!(json["data"]["txHash"].is_string());
    }

    #[actix_web::test]
    async fn create_escrow_missing_fields_returns_422() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_escrow_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/escrow/create")
            .set_json(serde_json::json!({
                "bountyId": "",
                "payerAddress": "",
                "payeeAddress": "",
                "amount": 0,
                "token": ""
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
        let count = json["error"]["fieldErrors"].as_array().unwrap().len();
        assert_eq!(count, 5);
    }

    #[actix_web::test]
    async fn create_escrow_negative_amount_returns_422() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_escrow_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/escrow/create")
            .set_json(serde_json::json!({
                "bountyId": "b-1",
                "payerAddress": "GPAYER",
                "payeeAddress": "GPAYEE",
                "amount": -100,
                "token": "GUSDC"
            }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array().unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"amount"));
    }

    // ── POST /api/escrow/:id/refund ───────────────────────────────────────────

    #[actix_web::test]
    async fn refund_escrow_without_token_returns_401() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/escrow/5/refund")
            .set_json(serde_json::json!({ "authorizerAddress": "GPAYER" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn refund_escrow_with_valid_token_returns_200() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");
        let token = auth::tests::make_token("wallet-1", "creator", 3600);

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/escrow/5/refund")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "authorizerAddress": "GPAYER123" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["operation"], "refund");
        assert_eq!(json["data"]["status"], "pending");
        assert_eq!(json["data"]["escrowId"], "5");
    }

    #[actix_web::test]
    async fn refund_escrow_missing_authorizer_returns_422() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_escrow_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/escrow/5/refund")
            .set_json(serde_json::json!({ "authorizerAddress": "" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array().unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"authorizerAddress"));
    }

    // ── API versioning ────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn api_versions_endpoint_returns_current_version() {
        use actix_web::test as awtest;
        let app = awtest::init_service(
            App::new().route("/api/versions", web::get().to(api_versions)),
        )
        .await;
        let req = awtest::TestRequest::get().uri("/api/versions").to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["current"], "1");
        assert!(json["supported"].as_array().unwrap().contains(&serde_json::json!("1")));
    }

    #[actix_web::test]
    async fn v1_routes_respond_correctly() {
        use actix_web::test as awtest;
        let app = awtest::init_service(
            App::new().service(
                web::scope("/api/v1")
                    .route("/bounties", web::get().to(list_bounties))
                    .route("/creators", web::get().to(list_creators))
                    .route("/freelancers", web::get().to(list_freelancers)),
            ),
        )
        .await;

        for uri in &["/api/v1/bounties", "/api/v1/creators", "/api/v1/freelancers"] {
            let req = awtest::TestRequest::get().uri(uri).to_request();
            let resp = awtest::call_service(&app, req).await;
            assert_eq!(resp.status(), actix_web::http::StatusCode::OK, "failed for {uri}");
        }
    }

    #[actix_web::test]
    async fn unversioned_api_path_returns_404() {
        use actix_web::test as awtest;
        let app = awtest::init_service(
            App::new().service(
                web::scope("/api/v1").route("/bounties", web::get().to(list_bounties)),
            ),
        )
        .await;
        let req = awtest::TestRequest::get().uri("/api/bounties").to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn version_header_middleware_injects_x_api_version() {
        use actix_web::test as awtest;
        let app = awtest::init_service(
            App::new()
                .wrap(ApiVersionHeader)
                .route("/health", web::get().to(health)),
        )
        .await;
        let req = awtest::TestRequest::get().uri("/health").to_request();
        let resp = awtest::call_service(&app, req).await;
        let header = resp.headers().get("x-api-version").expect("x-api-version header must be present");
        assert_eq!(header, API_VERSION);
    }
}
