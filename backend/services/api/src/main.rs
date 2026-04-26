use actix_cors::Cors;
use actix_web::{http::StatusCode, middleware, web, App, HttpResponse, HttpServer};
use deadpool_redis::{redis::AsyncCommands, Config, Pool, Runtime};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use utoipa::{OpenApi, ToSchema};
use utoipa_swagger_ui::SwaggerUi;
use uuid::Uuid;

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
        Self {
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
        Self {
            success: false,
            data: None,
            error: Some(error),
            message: None,
        }
    }
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct BountyRecord {
    id: i64,
    creator: String,
    title: String,
    description: Option<String>,
    budget: i64,
    deadline: Option<i64>,
    status: String,
    created_at: Option<i64>,
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct ApplicationRecord {
    application_id: i64,
    bounty_id: i64,
    freelancer: String,
    proposal: Option<String>,
    proposed_budget: Option<i64>,
    timeline: Option<i64>,
    status: String,
    created_at: Option<i64>,
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct FreelancerRecord {
    address: String,
    name: String,
    discipline: String,
    bio: Option<String>,
    verified: bool,
    rating: f64,
    completed_projects: i64,
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct EscrowRecord {
    id: i64,
    payer_address: String,
    payee_address: String,
    amount: i64,
    status: String,
    release_condition: Option<String>,
    created_at: Option<i64>,
    released_at: Option<i64>,
}

#[derive(Clone, Serialize, Debug, FromRow, ToSchema)]
struct ReviewRecord {
    id: String,
    creator_id: String,
    reviewer_id: String,
    reviewer_name: String,
    rating: i32,
    title: String,
    body: String,
    is_verified_purchase: bool,
    helpful_count: i64,
    not_helpful_count: i64,
    status: String,
    created_at: Option<i64>,
    updated_at: Option<i64>,
}

#[derive(Clone, Serialize, Debug, ToSchema)]
struct ReviewAggregate {
    average: f64,
    total: i64,
    breakdown: std::collections::BTreeMap<i32, i64>,
}

#[derive(Clone, Serialize, Debug, ToSchema)]
struct PaginationMeta {
    page: i64,
    limit: i64,
    total: i64,
    total_pages: i64,
}

#[derive(Clone, Serialize, Debug, ToSchema)]
struct ReviewsResponse {
    creator_id: String,
    reviews: Vec<ReviewRecord>,
    aggregate: ReviewAggregate,
    pagination: PaginationMeta,
}

fn json_error(status: StatusCode, message: impl Into<String>) -> HttpResponse {
    let response: ApiResponse<serde_json::Value> = ApiResponse::err(message.into());
    HttpResponse::build(status).json(response)
}

fn value_response<T>(data: &T) -> Result<serde_json::Value, HttpResponse>
where
    T: Serialize,
{
    serde_json::to_value(data).map_err(|error| {
        json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to serialize response: {error}"),
        )
    })
}

fn parse_i64(value: i128, field: &str) -> Result<i64, HttpResponse> {
    i64::try_from(value).map_err(|_| {
        json_error(
            StatusCode::BAD_REQUEST,
            format!("{field} is outside the supported range"),
        )
    })
}

fn parse_u64_to_i64(value: u64, field: &str) -> Result<i64, HttpResponse> {
    i64::try_from(value).map_err(|_| {
        json_error(
            StatusCode::BAD_REQUEST,
            format!("{field} is outside the supported range"),
        )
    })
}

fn build_review_aggregate(rating_counts: &[(i32, i64)]) -> ReviewAggregate {
    let mut breakdown = std::collections::BTreeMap::from([(1, 0), (2, 0), (3, 0), (4, 0), (5, 0)]);
    let mut weighted_sum = 0i64;
    let mut total = 0i64;

    for (rating, count) in rating_counts {
        if (1..=5).contains(rating) && *count > 0 {
            breakdown.insert(*rating, *count);
            weighted_sum += i64::from(*rating) * *count;
            total += *count;
        }
    }

    let average = if total == 0 {
        0.0
    } else {
        ((weighted_sum as f64 / total as f64) * 10.0).round() / 10.0
    };

    ReviewAggregate {
        average,
        total,
        breakdown,
    }
}

/// Health check
#[utoipa::path(
    get, path = "/health",
    responses((status = 200, description = "Service is healthy"))
)]
async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "stellar-api",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

