use actix_cors::Cors;
use actix_web::{http::StatusCode, middleware, web, App, HttpResponse, HttpServer};
use deadpool_redis::{redis::AsyncCommands, Config, Pool, Runtime};
use reqwest::Client;
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

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub message: Option<String>,
}

impl<T> ApiResponse<T> {
    fn ok(data: T, message: Option<String>) -> Self {
        Self { success: true, data: Some(data), error: None, message }
    }

    #[allow(dead_code)]
    fn err(error: String) -> Self
    where
        T: Default,
    {
        Self { success: false, data: None, error: Some(error), message: None }
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

#[derive(Clone)]
struct ContractClient {
    rpc_url: String,
    bounty_contract_id: String,
    freelancer_contract_id: String,
    escrow_contract_id: String,
    http: Client,
}

impl ContractClient {
    fn from_env() -> Self {
        Self {
            rpc_url: std::env::var("STELLAR_RPC_URL")
                .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".to_string()),
            bounty_contract_id: std::env::var("BOUNTY_CONTRACT_ID").unwrap_or_default(),
            freelancer_contract_id: std::env::var("FREELANCER_CONTRACT_ID").unwrap_or_default(),
            escrow_contract_id: std::env::var("ESCROW_CONTRACT_ID").unwrap_or_default(),
            http: Client::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct GetEventsResult {
    #[serde(rename = "latestLedger")]
    latest_ledger: u32,
}

#[derive(Debug, Serialize)]
struct GetEventsRequest<'a> {
    jsonrpc: &'a str,
    id: u32,
    method: &'a str,
    params: GetEventsParams<'a>,
}

#[derive(Debug, Serialize)]
struct GetEventsParams<'a> {
    #[serde(rename = "startLedger")]
    start_ledger: u32,
    filters: Vec<EventFilter<'a>>,
    pagination: Pagination,
}

#[derive(Debug, Serialize)]
struct EventFilter<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(rename = "contractIds")]
    contract_ids: Vec<&'a str>,
}

#[derive(Debug, Serialize)]
struct Pagination {
    limit: u32,
}

async fn fetch_contract_latest_ledger(
    client: &ContractClient,
    contract_id: &str,
) -> Result<Option<u32>, HttpResponse> {
    if contract_id.is_empty() {
        return Ok(None);
    }

    let body = GetEventsRequest {
        jsonrpc: "2.0",
        id: 1,
        method: "getEvents",
        params: GetEventsParams {
            start_ledger: 0,
            filters: vec![EventFilter {
                kind: "contract",
                contract_ids: vec![contract_id],
            }],
            pagination: Pagination { limit: 1 },
        },
    };

    let response = client
        .http
        .post(&client.rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            tracing::error!("Contract RPC request failed: {error}");
            json_error(StatusCode::BAD_GATEWAY, format!("Contract RPC request failed: {error}"))
        })?;

    if !response.status().is_success() {
        return Err(json_error(
            StatusCode::BAD_GATEWAY,
            format!("Contract RPC returned status {}", response.status()),
        ));
    }

    let rpc_response = response
        .json::<RpcResponse<GetEventsResult>>()
        .await
        .map_err(|error| {
            tracing::error!("Failed to decode contract RPC response: {error}");
            json_error(
                StatusCode::BAD_GATEWAY,
                format!("Failed to decode contract RPC response: {error}"),
            )
        })?;

    if let Some(error) = rpc_response.error {
        return Err(json_error(
            StatusCode::BAD_GATEWAY,
            format!("Contract RPC error: {}", error.message),
        ));
    }

    Ok(rpc_response.result.map(|result| result.latest_ledger))
}

fn json_error(status: StatusCode, message: impl Into<String>) -> HttpResponse {
    let response: ApiResponse<serde_json::Value> = ApiResponse::err(message.into());
    HttpResponse::build(status).json(response)
}

