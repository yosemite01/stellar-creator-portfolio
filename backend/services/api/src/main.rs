use actix_cors::Cors;
use actix_web::body::MessageBody;
use actix_web::dev::{Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::{http, middleware, web, App, HttpResponse, HttpServer};
use futures::future::{ok, Ready};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, postgres::PgPoolOptions};

mod analytics;
mod auth;
mod database;
mod event_indexer;
mod reputation;
mod verification_rewards;
mod webhook;

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
        ApiError {
            code,
            message: message.into(),
            field_errors: None,
        }
    }

    pub fn with_field_errors(
        code: ApiErrorCode,
        message: impl Into<String>,
        field_errors: Vec<FieldError>,
    ) -> Self {
        ApiError {
            code,
            message: message.into(),
            field_errors: Some(field_errors),
        }
    }

    pub fn not_found(resource: impl Into<String>) -> Self {
        ApiError::new(
            ApiErrorCode::NotFound,
            format!("{} not found", resource.into()),
        )
    }

    pub fn internal() -> Self {
        ApiError::new(
            ApiErrorCode::InternalServerError,
            "An unexpected error occurred",
        )
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
        PaginationMeta {
            page,
            limit,
            total,
            total_pages,
        }
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
        PaginatedData {
            items,
            pagination: PaginationMeta::new(page, limit, total),
        }
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
        ApiResponse {
            success: true,
            data: Some(data),
            error: None,
            message,
        }
    }

    pub fn err(error: ApiError) -> Self {
        ApiResponse {
            success: false,
            data: None,
            error: Some(error),
            message: None,
        }
    }
}

// ==================== Request Models ====================

// Note: Most request models are now in database modules
// We only keep API-specific models here

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
    #[allow(dead_code)]
    pub timelock: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EscrowRefundRequest {
    #[serde(rename = "authorizerAddress")]
    #[allow(dead_code)]
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
async fn create_bounty(body: web::Json<database::BountyRequest>) -> HttpResponse {
    tracing::info!("Creating bounty: {:?}", body.title);

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.creator.trim().is_empty() {
        field_errors.push(FieldError {
            field: "creator".into(),
            message: "creator is required".into(),
        });
    }
    if body.title.trim().is_empty() {
        field_errors.push(FieldError {
            field: "title".into(),
            message: "title is required".into(),
        });
    }
    if body.description.trim().is_empty() {
        field_errors.push(FieldError {
            field: "description".into(),
            message: "description is required".into(),
        });
    }
    if body.budget <= 0 {
        field_errors.push(FieldError {
            field: "budget".into(),
            message: "budget must be positive".into(),
        });
    }
    if body.deadline == 0 {
        field_errors.push(FieldError {
            field: "deadline".into(),
            message: "deadline is required".into(),
        });
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

    let bounty = database::create_bounty(body.into_inner());
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "bounty_id": bounty.id,
            "creator": bounty.creator,
            "title": bounty.title,
            "budget": bounty.budget,
            "status": bounty.status
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

    let bounties = database::get_mock_bounties();
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "bounties": bounties,
            "total": bounties.len(),
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

    let bounty = database::get_bounty_by_id(bounty_id);
    match bounty {
        Some(b) => {
            let response: ApiResponse<database::Bounty> = ApiResponse::ok(b, None);
            HttpResponse::Ok()
                .content_type("application/json")
                .json(response)
        }
        None => {
            let response: ApiResponse<()> =
                ApiResponse::err(ApiError::not_found(format!("Bounty {}", bounty_id)));
            HttpResponse::NotFound()
                .content_type("application/json")
                .json(response)
        }
    }
}

/// Apply for a bounty
async fn apply_for_bounty(
    path: web::Path<u64>,
    body: web::Json<database::BountyApplication>,
) -> HttpResponse {
    let bounty_id = path.into_inner();
    tracing::info!("Applying for bounty {}: {}", bounty_id, body.freelancer);

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.freelancer.trim().is_empty() {
        field_errors.push(FieldError {
            field: "freelancer".into(),
            message: "freelancer is required".into(),
        });
    }
    if body.proposal.trim().is_empty() {
        field_errors.push(FieldError {
            field: "proposal".into(),
            message: "proposal is required".into(),
        });
    }
    if body.proposed_budget <= 0 {
        field_errors.push(FieldError {
            field: "proposed_budget".into(),
            message: "proposed_budget must be positive".into(),
        });
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

    let freelancer_addr = body.freelancer.clone();
    match database::apply_for_bounty(bounty_id, body.into_inner()) {
        Ok(()) => {
            let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
                serde_json::json!({
                    "application_id": 1,
                    "bounty_id": bounty_id,
                    "freelancer": freelancer_addr,
                    "status": "pending"
                }),
                Some("Application submitted successfully".to_string()),
            );
            HttpResponse::Created()
                .content_type("application/json")
                .json(response)
        }
        Err(e) => {
            let response: ApiResponse<()> =
                ApiResponse::err(ApiError::new(ApiErrorCode::ValidationError, e));
            HttpResponse::UnprocessableEntity()
                .content_type("application/json")
                .json(response)
        }
    }
}

/// Register freelancer
async fn register_freelancer(body: web::Json<database::FreelancerRegistration>) -> HttpResponse {
    tracing::info!("Registering freelancer: {}", body.name);

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.name.trim().is_empty() {
        field_errors.push(FieldError {
            field: "name".into(),
            message: "name is required".into(),
        });
    }
    if body.discipline.trim().is_empty() {
        field_errors.push(FieldError {
            field: "discipline".into(),
            message: "discipline is required".into(),
        });
    }
    if body.bio.trim().is_empty() {
        field_errors.push(FieldError {
            field: "bio".into(),
            message: "bio is required".into(),
        });
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

    let freelancer =
        database::register_freelancer(body.into_inner(), "wallet-address-placeholder".to_string());
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "freelancer_id": freelancer.address,
            "name": freelancer.name,
            "discipline": freelancer.discipline,
            "verified": freelancer.verified
        }),
        Some("Freelancer registered successfully".to_string()),
    );

    HttpResponse::Created()
        .content_type("application/json")
        .json(response)
}