/// Create a new bounty
#[utoipa::path(
    post, path = "/api/bounties",
    request_body = BountyRequest,
    responses(
        (status = 201, description = "Bounty created"),
        (status = 400, description = "Invalid request body"),
        (status = 500, description = "Database error"),
    )
)]
async fn create_bounty(pool: web::Data<PgPool>, body: web::Json<BountyRequest>) -> HttpResponse {
    tracing::info!("Creating bounty: {:?}", body.title);

    let budget = match parse_i64(body.budget, "budget") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let deadline = match parse_u64_to_i64(body.deadline, "deadline") {
        Ok(value) => value,
        Err(response) => return response,
    };

    let bounty = match sqlx::query_as::<_, BountyRecord>(
        r#"
        INSERT INTO bounties (creator_address, title, description, budget, deadline)
        VALUES ($1, $2, $3, $4, TO_TIMESTAMP($5::double precision))
        RETURNING
            id,
            creator_address AS creator,
            title,
            description,
            budget::BIGINT AS budget,
            EXTRACT(EPOCH FROM deadline)::BIGINT AS deadline,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        "#,
    )
    .bind(&body.creator)
    .bind(&body.title)
    .bind(&body.description)
    .bind(budget)
    .bind(deadline)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(record) => record,
        Err(error) => {
            tracing::error!("Failed to create bounty: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let data = match value_response(&bounty) {
        Ok(value) => value,
        Err(response) => return response,
    };

    HttpResponse::Created().json(ApiResponse::ok(
        data,
        Some("Bounty created successfully".to_string()),
    ))
}

/// List bounties (paginated)
#[utoipa::path(
    get, path = "/api/bounties",
    params(
        ("page" = Option<u32>, Query, description = "Page number (default 1)"),
        ("limit" = Option<u32>, Query, description = "Items per page (default 10)"),
        ("status" = Option<String>, Query, description = "Filter by status: open | in-progress | completed"),
    ),
    responses(
        (status = 200, description = "Paginated list of bounties"),
        (status = 500, description = "Database error"),
    )
)]
async fn list_bounties(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let page = query
        .get("page")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(1)
        .max(1);
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(10)
        .clamp(1, 100);
    let offset = (page - 1) * limit;
    let status = query.get("status").cloned();

    let total = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM bounties WHERE ($1::TEXT IS NULL OR status = $1)",
    )
    .bind(status.clone())
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(count) => count,
        Err(error) => {
            tracing::error!("Failed to count bounties: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let bounties = match sqlx::query_as::<_, BountyRecord>(
        r#"
        SELECT
            id,
            creator_address AS creator,
            title,
            description,
            budget::BIGINT AS budget,
            EXTRACT(EPOCH FROM deadline)::BIGINT AS deadline,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        FROM bounties
        WHERE ($1::TEXT IS NULL OR status = $1)
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(status)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!("Failed to list bounties: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({
            "bounties": bounties,
            "total": total,
            "page": page,
            "limit": limit
        }),
        None,
    ))
}