fn value_response<T>(data: &T) -> Result<serde_json::Value, HttpResponse>
where
    T: Serialize,
{
    serde_json::to_value(data)
        .map_err(|error| json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to serialize response: {error}")))
}

fn parse_i64(value: i128, field: &str) -> Result<i64, HttpResponse> {
    i64::try_from(value)
        .map_err(|_| json_error(StatusCode::BAD_REQUEST, format!("{field} is outside the supported range")))
}

fn parse_u64_to_i64(value: u64, field: &str) -> Result<i64, HttpResponse> {
    i64::try_from(value)
        .map_err(|_| json_error(StatusCode::BAD_REQUEST, format!("{field} is outside the supported range")))
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
async fn create_bounty(
    pool: web::Data<PgPool>,
    contracts: web::Data<ContractClient>,
    body: web::Json<BountyRequest>,
) -> HttpResponse {
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
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let data = match value_response(&bounty) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.bounty_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    let mut response_data = data;
    if let Some(object) = response_data.as_object_mut() {
        object.insert("contractLedger".to_string(), serde_json::json!(contract_ledger));
    }

    HttpResponse::Created().json(ApiResponse::ok(response_data, Some("Bounty created successfully".to_string())))
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
    contracts: web::Data<ContractClient>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let page = query.get("page").and_then(|value| value.parse::<i64>().ok()).unwrap_or(1).max(1);
    let limit = query.get("limit").and_then(|value| value.parse::<i64>().ok()).unwrap_or(10).clamp(1, 100);
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
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
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
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.bounty_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({
            "bounties": bounties,
            "total": total,
            "page": page,
            "limit": limit,
            "contractLedger": contract_ledger
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
    contracts: web::Data<ContractClient>,
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
        Ok(None) => return json_error(StatusCode::NOT_FOUND, format!("Bounty {bounty_id} not found")),
        Err(error) => {
            tracing::error!("Failed to fetch bounty {bounty_id}: {error}");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let data = match value_response(&bounty) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.bounty_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    let mut response_data = data;
    if let Some(object) = response_data.as_object_mut() {
        object.insert("contractLedger".to_string(), serde_json::json!(contract_ledger));
    }

    if let Ok(mut conn) = redis.get().await {
        let _ = conn
            .set_ex::<_, _, ()>(&cache_key, response_data.to_string(), 60)
            .await;
    }

    HttpResponse::Ok().json(ApiResponse::ok(response_data, None))
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
    path: web::Path<u64>,
    body: web::Json<BountyApplication>,
    pool: web::Data<PgPool>,
    contracts: web::Data<ContractClient>,
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

    let exists = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)::BIGINT FROM bounties WHERE id = $1",
    )
    .bind(bounty_id)
    .fetch_one(pool.get_ref())
    .await
    {
        Ok(count) => count > 0,
        Err(error) => {
            tracing::error!("Failed to validate bounty {bounty_id}: {error}");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    if !exists {
        return json_error(StatusCode::NOT_FOUND, format!("Bounty {bounty_id} not found"));
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

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.bounty_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    let mut response_data = data;
    if let Some(object) = response_data.as_object_mut() {
        object.insert("contractLedger".to_string(), serde_json::json!(contract_ledger));
    }

    HttpResponse::Created().json(ApiResponse::ok(
        response_data,
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
    contracts: web::Data<ContractClient>,
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
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.freelancer_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    HttpResponse::Created().json(ApiResponse::ok(
        serde_json::json!({
            "name": freelancer.name,
            "discipline": freelancer.discipline,
            "verified": freelancer.verified,
            "contractLedger": contract_ledger
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
    contracts: web::Data<ContractClient>,
) -> HttpResponse {
    let discipline = query.get("discipline").cloned();
    let page = query.get("page").and_then(|value| value.parse::<i64>().ok()).unwrap_or(1).max(1);
    let limit = query.get("limit").and_then(|value| value.parse::<i64>().ok()).unwrap_or(10).clamp(1, 100);
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
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
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
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.freelancer_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({
            "freelancers": freelancers,
            "total": total,
            "filters": {
                "discipline": discipline.unwrap_or_default()
            },
            "contractLedger": contract_ledger
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
    contracts: web::Data<ContractClient>,
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
        Ok(None) => return json_error(StatusCode::NOT_FOUND, format!("Freelancer {address} not found")),
        Err(error) => {
            tracing::error!("Failed to fetch freelancer {address}: {error}");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let data = match value_response(&freelancer) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.freelancer_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    let mut response_data = data;
    if let Some(object) = response_data.as_object_mut() {
        object.insert("contractLedger".to_string(), serde_json::json!(contract_ledger));
    }

    if let Ok(mut conn) = redis.get().await {
        let _ = conn
            .set_ex::<_, _, ()>(&cache_key, response_data.to_string(), 60)
            .await;
    }

    HttpResponse::Ok().json(ApiResponse::ok(response_data, None))
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
async fn get_escrow(
    path: web::Path<u64>,
    pool: web::Data<PgPool>,
    contracts: web::Data<ContractClient>,
) -> HttpResponse {
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
        Ok(None) => return json_error(StatusCode::NOT_FOUND, format!("Escrow {escrow_id} not found")),
        Err(error) => {
            tracing::error!("Failed to fetch escrow {escrow_id}: {error}");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let data = match value_response(&escrow) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.escrow_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    let mut response_data = data;
    if let Some(object) = response_data.as_object_mut() {
        object.insert("contractLedger".to_string(), serde_json::json!(contract_ledger));
    }

    HttpResponse::Ok().json(ApiResponse::ok(response_data, None))
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
async fn release_escrow(
    path: web::Path<u64>,
    pool: web::Data<PgPool>,
    contracts: web::Data<ContractClient>,
) -> HttpResponse {
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
        Ok(None) => return json_error(StatusCode::NOT_FOUND, format!("Escrow {escrow_id} not found")),
        Err(error) => {
            tracing::error!("Failed to release escrow {escrow_id}: {error}");
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {error}"));
        }
    };

    let data = match value_response(&escrow) {
        Ok(value) => value,
        Err(response) => return response,
    };

    let contract_ledger = match fetch_contract_latest_ledger(&contracts, &contracts.escrow_contract_id).await {
        Ok(value) => value,
        Err(response) => return response,
    };

    let mut response_data = data;
    if let Some(object) = response_data.as_object_mut() {
        object.insert("contractLedger".to_string(), serde_json::json!(contract_ledger));
    }

    HttpResponse::Ok().json(ApiResponse::ok(
        response_data,
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
        EscrowRecord
    )),
    tags(
        (name = "bounties", description = "Bounty management"),
        (name = "freelancers", description = "Freelancer registry"),
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

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set before starting stellar-api");
    let db_pool = PgPool::connect(&database_url)
        .await
        .unwrap_or_else(|error| panic!("Failed to connect to PostgreSQL using DATABASE_URL: {error}"));

    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let cfg = Config::from_url(redis_url);
    let redis_pool = cfg.create_pool(Some(Runtime::Tokio1)).expect("Failed to create Redis pool");
    let openapi = ApiDoc::openapi();
    let contract_client = ContractClient::from_env();

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
            .app_data(web::Data::new(contract_client.clone()))
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
    use actix_web::http::StatusCode;

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
        assert!(paths.contains_key("/api/escrow/{id}"));
    }

    #[test]
    fn parse_bounds_validation_behaves_as_expected() {
        assert_eq!(parse_i64(42, "budget").unwrap_or_default(), 42);
        assert_eq!(parse_u64_to_i64(42, "deadline").unwrap_or_default(), 42);

        let too_large_budget = parse_i64(i128::from(i64::MAX) + 1, "budget");
        let too_large_deadline = parse_u64_to_i64((i64::MAX as u64) + 1, "deadline");

        assert!(too_large_budget.is_err());
        assert!(too_large_deadline.is_err());
    }

    #[test]
    fn json_error_uses_expected_status_code() {
        let response = json_error(StatusCode::BAD_REQUEST, "bad request");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