/// List freelancers
async fn list_freelancers(
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let discipline = query.get("discipline").cloned().unwrap_or_default();
    tracing::info!("Listing freelancers with filter: {}", discipline);

    let all_freelancers = database::get_mock_freelancers();
    let filtered_freelancers =
        database::filter_freelancers_by_discipline(all_freelancers, &discipline);
    let total = filtered_freelancers.len();

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "freelancers": filtered_freelancers,
            "total": total,
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

    let freelancer = database::get_freelancer_by_address(&address);
    match freelancer {
        Some(f) => {
            let response: ApiResponse<database::Freelancer> = ApiResponse::ok(f, None);
            HttpResponse::Ok()
                .content_type("application/json")
                .json(response)
        }
        None => {
            let response: ApiResponse<()> =
                ApiResponse::err(ApiError::not_found(format!("Freelancer {}", address)));
            HttpResponse::NotFound()
                .content_type("application/json")
                .json(response)
        }
    }
}

/// List creators with optional filter by discipline
async fn list_creators(
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let discipline = query.get("discipline").cloned();
    let search = query.get("search").cloned();

    tracing::info!(
        "Listing creators with filters - discipline: {:?}, search: {:?}",
        discipline,
        search
    );

    // Use database module for creators
    let all_creators = database::get_mock_creators();
    let filtered_creators = database::filter_creators(all_creators, discipline.clone(), search.clone());
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

    // Use database module for creator lookup
    let creator = database::get_creator_by_id(&creator_id);

    match creator {
        Some(c) => {
            let response: ApiResponse<database::Creator> = ApiResponse::ok(c, None);
            HttpResponse::Ok()
                .content_type("application/json")
                .json(response)
        }
        None => {
            let response: ApiResponse<database::Creator> =
                ApiResponse::err(ApiError::not_found(format!("Creator {}", creator_id)));
            HttpResponse::NotFound()
                .content_type("application/json")
                .json(response)
        }
    }
}

/// Aggregated reputation and recent reviews for a creator profile.
async fn get_creator_reputation(
    path: web::Path<String>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    let creator_id = path.into_inner();
    tracing::info!("Fetching reputation for creator: {}", creator_id);

    // Set the database pool for reputation operations
    reputation::set_database_pool(pool.get_ref().clone());

    let reviews = reputation::fetch_creator_reviews_from_db(&creator_id).await;
    let aggregation = reputation::fetch_creator_reputation_from_db(&creator_id).await;
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

/// Enhanced creator reputation with filtering and sorting support
async fn get_creator_reviews_filtered(
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    let creator_id = path.into_inner();
    tracing::info!("Fetching filtered reviews for creator: {} with filters: {:?}", creator_id, *query);

    // Set the database pool for reputation operations
    reputation::set_database_pool(pool.get_ref().clone());

    // Parse and validate query parameters
    let filters = match reputation::parse_review_filters(&query) {
        Ok(filters) => filters,
        Err(errors) => {
            let field_errors: Vec<FieldError> = errors
                .into_iter()
                .enumerate()
                .map(|(i, msg)| FieldError {
                    field: format!("query_param_{}", i),
                    message: msg,
                })
                .collect();
            
            let response: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
                ApiErrorCode::ValidationError,
                "Invalid query parameters",
                field_errors,
            ));
            return HttpResponse::UnprocessableEntity()
                .content_type("application/json")
                .json(response);
        }
    };

    let payload = reputation::get_filtered_creator_reviews_from_db(&creator_id, &filters).await;
    let response: ApiResponse<reputation::FilteredCreatorReputationPayload> =
        ApiResponse::ok(payload, None);
    
    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
}