/// Get a single bounty by ID
#[utoipa::path(
    get, path = "/api/bounties/{id}",
    params(("id" = u64, Path, description = "Bounty ID")),
    responses(
        (status = 200, description = "Bounty details"),
        (status = 404, description = "Bounty not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn get_bounty(
    path: web::Path<u64>,
    pool: web::Data<PgPool>,
    redis: web::Data<Pool>,
) -> HttpResponse {
    let bounty_id = path.into_inner();
    let bounty_id_db = match parse_u64_to_i64(bounty_id, "id") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let cache_key = format!("api:bounty:{bounty_id}");

    if let Ok(mut conn) = redis.get().await {
        let cached_data: Result<String, _> = conn.get(&cache_key).await;
        if let Ok(payload) = cached_data {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&payload) {
                tracing::debug!("Cache hit for {cache_key}");
                return HttpResponse::Ok().json(ApiResponse::ok(parsed, None));
            }
        }
    }

    let bounty = match sqlx::query_as::<_, BountyRecord>(
        r#"
        SELECT
            id,
            creator_address AS creator,
            title,
            description,
            budget::BIGINT AS budget,
            EXTRACT(EPOCH FROM deadline)::BIGINT AS deadline,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        FROM bounties
        WHERE id = $1
        "#,
    )
    .bind(bounty_id_db)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return json_error(
                StatusCode::NOT_FOUND,
                format!("Bounty {bounty_id} not found"),
            )
        }
        Err(error) => {
            tracing::error!("Failed to fetch bounty {bounty_id}: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let data = match value_response(&bounty) {
        Ok(value) => value,
        Err(response) => return response,
    };

    if let Ok(mut conn) = redis.get().await {
        let _ = conn
            .set_ex::<_, _, ()>(&cache_key, data.to_string(), 60)
            .await;
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
        (status = 500, description = "Database error"),
    )
)]
async fn apply_for_bounty(
    state: web::Data<AppState>,
    path: web::Path<u64>,
    body: web::Json<BountyApplication>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    let bounty_id = match parse_u64_to_i64(path.into_inner(), "id") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let proposed_budget = match parse_i64(body.proposed_budget, "proposed_budget") {
        Ok(value) => value,
        Err(response) => return response,
    };
    let timeline = match parse_u64_to_i64(body.timeline, "timeline") {
        Ok(value) => value,
        Err(response) => return response,
    };

    let exists =
        match sqlx::query_scalar::<_, i64>("SELECT COUNT(*)::BIGINT FROM bounties WHERE id = $1")
            .bind(bounty_id)
            .fetch_one(pool.get_ref())
            .await
        {
            Ok(count) => count > 0,
            Err(error) => {
                tracing::error!("Failed to validate bounty {bounty_id}: {error}");
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Database error: {error}"),
                );
            }
        };

    if !exists {
        return json_error(
            StatusCode::NOT_FOUND,
            format!("Bounty {bounty_id} not found"),
        );
    }

    let application = match sqlx::query_as::<_, ApplicationRecord>(
        r#"
        INSERT INTO applications (bounty_id, freelancer_address, proposal, proposed_budget, timeline)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
            id AS application_id,
            bounty_id,
            freelancer_address AS freelancer,
            proposal,
            proposed_budget::BIGINT AS proposed_budget,
            timeline::BIGINT AS timeline,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at
        "#,
    )
    .bind(bounty_id)
    .bind(&body.freelancer)
    .bind(&body.proposal)
    .bind(proposed_budget)
    .bind(timeline)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(record) => record,
        Err(error) => {
            tracing::error!("Failed to create application for bounty {bounty_id}: {error}");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let data = match value_response(&application) {
        Ok(value) => value,
        Err(response) => return response,
    };

    HttpResponse::Created().json(ApiResponse::ok(
        data,
        Some("Application submitted successfully".to_string()),
    ))
}

/// Register a freelancer profile
#[utoipa::path(
    post, path = "/api/freelancers/register",
    request_body = FreelancerRegistration,
    responses(
        (status = 201, description = "Freelancer registered"),
        (status = 409, description = "Address already registered"),
        (status = 500, description = "Database error"),
    )
)]
async fn register_freelancer(
    body: web::Json<FreelancerRegistration>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    let generated_address = Uuid::new_v4().to_string();

    let freelancer = match sqlx::query_as::<_, FreelancerRecord>(
        r#"
        INSERT INTO freelancers (address, name, discipline, bio)
        VALUES ($1, $2, $3, $4)
        RETURNING
            address,
            name,
            discipline,
            bio,
            COALESCE(verified, false) AS verified,
            COALESCE(rating, 0)::DOUBLE PRECISION AS rating,
            COALESCE(completed_projects, 0)::BIGINT AS completed_projects
        "#,
    )
    .bind(&generated_address)
    .bind(&body.name)
    .bind(&body.discipline)
    .bind(&body.bio)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(record) => record,
        Err(error) => {
            tracing::error!("Failed to register freelancer {}: {error}", body.name);
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    HttpResponse::Created().json(ApiResponse::ok(
        serde_json::json!({
            "name": freelancer.name,
            "discipline": freelancer.discipline,
            "verified": freelancer.verified
        }),
        Some("Freelancer registered successfully".to_string()),
    ))
}

/// List freelancers
#[utoipa::path(
    get, path = "/api/freelancers",
    params(
        ("discipline" = Option<String>, Query, description = "Filter by discipline"),
        ("page" = Option<u32>, Query, description = "Page number"),
        ("limit" = Option<u32>, Query, description = "Items per page"),
    ),
    responses(
        (status = 200, description = "Paginated list of freelancers"),
        (status = 500, description = "Database error"),
    )
)]
async fn list_freelancers(
    query: web::Query<std::collections::HashMap<String, String>>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    let discipline = query.get("discipline").cloned();
    let page = query
        .get("page")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(1)
        .max(1);
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(10)
        .clamp(1, 100);
    let offset = (page - 1) * limit;

    let total = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM freelancers WHERE ($1::TEXT IS NULL OR discipline = $1)",
    )
    .bind(discipline.clone())
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(count) => count,
        Err(error) => {
            tracing::error!("Failed to count freelancers: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let freelancers = match sqlx::query_as::<_, FreelancerRecord>(
        r#"
        SELECT
            address,
            name,
            discipline,
            bio,
            COALESCE(verified, false) AS verified,
            COALESCE(rating, 0)::DOUBLE PRECISION AS rating,
            COALESCE(completed_projects, 0)::BIGINT AS completed_projects
        FROM freelancers
        WHERE ($1::TEXT IS NULL OR discipline = $1)
        ORDER BY name ASC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(discipline.clone())
    .bind(limit)
    .bind(offset)
    .fetch_all(pool.get_ref())
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!("Failed to list freelancers: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({
            "freelancers": freelancers,
            "total": total,
            "filters": {
                "discipline": discipline.unwrap_or_default()
            }
        }),
        None,
    ))
}

/// Get a freelancer by Stellar address
#[utoipa::path(
    get, path = "/api/freelancers/{address}",
    params(("address" = String, Path, description = "Stellar address")),
    responses(
        (status = 200, description = "Freelancer profile"),
        (status = 404, description = "Freelancer not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn get_freelancer(
    path: web::Path<String>,
    pool: web::Data<PgPool>,
    redis: web::Data<Pool>,
) -> HttpResponse {
    let address = path.into_inner();
    let cache_key = format!("api:freelancer:{address}");

    if let Ok(mut conn) = redis.get().await {
        let cached_data: Result<String, _> = conn.get(&cache_key).await;
        if let Ok(payload) = cached_data {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&payload) {
                tracing::debug!("Cache hit for {cache_key}");
                return HttpResponse::Ok().json(ApiResponse::ok(parsed, None));
            }
        }
    }

    let freelancer = match sqlx::query_as::<_, FreelancerRecord>(
        r#"
        SELECT
            address,
            name,
            discipline,
            bio,
            COALESCE(verified, false) AS verified,
            COALESCE(rating, 0)::DOUBLE PRECISION AS rating,
            COALESCE(completed_projects, 0)::BIGINT AS completed_projects
        FROM freelancers
        WHERE address = $1
        "#,
    )
    .bind(&address)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return json_error(
                StatusCode::NOT_FOUND,
                format!("Freelancer {address} not found"),
            )
        }
        Err(error) => {
            tracing::error!("Failed to fetch freelancer {address}: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let data = match value_response(&freelancer) {
        Ok(value) => value,
        Err(response) => return response,
    };

    if let Ok(mut conn) = redis.get().await {
        let _ = conn
            .set_ex::<_, _, ()>(&cache_key, data.to_string(), 60)
            .await;
    }

    HttpResponse::Ok().json(ApiResponse::ok(data, None))
}