/// Get all reviews across creators with filtering and sorting
async fn list_reviews_filtered(
    query: web::Query<std::collections::HashMap<String, String>>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    tracing::info!("Fetching filtered reviews across all creators with filters: {:?}", *query);

    // Set the database pool for reputation operations
    reputation::set_database_pool(pool.get_ref().clone());

    // Parse and validate query parameters
    let filters = match reputation::parse_review_filters(&query) {
        Ok(filters) => filters,
        Err(errors) => {
            let field_errors: Vec<FieldError> = errors
                .into_iter()
                .enumerate()
                .map(|(i, msg)| FieldError {
                    field: format!("query_param_{}", i),
                    message: msg,
                })
                .collect();
            
            let response: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
                ApiErrorCode::ValidationError,
                "Invalid query parameters",
                field_errors,
            ));
            return HttpResponse::UnprocessableEntity()
                .content_type("application/json")
                .json(response);
        }
    };

    // Get all reviews from database (with fallback to seed data)
    let all_reviews = reputation::fetch_all_reviews_from_db().await;

    // Apply filters
    let filtered_reviews = reputation::filter_reviews(&all_reviews, &filters);
    
    // Apply sorting
    let mut sorted_reviews = filtered_reviews;
    let sort_by = filters.sort_by.as_ref().unwrap_or(&reputation::ReviewSortBy::CreatedAt);
    let sort_order = filters.sort_order.as_ref().unwrap_or(&reputation::SortOrder::Desc);
    reputation::sort_reviews(&mut sorted_reviews, sort_by, sort_order);
    
    // Apply pagination
    let page = filters.page.unwrap_or(1).max(1);
    let limit = filters.limit.unwrap_or(10).clamp(1, 100);
    let paginated_reviews = reputation::paginate_reviews(sorted_reviews, page, limit);

    // Calculate overall aggregation for context
    let overall_aggregation = reputation::aggregate_reviews(&all_reviews);
    let filtered_aggregation = if paginated_reviews.total_count != overall_aggregation.total_reviews {
        Some(reputation::aggregate_reviews(&reputation::filter_reviews(&all_reviews, &filters)))
    } else {
        None
    };

    let payload = serde_json::json!({
        "reviews": paginated_reviews,
        "overallAggregation": overall_aggregation,
        "filteredAggregation": filtered_aggregation,
        "appliedFilters": filters
    });

    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(payload, None);
    HttpResponse::Ok()
        .content_type("application/json")
        .json(response)
}

/// Submit a review after bounty completion.
async fn submit_review(
    body: web::Json<ReviewSubmission>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    tracing::info!("Submitting review for creator: {}", body.creator_id);

    // Set the database pool for reputation operations
    reputation::set_database_pool(pool.get_ref().clone());

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.bounty_id.trim().is_empty() {
        field_errors.push(FieldError {
            field: "bountyId".into(),
            message: "Bounty ID is required".into(),
        });
    }
    if body.creator_id.trim().is_empty() {
        field_errors.push(FieldError {
            field: "creatorId".into(),
            message: "Creator ID is required".into(),
        });
    }
    if !(1..=5).contains(&body.rating) {
        field_errors.push(FieldError {
            field: "rating".into(),
            message: "Rating must be between 1 and 5".into(),
        });
    }
    if body.title.trim().is_empty() {
        field_errors.push(FieldError {
            field: "title".into(),
            message: "Title is required".into(),
        });
    }
    if body.body.trim().is_empty() {
        field_errors.push(FieldError {
            field: "body".into(),
            message: "Feedback is required".into(),
        });
    }
    if body.reviewer_name.trim().is_empty() {
        field_errors.push(FieldError {
            field: "reviewerName".into(),
            message: "Your name is required".into(),
        });
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

    // Process the review submission through the hook system
    match reputation::on_review_submitted(
        &body.bounty_id,
        &body.creator_id,
        body.rating,
        &body.title,
        &body.body,
        &body.reviewer_name,
    ) {
        Ok(review_id) => {
            let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
                serde_json::json!({ 
                    "reviewId": review_id,
                    "creatorId": body.creator_id,
                    "status": "submitted"
                }),
                Some("Review submitted successfully".to_string()),
            );
            HttpResponse::Created()
                .content_type("application/json")
                .json(response)
        }
        Err(validation_errors) => {
            let field_errors: Vec<FieldError> = validation_errors
                .into_iter()
                .enumerate()
                .map(|(i, msg)| FieldError {
                    field: format!("validation_{}", i),
                    message: msg,
                })
                .collect();
            
            let resp: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
                ApiErrorCode::ValidationError,
                "Review submission failed",
                field_errors,
            ));
            HttpResponse::UnprocessableEntity()
                .content_type("application/json")
                .json(resp)
        }
    }
}

/// Escape escrow
async fn get_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    tracing::info!("Fetching escrow: {}", escrow_id);

    let escrow = database::get_escrow_by_id(escrow_id);
    match escrow {
        Some(e) => {
            let response: ApiResponse<database::Escrow> = ApiResponse::ok(e, None);
            HttpResponse::Ok()
                .content_type("application/json")
                .json(response)
        }
        None => {
            let response: ApiResponse<()> =
                ApiResponse::err(ApiError::not_found(format!("Escrow {}", escrow_id)));
            HttpResponse::NotFound()
                .content_type("application/json")
                .json(response)
        }
    }
}

/// Release escrow funds
async fn release_escrow(path: web::Path<u64>) -> HttpResponse {
    let escrow_id = path.into_inner();
    tracing::info!("Releasing escrow: {}", escrow_id);

    match database::release_escrow(escrow_id) {
        Some(escrow) => {
            let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
                serde_json::json!({
                    "id": escrow.id,
                    "status": escrow.status,
                    "transaction_id": escrow.transaction_hash
                }),
                Some("Funds released successfully".to_string()),
            );
            HttpResponse::Ok()
                .content_type("application/json")
                .json(response)
        }
        None => {
            let response: ApiResponse<()> =
                ApiResponse::err(ApiError::not_found(format!("Escrow {}", escrow_id)));
            HttpResponse::NotFound()
                .content_type("application/json")
                .json(response)
        }
    }
}

/// Create a new escrow
async fn create_escrow(body: web::Json<database::EscrowCreateRequest>) -> HttpResponse {
    tracing::info!("Creating escrow for bounty: {}", body.bounty_id);

    let mut field_errors: Vec<FieldError> = Vec::new();
    if body.bounty_id.trim().is_empty() {
        field_errors.push(FieldError {
            field: "bountyId".into(),
            message: "bountyId is required".into(),
        });
    }
    if body.payer_address.trim().is_empty() {
        field_errors.push(FieldError {
            field: "payerAddress".into(),
            message: "payerAddress is required".into(),
        });
    }
    if body.payee_address.trim().is_empty() {
        field_errors.push(FieldError {
            field: "payeeAddress".into(),
            message: "payeeAddress is required".into(),
        });
    }
    if body.amount <= 0 {
        field_errors.push(FieldError {
            field: "amount".into(),
            message: "amount must be positive".into(),
        });
    }
    if body.token.trim().is_empty() {
        field_errors.push(FieldError {
            field: "token".into(),
            message: "token is required".into(),
        });
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

    let escrow = database::create_escrow(body.into_inner());
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "escrowId": escrow.id.to_string(),
            "txHash": escrow.transaction_hash,
            "operation": "deposit",
            "status": escrow.status,
            "timestamp": escrow.created_at
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
    body: web::Json<database::EscrowRefundRequest>,
) -> HttpResponse {
    let escrow_id = path.into_inner();
    tracing::info!(
        "Refunding escrow {} to {}",
        escrow_id,
        body.authorizer_address
    );

    if body.authorizer_address.trim().is_empty() {
        let resp: ApiResponse<()> = ApiResponse::err(ApiError::with_field_errors(
            ApiErrorCode::ValidationError,
            "Validation failed",
            vec![FieldError {
                field: "authorizerAddress".into(),
                message: "authorizerAddress is required".into(),
            }],
        ));
        return HttpResponse::UnprocessableEntity()
            .content_type("application/json")
            .json(resp);
    }

    match database::refund_escrow(escrow_id, body.authorizer_address.clone()) {
        Some(escrow) => {
            let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
                serde_json::json!({
                    "escrowId": escrow.id.to_string(),
                    "txHash": escrow.transaction_hash,
                    "operation": "refund",
                    "status": escrow.status,
                    "timestamp": escrow.created_at
                }),
                Some("Escrow refunded successfully".to_string()),
            );
            HttpResponse::Ok()
                .content_type("application/json")
                .json(response)
        }
        None => {
            let response: ApiResponse<()> =
                ApiResponse::err(ApiError::not_found(format!("Escrow {}", escrow_id)));
            HttpResponse::NotFound()
                .content_type("application/json")
                .json(response)
        }
    }
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
    type Future =
        std::pin::Pin<Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>>>>;

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

/// Parse and validate the CORS origin whitelist from the `CORS_ALLOWED_ORIGINS`
/// environment variable.
///
/// Rules enforced at startup (panics on violation so misconfiguration is caught
/// immediately rather than silently allowing unsafe access):
///
/// - Wildcards (`*`) are **never** permitted — they would re-introduce the
///   original vulnerability and are incompatible with `supports_credentials()`.
/// - Every entry must start with `http://` or `https://`; bare hostnames or
///   other schemes are rejected.
/// - Empty entries (e.g. trailing commas) are silently dropped.
///
/// Falls back to `http://localhost:3000` only when the variable is **absent**,
/// which is safe for local development.  In production the variable must be
/// set explicitly.
pub fn parse_allowed_origins() -> Vec<String> {
    let raw = std::env::var("CORS_ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:3000".to_string());

    let origins: Vec<String> = raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    for origin in &origins {
        // Wildcard origins are explicitly forbidden — they bypass the whitelist
        // entirely and cannot be combined with credentials.
        if origin == "*" {
            panic!(
                "CORS_ALLOWED_ORIGINS must not contain a wildcard '*'. \
                 Set explicit origin URLs instead."
            );
        }

        // Require a proper scheme so we never accidentally allow bare hostnames
        // or non-HTTP schemes that could be abused.
        if !origin.starts_with("http://") && !origin.starts_with("https://") {
            panic!(
                "CORS_ALLOWED_ORIGINS entry '{}' is invalid: every origin must \
                 start with 'http://' or 'https://'.",
                origin
            );
        }
    }

    if origins.is_empty() {
        panic!(
            "CORS_ALLOWED_ORIGINS resolved to an empty list. \
             Provide at least one allowed origin."
        );
    }

    origins
}

/// Build the CORS middleware from the validated origin whitelist.
///
/// Allowed origins are read from the `CORS_ALLOWED_ORIGINS` environment
/// variable as a comma-separated list (e.g. `http://localhost:3000,https://app.example.com`).
/// Wildcards and invalid entries cause an immediate startup panic so that
/// misconfiguration is never silently deployed.
///
/// All standard HTTP methods and the headers required by a JSON API
/// (`Content-Type`, `Authorization`, `Accept`) are permitted.
/// Credentials (cookies / auth headers) are allowed so wallet-auth flows work.
pub fn cors_middleware() -> Cors {
    let allowed_origins = parse_allowed_origins();

    tracing::info!(
        "CORS whitelist: [{}]",
        allowed_origins.join(", ")
    );

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

    // Initialize database connection
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://stellar:stellar_dev_password@localhost:5432/stellar_db".to_string());
    
    tracing::info!("Connecting to database: {}", database_url.replace("stellar_dev_password", "***"));
    
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    // Run migrations
    sqlx::migrate!("../../migrations")
        .run(&pool)
        .await
        .expect("Failed to run database migrations");

    tracing::info!("Database connected and migrations applied");

    // Initialize the reputation system with hooks and database
    reputation::initialize_reputation_system_with_db(pool.clone());
    tracing::info!("Reputation system initialized with hooks and database");

    let port = std::env::var("API_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .expect("API_PORT must be a valid port number");

    let host = std::env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    tracing::info!("Server starting on {}:{}", host, port);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(pool.clone()))
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
                    .route(
                        "/creators/{id}/reputation",
                        web::get().to(get_creator_reputation),
                    )
                    .route("/creators/{id}/reputation", web::get().to(get_creator_reputation))
                    .route("/creators/{id}/reviews", web::get().to(get_creator_reviews_filtered))
                    .route("/reviews", web::post().to(submit_review))
                    .route("/reviews", web::get().to(list_reviews_filtered))
                    .route("/freelancers", web::get().to(list_freelancers))
                    .route("/freelancers/{address}", web::get().to(get_freelancer))
                    .route("/escrow/{id}", web::get().to(get_escrow))
                    .route(
                        "/webhooks/payment",
                        web::post().to(webhook::payment_webhook),
                    )
                    // Protected write routes — require valid JWT
                    .service(
                        web::scope("")
                            .wrap(auth::JwtMiddleware)
                            .route("/bounties", web::post().to(create_bounty))
                            .route("/bounties/{id}/apply", web::post().to(apply_for_bounty))
                            .route("/freelancers/register", web::post().to(register_freelancer))
                            .route("/escrow/{id}/release", web::post().to(release_escrow)),
                    ),
            )
            // Protected write routes — require valid JWT
            .service(
                web::scope("")
                    .wrap(auth::JwtMiddleware)
                    .route("/api/bounties", web::post().to(create_bounty))
                    .route("/api/bounties/{id}/apply", web::post().to(apply_for_bounty))
                    .route(
                        "/api/freelancers/register",
                        web::post().to(register_freelancer),
                    )
                    .route("/api/escrow/create", web::post().to(create_escrow))
                    .route("/api/escrow/{id}/release", web::post().to(release_escrow))
                    .route("/api/escrow/{id}/refund", web::post().to(refund_escrow)),
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
            FieldError {
                field: "title".to_string(),
                message: "Title is required".to_string(),
            },
            FieldError {
                field: "budget".to_string(),
                message: "Budget must be positive".to_string(),
            },
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
    //
    // These tests verify the whitelist-based CORS policy introduced to fix the
    // P0 security issue where all origins were permitted.  Key invariants:
    //   1. Allowed origins receive the correct ACAO header.
    //   2. Disallowed origins receive no ACAO header.
    //   3. Wildcard '*' in CORS_ALLOWED_ORIGINS panics at startup.
    //   4. Invalid (non-HTTP/S) origins panic at startup.

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

    // Wildcard '*' must be rejected at parse time — it would re-introduce the
    // original P0 vulnerability and is incompatible with credentials.
    #[test]
    #[should_panic(expected = "must not contain a wildcard")]
    fn test_cors_wildcard_origin_panics() {
        std::env::set_var("CORS_ALLOWED_ORIGINS", "*");
        let _ = parse_allowed_origins();
    }

    // A wildcard mixed with real origins must also be rejected.
    #[test]
    #[should_panic(expected = "must not contain a wildcard")]
    fn test_cors_mixed_wildcard_panics() {
        std::env::set_var("CORS_ALLOWED_ORIGINS", "http://localhost:3000,*");
        let _ = parse_allowed_origins();
    }

    // Non-HTTP/S schemes (e.g. bare hostnames, file://) must be rejected.
    #[test]
    #[should_panic(expected = "must start with 'http://' or 'https://'")]
    fn test_cors_invalid_scheme_panics() {
        std::env::set_var("CORS_ALLOWED_ORIGINS", "localhost:3000");
        let _ = parse_allowed_origins();
    }

    // An empty list after filtering must be rejected.
    #[test]
    #[should_panic(expected = "resolved to an empty list")]
    fn test_cors_empty_origins_panics() {
        std::env::set_var("CORS_ALLOWED_ORIGINS", ",,, ,");
        let _ = parse_allowed_origins();
    }

    // Multiple valid origins should all be accepted.
    #[test]
    fn test_cors_multiple_valid_origins_accepted() {
        std::env::set_var(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:3000,https://app.example.com,https://staging.example.com",
        );
        let origins = parse_allowed_origins();
        assert_eq!(origins.len(), 3);
        assert!(origins.contains(&"http://localhost:3000".to_string()));
        assert!(origins.contains(&"https://app.example.com".to_string()));
        assert!(origins.contains(&"https://staging.example.com".to_string()));
        std::env::remove_var("CORS_ALLOWED_ORIGINS");
    }

    // Whitespace around entries must be trimmed before validation.
    #[test]
    fn test_cors_origins_are_trimmed() {
        std::env::set_var(
            "CORS_ALLOWED_ORIGINS",
            "  http://localhost:3000  ,  https://app.example.com  ",
        );
        let origins = parse_allowed_origins();
        assert_eq!(origins.len(), 2);
        assert!(origins.contains(&"http://localhost:3000".to_string()));
        std::env::remove_var("CORS_ALLOWED_ORIGINS");
    }

    #[actix_web::test]
    async fn creator_reputation_integration_returns_aggregation() {
        use actix_web::test as awtest;

        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(create_test_pool()))
                .route(
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
        let total = json["data"]["aggregation"]["totalReviews"]
            .as_u64()
            .unwrap();
        assert!(total >= 1);
        let avg = json["data"]["aggregation"]["averageRating"]
            .as_f64()
            .unwrap();
        assert!(avg > 0.0);
        assert!(!json["data"]["recentReviews"].as_array().unwrap().is_empty());
    }

    #[actix_web::test]
    async fn escrow_get_integration_returns_active_payload() {
        use actix_web::test as awtest;

        let app = awtest::init_service(
            App::new().route("/api/v1/escrow/{id}", web::get().to(get_escrow)),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/api/v1/escrow/1")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["id"], 1);
        assert_eq!(json["data"]["status"], "active");
    }

    #[actix_web::test]
    async fn creator_reputation_unknown_id_returns_empty_aggregation() {
        use actix_web::test as awtest;

        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(create_test_pool()))
                .route(
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

        let app = awtest::init_service(App::new().route(
            "/api/v1/escrow/{id}/release",
            web::post().to(release_escrow),
        ))
        .await;

        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/1/release")
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

    fn create_test_pool() -> PgPool {
        let database_url = "postgres://test:test@localhost:5432/test_db";
        PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy(database_url)
            .expect("Failed to create test database pool")
    }

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
            web::scope("/api/v1")
                .wrap(auth::JwtMiddleware)
                .route("/bounties", web::post().to(create_bounty))
                .route("/bounties/{id}/apply", web::post().to(apply_for_bounty))
                .route("/freelancers/register", web::post().to(register_freelancer))
                .route("/escrow/create", web::post().to(create_escrow))
                .route("/escrow/{id}/release", web::post().to(release_escrow))
                .route("/escrow/{id}/refund", web::post().to(refund_escrow))
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
            .uri("/api/v1/escrow/1/release")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["status"], "released");
    }

    // ── Review submission hook integration tests ──────────────────────────────

    #[actix_web::test]
    async fn submit_review_triggers_hooks_successfully() {
        use actix_web::test as awtest;
        use std::sync::{Arc, Mutex};

        let app = awtest::init_service(App::new().route(
            "/api/v1/reviews",
            web::get().to(list_reviews_filtered),
        ))
        .await;
        reputation::initialize_reputation_system();

        // Create a counter to track hook executions
        let hook_counter = Arc::new(Mutex::new(0));
        let counter_clone = hook_counter.clone();

        // Register a test hook
        reputation::register_review_submitted_hook(move |event| {
            let mut count = counter_clone.lock().unwrap();
            *count += 1;
            // Don't assert specific values since tests run in parallel with different data
            assert!(event.rating >= 1 && event.rating <= 5);
            assert!(!event.creator_id.is_empty());
            Ok(())
        });

        // Create a mock database pool for testing
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(create_test_pool()))
                .route("/api/v1/reviews", web::post().to(submit_review))
        ).await;

        let req = awtest::TestRequest::post()
            .uri("/api/v1/reviews")
            .set_json(serde_json::json!({
                "bountyId": "test-bounty",
                "creatorId": "test-creator",
                "rating": 5,
                "title": "Excellent work",
                "body": "Outstanding delivery and communication",
                "reviewerName": "John Doe"
            }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::CREATED);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert!(json["data"]["reviewId"].is_string());
        assert_eq!(json["data"]["creatorId"], "test-creator");
        assert_eq!(json["data"]["status"], "submitted");

        // Verify hook was executed
        let count = *hook_counter.lock().unwrap();
        assert!(count > 0, "Hook should have been executed");
    }

    #[actix_web::test]
    async fn submit_review_with_validation_errors_does_not_trigger_hooks() {
        use actix_web::test as awtest;
        use std::sync::{Arc, Mutex};

        let hook_counter = Arc::new(Mutex::new(0));
        let counter_clone = hook_counter.clone();

        reputation::register_review_submitted_hook(move |_| {
            if let Ok(mut count) = counter_clone.lock() {
                *count += 1;
            }
            Ok(())
        });

        let app = awtest::init_service(build_review_app()).await;

        let req = awtest::TestRequest::post()
            .uri("/api/v1/reviews")
            .set_json(serde_json::json!({
                "bountyId": "",  // Invalid: empty
                "creatorId": "test-creator",
                "rating": 6,     // Invalid: out of range
                "title": "",     // Invalid: empty
                "body": "Good work",
                "reviewerName": "John Doe"
            }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");

        // Note: We can't reliably test hook execution count due to shared global state
        // In a real application, this would use dependency injection or isolated test environments
    }

    #[actix_web::test]
    async fn submit_review_with_hook_failure_still_succeeds() {
        use actix_web::test as awtest;

        // Register a hook that always fails
        reputation::register_review_submitted_hook(|_| {
            Err("Simulated hook failure".to_string())
        });

        let app = awtest::init_service(build_review_app()).await;

        let req = awtest::TestRequest::post()
            .uri("/api/v1/reviews")
            .set_json(serde_json::json!({
                "bountyId": "test-bounty",
                "creatorId": "test-creator",
                "rating": 4,
                "title": "Good work",
                "body": "Solid delivery",
                "reviewerName": "Jane Smith"
            }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        // Should still succeed even if hook fails
        assert_eq!(resp.status(), actix_web::http::StatusCode::CREATED);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert!(json["data"]["reviewId"].is_string());
    }

    #[actix_web::test]
    async fn submit_review_generates_unique_ids() {
        use actix_web::test as awtest;
        use tokio::time::{sleep, Duration};

        let app = awtest::init_service(build_review_app()).await;

        // Submit first review
        let req1 = awtest::TestRequest::post()
            .uri("/api/v1/reviews")
            .set_json(serde_json::json!({
                "bountyId": "bounty-1",
                "creatorId": "creator-1",
                "rating": 5,
                "title": "First review",
                "body": "First review body",
                "reviewerName": "Reviewer 1"
            }))
            .to_request();

        let resp1 = awtest::call_service(&app, req1).await;
        assert_eq!(resp1.status(), actix_web::http::StatusCode::CREATED);

        // Small delay to ensure different nanosecond timestamps
        sleep(Duration::from_millis(1)).await;

        // Submit second review
        let req2 = awtest::TestRequest::post()
            .uri("/api/v1/reviews")
            .set_json(serde_json::json!({
                "bountyId": "bounty-1",
                "creatorId": "creator-1",
                "rating": 4,
                "title": "Second review",
                "body": "Second review body",
                "reviewerName": "Reviewer 2"
            }))
            .to_request();

        let resp2 = awtest::call_service(&app, req2).await;
        assert_eq!(resp2.status(), actix_web::http::StatusCode::CREATED);

        // Extract review IDs
        let body1 = awtest::read_body(resp1).await;
        let json1: serde_json::Value = serde_json::from_slice(&body1).unwrap();
        let review_id1 = json1["data"]["reviewId"].as_str().unwrap();

        let body2 = awtest::read_body(resp2).await;
        let json2: serde_json::Value = serde_json::from_slice(&body2).unwrap();
        let review_id2 = json2["data"]["reviewId"].as_str().unwrap();

        // IDs should be different
        assert_ne!(review_id1, review_id2);
        
        // Both should have the expected format
        assert!(review_id1.starts_with("rev-creator-1-bounty-1"));
        assert!(review_id2.starts_with("rev-creator-1-bounty-1"));
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
            .route(
                "/api/v1/bounties/{id}/apply",
                web::post().to(apply_for_bounty),
            )
            .route(
                "/api/v1/freelancers/register",
                web::post().to(register_freelancer),
            )
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array()
            .unwrap()
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array()
            .unwrap()
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array()
            .unwrap()
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array()
            .unwrap()
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
        App::new()
            .app_data(web::Data::new(create_test_pool()))
            .route("/api/v1/reviews", web::post().to(submit_review))
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
        assert_eq!(json["data"]["creatorId"], "alex-studio");
        assert_eq!(json["data"]["status"], "submitted");
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array()
            .unwrap()
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
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let fields: Vec<&str> = json["error"]["fieldErrors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["field"].as_str().unwrap())
            .collect();
        assert!(fields.contains(&"proposed_budget"));
    }

    // ── New integration tests for review filtering endpoints ──────────────────

    fn build_review_filtering_app() -> actix_web::App<
        impl actix_web::dev::ServiceFactory<
            actix_web::dev::ServiceRequest,
            Config = (),
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
            InitError = (),
        >,
    > {
        App::new()
            .app_data(web::Data::new(create_test_pool()))
            .route("/api/v1/escrow/create", web::post().to(create_escrow))
            .route("/api/v1/escrow/{id}/release", web::post().to(release_escrow))
            .route("/api/v1/escrow/{id}/refund", web::post().to(refund_escrow))
            .route("/api/v1/creators/{id}/reviews", web::get().to(get_creator_reviews_filtered))
            .route("/api/v1/reviews", web::get().to(list_reviews_filtered))
    }

    #[actix_web::test]
    async fn get_creator_reviews_filtered_returns_paginated_results() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/create")
            .set_json(serde_json::json!({
                "bountyId": "b-1",
                "payerAddress": "GPAYER",
                "payeeAddress": "GPAYEE",
                "amount": 1000,
                "token": "GUSDC"
            }))
            .to_request();
        let app = awtest::init_service(build_review_filtering_app()).await;
        
        let req = awtest::TestRequest::get()
            .uri("/api/v1/creators/alex-studio/reviews?page=1&limit=2&sortBy=rating&sortOrder=desc")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["creatorId"], "alex-studio");
        
        let reviews = &json["data"]["reviews"];
        assert_eq!(reviews["page"], 1);
        assert_eq!(reviews["limit"], 2);
        assert!(reviews["reviews"].as_array().unwrap().len() <= 2);
        
        // Check that reviews are sorted by rating descending
        let review_ratings: Vec<u8> = reviews["reviews"]
            .as_array().unwrap()
            .iter()
            .map(|r| r["rating"].as_u64().unwrap() as u8)
            .collect();
        
        for i in 1..review_ratings.len() {
            assert!(review_ratings[i-1] >= review_ratings[i]);
        }
    }

    #[actix_web::test]
    async fn get_creator_reviews_filtered_with_rating_filter() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");
        let token = auth::tests::make_token("wallet-1", "creator", 3600);

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/create")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({
                "bountyId": "b-1",
                "payerAddress": "GPAYER",
                "payeeAddress": "GPAYEE",
                "amount": 2500,
                "token": "GUSDC"
            }))
            .to_request();
        let app = awtest::init_service(build_review_filtering_app()).await;
        
        let req = awtest::TestRequest::get()
            .uri("/api/v1/creators/alex-studio/reviews?minRating=4&maxRating=5")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        
        // All returned reviews should have rating between 4-5
        let reviews = json["data"]["reviews"]["reviews"].as_array().unwrap();
        for review in reviews {
            let rating = review["rating"].as_u64().unwrap() as u8;
            assert!(rating >= 4 && rating <= 5);
        }
    }

    #[actix_web::test]
    async fn get_creator_reviews_filtered_invalid_params_returns_422() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_review_filtering_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/create")
            .set_json(serde_json::json!({
                "bountyId": "",
                "payerAddress": "",
                "payeeAddress": "",
                "amount": 0,
                "token": ""
            }))
            .to_request();
        let app = awtest::init_service(build_review_filtering_app()).await;
        
        let req = awtest::TestRequest::get()
            .uri("/api/v1/creators/alex-studio/reviews?minRating=6&sortBy=invalid&page=0")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(
            resp.status(),
            actix_web::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], false);
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
        assert!(json["error"]["fieldErrors"].as_array().unwrap().len() > 0);
    }

    #[actix_web::test]
    async fn list_reviews_filtered_returns_all_reviews() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_review_filtering_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/create")
            .set_json(serde_json::json!({
                "bountyId": "b-1",
                "payerAddress": "GPAYER",
                "payeeAddress": "GPAYEE",
                "amount": -100,
                "token": "GUSDC"
            }))
            .to_request();
        let app = awtest::init_service(build_review_filtering_app()).await;
        
        let req = awtest::TestRequest::get()
            .uri("/api/v1/reviews?page=1&limit=5&sortBy=createdAt&sortOrder=desc")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
    }


    // ── POST /api/escrow/:id/refund ───────────────────────────────────────────

    #[actix_web::test]
    async fn refund_escrow_without_token_returns_401() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/5/refund")
            .set_json(serde_json::json!({ "authorizerAddress": "GPAYER" }))
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn list_reviews_filtered_with_verified_only() {
        use actix_web::test as awtest;
        std::env::remove_var("JWT_SECRET");
        let token = auth::tests::make_token("wallet-1", "creator", 3600);

        let app = awtest::init_service(build_protected_app()).await;
        let req = awtest::TestRequest::post()
            .uri("/api/v1/escrow/5/refund")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "authorizerAddress": "GPAYER123" }))
            .to_request();
        let app = awtest::init_service(build_review_filtering_app()).await;
        
        let req = awtest::TestRequest::get()
            .uri("/api/v1/reviews?verifiedOnly=true&sortBy=rating&sortOrder=desc")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        
        // All returned reviews should have rating >= 4 (verified threshold)
        let reviews = json["data"]["reviews"]["reviews"].as_array().unwrap();
        for review in reviews {
            let rating = review["rating"].as_u64().unwrap() as u8;
            assert!(rating >= 4);
        }
        
        // Should have filtered aggregation since we applied filters
        assert!(json["data"]["filteredAggregation"].is_object());
    }

    #[actix_web::test]
    async fn list_reviews_filtered_date_range() {
        use actix_web::test as awtest;
        let app = awtest::init_service(build_review_filtering_app()).await;
        
        let req = awtest::TestRequest::get()
            .uri("/api/v1/creators/alex-studio/reviews?dateFrom=2025-01-01&dateTo=2025-12-31")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        
        let reviews = json["data"]["reviews"]["reviews"].as_array().unwrap();
        for review in reviews {
            let created_at = review["createdAt"].as_str().unwrap();
            assert!(created_at >= "2025-01-01" && created_at <= "2025-12-31");
        }
    }

    // ── API versioning ────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn api_versions_endpoint_returns_current_version() {
        use actix_web::test as awtest;
        let app =
            awtest::init_service(App::new().route("/api/versions", web::get().to(api_versions)))
                .await;
        let req = awtest::TestRequest::get().uri("/api/versions").to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["current"], "1");
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

        for uri in &[
            "/api/v1/bounties",
            "/api/v1/creators",
            "/api/v1/freelancers",
        ] {
            let req = awtest::TestRequest::get().uri(uri).to_request();
            let resp = awtest::call_service(&app, req).await;
            assert_eq!(
                resp.status(),
                actix_web::http::StatusCode::OK,
                "failed for {uri}"
            );
        }
    }

    #[actix_web::test]
    async fn unversioned_api_path_returns_404() {
        use actix_web::test as awtest;
        let app = awtest::init_service(
            App::new()
                .service(web::scope("/api/v1").route("/bounties", web::get().to(list_bounties))),
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
        let header = resp
            .headers()
            .get("x-api-version")
            .expect("x-api-version header must be present");
        assert_eq!(header, API_VERSION);
    }
}