/// List approved reviews for a creator with aggregate rating details
#[utoipa::path(
    get, path = "/api/reviews/{creator_id}",
    params(
        ("creator_id" = String, Path, description = "Creator ID"),
        ("page" = Option<u32>, Query, description = "Page number"),
        ("limit" = Option<u32>, Query, description = "Items per page"),
        ("sort" = Option<String>, Query, description = "recent | helpful | rating_high | rating_low"),
        ("filter_rating" = Option<i32>, Query, description = "Only return reviews with this rating"),
    ),
    responses(
        (status = 200, description = "Creator reviews and aggregate rating"),
        (status = 400, description = "Invalid query"),
        (status = 500, description = "Database error"),
    )
)]
async fn get_creator_reviews(
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    let creator_id = path.into_inner();
    let page = query
        .get("page")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(1)
        .max(1);
    let limit = query
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(10)
        .clamp(1, 50);
    let offset = (page - 1) * limit;
    let filter_rating = match query
        .get("filter_rating")
        .or_else(|| query.get("filterRating"))
    {
        Some(value) => match value.parse::<i32>() {
            Ok(rating) if (1..=5).contains(&rating) => Some(rating),
            _ => {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "filter_rating must be between 1 and 5",
                )
            }
        },
        None => None,
    };

    let order_by = match query.get("sort").map(String::as_str).unwrap_or("recent") {
        "recent" => "created_at DESC, id DESC",
        "helpful" => "helpful_count DESC, created_at DESC, id DESC",
        "rating_high" => "rating DESC, created_at DESC, id DESC",
        "rating_low" => "rating ASC, created_at DESC, id DESC",
        _ => {
            return json_error(
                StatusCode::BAD_REQUEST,
                "sort must be recent, helpful, rating_high, or rating_low",
            )
        }
    };

    let total = match sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)::BIGINT
        FROM reviews
        WHERE creator_id = $1
          AND status = 'approved'
          AND ($2::INTEGER IS NULL OR rating = $2)
        "#,
    )
    .bind(&creator_id)
    .bind(filter_rating)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(count) => count,
        Err(error) => {
            tracing::error!("Failed to count reviews for creator {creator_id}: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let reviews_sql = format!(
        r#"
        SELECT
            id,
            creator_id,
            reviewer_id,
            reviewer_name,
            rating,
            title,
            body,
            COALESCE(is_verified_purchase, false) AS is_verified_purchase,
            COALESCE(helpful_count, 0)::BIGINT AS helpful_count,
            COALESCE(not_helpful_count, 0)::BIGINT AS not_helpful_count,
            status,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at,
            EXTRACT(EPOCH FROM updated_at)::BIGINT AS updated_at
        FROM reviews
        WHERE creator_id = $1
          AND status = 'approved'
          AND ($2::INTEGER IS NULL OR rating = $2)
        ORDER BY {order_by}
        LIMIT $3 OFFSET $4
        "#
    );

    let reviews = match sqlx::query_as::<_, ReviewRecord>(&reviews_sql)
        .bind(&creator_id)
        .bind(filter_rating)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool.get_ref())
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!("Failed to list reviews for creator {creator_id}: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let rating_counts = match sqlx::query_as::<_, (i32, i64)>(
        r#"
        SELECT rating, COUNT(*)::BIGINT
        FROM reviews
        WHERE creator_id = $1 AND status = 'approved'
        GROUP BY rating
        "#,
    )
    .bind(&creator_id)
    .fetch_all(pool.get_ref())
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            tracing::error!("Failed to aggregate reviews for creator {creator_id}: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let response = ReviewsResponse {
        creator_id,
        reviews,
        aggregate: build_review_aggregate(&rating_counts),
        pagination: PaginationMeta {
            page,
            limit,
            total,
            total_pages: if total == 0 {
                0
            } else {
                (total + limit - 1) / limit
            },
        },
    };

    let data = match value_response(&response) {
        Ok(value) => value,
        Err(response) => return response,
    };

    HttpResponse::Ok().json(ApiResponse::ok(data, None))
}

/// Get escrow details
#[utoipa::path(
    get, path = "/api/escrow/{id}",
    params(("id" = u64, Path, description = "Escrow ID")),
    responses(
        (status = 200, description = "Escrow details"),
        (status = 404, description = "Escrow not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn get_escrow(path: web::Path<u64>, pool: web::Data<PgPool>) -> HttpResponse {
    let escrow_id = match parse_u64_to_i64(path.into_inner(), "id") {
        Ok(value) => value,
        Err(response) => return response,
    };

    let escrow = match sqlx::query_as::<_, EscrowRecord>(
        r#"
        SELECT
            id,
            payer_address,
            payee_address,
            amount::BIGINT AS amount,
            status,
            release_condition,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at,
            EXTRACT(EPOCH FROM released_at)::BIGINT AS released_at
        FROM escrow_accounts
        WHERE id = $1
        "#,
    )
    .bind(escrow_id)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return json_error(
                StatusCode::NOT_FOUND,
                format!("Escrow {escrow_id} not found"),
            )
        }
        Err(error) => {
            tracing::error!("Failed to fetch escrow {escrow_id}: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let data = match value_response(&escrow) {
        Ok(value) => value,
        Err(response) => return response,
    };

    HttpResponse::Ok().json(ApiResponse::ok(data, None))
}

/// Release escrowed funds
#[utoipa::path(
    post, path = "/api/escrow/{id}/release",
    params(("id" = u64, Path, description = "Escrow ID")),
    responses(
        (status = 200, description = "Funds released"),
        (status = 403, description = "Not authorised to release"),
        (status = 404, description = "Escrow not found"),
        (status = 500, description = "Database error"),
    )
)]
async fn release_escrow(path: web::Path<u64>, pool: web::Data<PgPool>) -> HttpResponse {
    let escrow_id = match parse_u64_to_i64(path.into_inner(), "id") {
        Ok(value) => value,
        Err(response) => return response,
    };

    let escrow = match sqlx::query_as::<_, EscrowRecord>(
        r#"
        UPDATE escrow_accounts
        SET status = 'released', released_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING
            id,
            payer_address,
            payee_address,
            amount::BIGINT AS amount,
            status,
            release_condition,
            EXTRACT(EPOCH FROM created_at)::BIGINT AS created_at,
            EXTRACT(EPOCH FROM released_at)::BIGINT AS released_at
        "#,
    )
    .bind(escrow_id)
    .fetch_optional(pool.get_ref())
    .await
    {
        Ok(Some(record)) => record,
        Ok(None) => {
            return json_error(
                StatusCode::NOT_FOUND,
                format!("Escrow {escrow_id} not found"),
            )
        }
        Err(error) => {
            tracing::error!("Failed to release escrow {escrow_id}: {error}");
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Database error: {error}"),
            );
        }
    };

    let data = match value_response(&escrow) {
        Ok(value) => value,
        Err(response) => return response,
    };

    HttpResponse::Ok().json(ApiResponse::ok(
        data,
        Some("Funds released successfully".to_string()),
    ))
}

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
        get_creator_reviews,
        get_escrow,
        release_escrow,
    ),
    components(schemas(
        BountyRequest,
        BountyApplication,
        FreelancerRegistration,
        BountyRecord,
        ApplicationRecord,
        FreelancerRecord,
        EscrowRecord,
        ReviewRecord,
        ReviewAggregate,
        PaginationMeta,
        ReviewsResponse
    )),
    tags(
        (name = "bounties", description = "Bounty management"),
        (name = "freelancers", description = "Freelancer registry"),
        (name = "reviews", description = "Creator reputation and reviews"),
        (name = "escrow", description = "Payment escrow"),
    )
)]
pub struct ApiDoc;

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

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set before starting stellar-api");
    let db_pool = PgPool::connect(&database_url)
        .await
        .unwrap_or_else(|error| {
            panic!("Failed to connect to PostgreSQL using DATABASE_URL: {error}")
        });

    let redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let cfg = Config::from_url(redis_url);
    let redis_pool = cfg
        .create_pool(Some(Runtime::Tokio1))
        .expect("Failed to create Redis pool");

    tracing::info!("Starting Stellar API on {}:{}", host, port);
    tracing::info!(
        "Swagger UI available at http://{}:{}/swagger-ui/",
        host,
        port
    );

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(db_pool.clone()))
            .app_data(web::Data::new(redis_pool.clone()))
            .wrap(Cors::permissive())
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            .service(
                SwaggerUi::new("/swagger-ui/{_:.*}").url("/api-docs/openapi.json", openapi.clone()),
            )
            .route("/health", web::get().to(health))
            .route("/api/bounties", web::post().to(create_bounty))
            .route("/api/bounties", web::get().to(list_bounties))
            .route("/api/bounties/{id}", web::get().to(get_bounty))
            .route("/api/bounties/{id}/apply", web::post().to(apply_for_bounty))
            .route(
                "/api/freelancers/register",
                web::post().to(register_freelancer),
            )
            .route("/api/freelancers", web::get().to(list_freelancers))
            .route("/api/freelancers/{address}", web::get().to(get_freelancer))
            .route(
                "/api/reviews/{creator_id}",
                web::get().to(get_creator_reviews),
            )
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
    use actix_web::{body::to_bytes, http::StatusCode, test};

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
        let paths = &spec.paths.paths;
        assert!(paths.contains_key("/health"));
        assert!(paths.contains_key("/api/bounties"));
        assert!(paths.contains_key("/api/freelancers"));
        assert!(paths.contains_key("/api/reviews/{creator_id}"));
        assert!(paths.contains_key("/api/escrow/{id}"));
    }

    #[test]
    fn review_aggregate_counts_average_and_breakdown() {
        let aggregate = build_review_aggregate(&[(5, 3), (4, 1), (2, 1)]);

        assert_eq!(aggregate.total, 5);
        assert_eq!(aggregate.average, 4.2);
        assert_eq!(aggregate.breakdown.get(&5), Some(&3));
        assert_eq!(aggregate.breakdown.get(&4), Some(&1));
        assert_eq!(aggregate.breakdown.get(&3), Some(&0));
    }

    #[test]
    fn review_aggregate_ignores_invalid_ratings() {
        let aggregate = build_review_aggregate(&[(5, 1), (6, 10), (0, 10)]);

        assert_eq!(aggregate.total, 1);
        assert_eq!(aggregate.average, 5.0);
        assert_eq!(aggregate.breakdown.get(&5), Some(&1));
        assert_eq!(aggregate.breakdown.get(&1), Some(&0));
    }

    #[test]
    fn create_bounty_commits_all_related_writes() {
        let store = Store::default();

        let created = store
            .create_bounty(BountyRequest {
                creator: "GCREATOR".to_string(),
                title: "Design a logo".to_string(),
                description: "Need a logo".to_string(),
                budget: 100,
                deadline: 12345,
            })
            .expect("bounty should be created");

        let db = store.db.lock().expect("db poisoned");
        assert_eq!(
            db.bounties.get(&created.id).map(|b| b.title.as_str()),
            Some("Design a logo")
        );
        assert!(db
            .creator_bounties
            .get("GCREATOR")
            .is_some_and(|bounties| bounties.contains(&created.id)));
    }

    #[test]
    fn create_bounty_rolls_back_when_transaction_fails_midway() {
        let store = Store::default();
        store.set_fail_after_write(Some(1));

        let result = store.create_bounty(BountyRequest {
            creator: "GCREATOR".to_string(),
            title: "Broken create".to_string(),
            description: "Should rollback".to_string(),
            budget: 100,
            deadline: 12345,
        });

        assert!(matches!(result, Err(ApiError::Internal(_))));
        let db = store.db.lock().expect("db poisoned");
        assert!(db.bounties.is_empty());
        assert!(db.creator_bounties.is_empty());
    }

    #[test]
    fn apply_for_bounty_rolls_back_all_writes_on_failure() {
        let store = Store::default();
        store.seed_bounty(BountyRecord {
            id: 1,
            creator: "GCREATOR".to_string(),
            title: "Design a logo".to_string(),
            description: "Need a logo".to_string(),
            budget: 100,
            deadline: 12345,
            status: "open".to_string(),
            application_count: 0,
        });
        store.set_fail_after_write(Some(2));

        let result = store.apply_for_bounty(BountyApplication {
            bounty_id: 1,
            freelancer: "GFREELANCER".to_string(),
            proposal: "I can do it".to_string(),
            proposed_budget: 90,
            timeline: 7,
        });

        assert!(matches!(result, Err(ApiError::Internal(_))));
        let db = store.db.lock().expect("db poisoned");
        assert!(db.applications.is_empty());
        assert!(db.bounty_applications.is_empty());
        assert_eq!(db.bounties.get(&1).map(|b| b.application_count), Some(0));
    }

    #[test]
    fn duplicate_freelancer_registration_does_not_partially_persist() {
        let store = Store::default();

        store
            .register_freelancer(FreelancerRegistration {
                name: "Alice Doe".to_string(),
                discipline: "Design".to_string(),
                bio: "Bio".to_string(),
            })
            .expect("initial registration should succeed");

        let duplicate = store.register_freelancer(FreelancerRegistration {
            name: "Alice Doe".to_string(),
            discipline: "Design".to_string(),
            bio: "Updated bio".to_string(),
        });

        assert!(matches!(duplicate, Err(ApiError::Conflict(_))));
        let db = store.db.lock().expect("db poisoned");
        assert_eq!(db.freelancers.len(), 1);
        assert_eq!(
            db.discipline_index.get("Design").map(BTreeSet::len),
            Some(1)
        );
    }

    #[actix_web::test]
    async fn apply_handler_rejects_path_body_mismatch_without_writes() {
        let state = AppState::default();
        state.store.seed_bounty(BountyRecord {
            id: 1,
            creator: "GCREATOR".to_string(),
            title: "Design a logo".to_string(),
            description: "Need a logo".to_string(),
            budget: 100,
            deadline: 12345,
            status: "open".to_string(),
            application_count: 0,
        });

        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state.clone()))
                .route("/api/bounties/{id}/apply", web::post().to(apply_for_bounty)),
        )
        .await;

        let request = test::TestRequest::post()
            .uri("/api/bounties/1/apply")
            .set_json(BountyApplication {
                bounty_id: 2,
                freelancer: "GFREELANCER".to_string(),
                proposal: "I can do it".to_string(),
                proposed_budget: 90,
                timeline: 7,
            })
            .to_request();

        let response = test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let body = to_bytes(response.into_body())
            .await
            .expect("body should be readable");
        let payload: ApiResponse<serde_json::Value> =
            serde_json::from_slice(&body).expect("response should deserialize");
        assert!(!payload.success);

        let db = state.store.db.lock().expect("db poisoned");
        assert!(db.applications.is_empty());
        assert!(db.bounty_applications.is_empty());
        assert_eq!(db.bounties.get(&1).map(|b| b.application_count), Some(0));
    }
}
