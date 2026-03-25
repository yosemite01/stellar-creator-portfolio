use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing_subscriber;

// ============================================================
// Database Models
// ============================================================

#[derive(Clone, Serialize, Deserialize, sqlx::FromRow, Debug)]
pub struct User {
    pub id: uuid::Uuid,
    pub wallet_address: String,
    pub email: Option<String>,
    pub display_name: String,
    pub role: String,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub discipline: Option<String>,
    pub skills: Option<Vec<String>>,
    pub rating: Option<rust_decimal::Decimal>,
    pub completed_projects: Option<i32>,
    pub verified: Option<bool>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Serialize, Deserialize, sqlx::FromRow, Debug)]
pub struct Bounty {
    pub id: uuid::Uuid,
    pub creator_id: uuid::Uuid,
    pub title: String,
    pub description: String,
    pub budget: i64,
    pub deadline: chrono::DateTime<chrono::Utc>,
    pub status: String,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub applications_count: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Serialize, Deserialize, sqlx::FromRow, Debug)]
pub struct BountyApplication {
    pub id: uuid::Uuid,
    pub bounty_id: uuid::Uuid,
    pub applicant_id: uuid::Uuid,
    pub proposal: String,
    pub proposed_budget: i64,
    pub timeline_days: i32,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Serialize, Deserialize, sqlx::FromRow, Debug)]
pub struct EscrowAccount {
    pub id: uuid::Uuid,
    pub bounty_id: uuid::Uuid,
    pub application_id: Option<uuid::Uuid>,
    pub client_wallet: String,
    pub freelancer_wallet: Option<String>,
    pub total_amount: i64,
    pub released_amount: i64,
    pub status: String,
    pub stellar_escrow_account: Option<String>,
    pub milestones: Option<serde_json::Value>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

// ============================================================
// API Request/Response Types
// ============================================================

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BountyRequest {
    pub creator: String,
    pub title: String,
    pub description: String,
    pub budget: i64,
    pub deadline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BountyApplicationRequest {
    pub bounty_id: uuid::Uuid,
    pub freelancer: String,
    pub proposal: String,
    pub proposed_budget: i64,
    pub timeline_days: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FreelancerRegistration {
    pub wallet_address: String,
    pub display_name: String,
    pub email: Option<String>,
    pub discipline: String,
    pub bio: Option<String>,
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

    fn err(error: String) -> Self {
        ApiResponse {
            success: false,
            data: None,
            error: Some(error),
            message: None,
        }
    }
}

// ============================================================
// Application State
// ============================================================

pub struct AppState {
    pub db: PgPool,
}

// ============================================================
// Handlers
// ============================================================

async fn health(state: web::Data<AppState>) -> HttpResponse {
    // Verify DB connectivity
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "status": "healthy",
            "service": "stellar-api",
            "version": "0.1.0",
            "database": "connected"
        })),
        Err(e) => HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "status": "unhealthy",
            "service": "stellar-api",
            "database": "disconnected",
            "error": e.to_string()
        })),
    }
}

async fn create_bounty(
    state: web::Data<AppState>,
    body: web::Json<BountyRequest>,
) -> HttpResponse {
    tracing::info!("Creating bounty: {:?}", body.title);

    let deadline = chrono::DateTime::from_timestamp(body.deadline as i64, 0)
        .unwrap_or_else(|| chrono::Utc::now() + chrono::Duration::days(30));

    let result = sqlx::query_as::<_, Bounty>(
        r#"
        INSERT INTO bounties (creator_id, title, description, budget, deadline)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, creator_id, title, description, budget, deadline, status, 
                   category, tags, applications_count, created_at, updated_at
        "#,
    )
    .bind(uuid::Uuid::parse_str(&body.creator).unwrap_or_default())
    .bind(&body.title)
    .bind(&body.description)
    .bind(body.budget)
    .bind(deadline)
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(bounty) => {
            tracing::info!("Bounty created with ID: {}", bounty.id);
            HttpResponse::Created().json(ApiResponse::ok(
                serde_json::json!({
                    "bounty_id": bounty.id,
                    "title": bounty.title,
                    "budget": bounty.budget,
                    "status": bounty.status
                }),
                Some("Bounty created successfully".to_string()),
            ))
        }
        Err(e) => {
            tracing::error!("Failed to create bounty: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to create bounty: {}",
                e
            )))
        }
    }
}

async fn list_bounties(state: web::Data<AppState>) -> HttpResponse {
    let result = sqlx::query_as::<_, Bounty>(
        r#"
        SELECT id, creator_id, title, description, budget, deadline, status,
               category, tags, applications_count, created_at, updated_at
        FROM bounties
        WHERE status = 'OPEN'
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .fetch_all(&state.db)
    .await;

    match result {
        Ok(bounties) => {
            let total = bounties.len();
            HttpResponse::Ok().json(ApiResponse::ok(
                serde_json::json!({
                    "bounties": bounties,
                    "total": total,
                    "page": 1,
                    "limit": 50
                }),
                None,
            ))
        }
        Err(e) => {
            tracing::error!("Failed to list bounties: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to list bounties: {}",
                e
            )))
        }
    }
}

async fn get_bounty(state: web::Data<AppState>, path: web::Path<uuid::Uuid>) -> HttpResponse {
    let bounty_id = path.into_inner();

    let result = sqlx::query_as::<_, Bounty>(
        r#"
        SELECT id, creator_id, title, description, budget, deadline, status,
               category, tags, applications_count, created_at, updated_at
        FROM bounties WHERE id = $1
        "#,
    )
    .bind(bounty_id)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(bounty)) => HttpResponse::Ok().json(ApiResponse::ok(bounty, None)),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<()>::err(
            "Bounty not found".to_string(),
        )),
        Err(e) => {
            tracing::error!("Failed to get bounty: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to get bounty: {}",
                e
            )))
        }
    }
}

async fn apply_for_bounty(
    state: web::Data<AppState>,
    path: web::Path<uuid::Uuid>,
    body: web::Json<BountyApplicationRequest>,
) -> HttpResponse {
    let bounty_id = path.into_inner();
    tracing::info!("Application for bounty {} by {}", bounty_id, body.freelancer);

    let applicant_id = match uuid::Uuid::parse_str(&body.freelancer) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::BadRequest().json(ApiResponse::<()>::err(
                "Invalid freelancer wallet address".to_string(),
            ))
        }
    };

    let result = sqlx::query_as::<_, BountyApplication>(
        r#"
        INSERT INTO bounty_applications (bounty_id, applicant_id, proposal, proposed_budget, timeline_days)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, bounty_id, applicant_id, proposal, proposed_budget, timeline_days,
                   status, created_at, updated_at
        "#,
    )
    .bind(bounty_id)
    .bind(applicant_id)
    .bind(&body.proposal)
    .bind(body.proposed_budget)
    .bind(body.timeline_days)
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(application) => HttpResponse::Created().json(ApiResponse::ok(
            serde_json::json!({
                "application_id": application.id,
                "bounty_id": application.bounty_id,
                "status": application.status
            }),
            Some("Application submitted successfully".to_string()),
        )),
        Err(e) => {
            tracing::error!("Failed to submit application: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to submit application: {}",
                e
            )))
        }
    }
}

async fn register_freelancer(
    state: web::Data<AppState>,
    body: web::Json<FreelancerRegistration>,
) -> HttpResponse {
    tracing::info!("Registering freelancer: {}", body.wallet_address);

    let result = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (wallet_address, display_name, email, discipline, bio, role)
        VALUES ($1, $2, $3, $4, $5, 'CREATOR')
        ON CONFLICT (wallet_address) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            email = COALESCE(EXCLUDED.email, users.email),
            discipline = COALESCE(EXCLUDED.discipline, users.discipline)
        RETURNING id, wallet_address, email, display_name, role, avatar_url,
                   bio, discipline, skills, rating, completed_projects,
                   verified, created_at, updated_at
        "#,
    )
    .bind(&body.wallet_address)
    .bind(&body.display_name)
    .bind(&body.email)
    .bind(&body.discipline)
    .bind(&body.bio)
    .fetch_one(&state.db)
    .await;

    match result {
        Ok(user) => HttpResponse::Created().json(ApiResponse::ok(
            serde_json::json!({
                "id": user.id,
                "wallet_address": user.wallet_address,
                "display_name": user.display_name,
                "discipline": user.discipline,
                "role": user.role,
                "verified": user.verified
            }),
            Some("Freelancer registered successfully".to_string()),
        )),
        Err(e) => {
            tracing::error!("Failed to register freelancer: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to register freelancer: {}",
                e
            )))
        }
    }
}

async fn list_freelancers(
    state: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let discipline = query.get("discipline").cloned();

    let result = if let Some(ref disc) = discipline {
        sqlx::query_as::<_, User>(
            r#"
            SELECT id, wallet_address, email, display_name, role, avatar_url,
                   bio, discipline, skills, rating, completed_projects,
                   verified, created_at, updated_at
            FROM users
            WHERE role IN ('CREATOR', 'USER') AND discipline = $1
            ORDER BY rating DESC NULLS LAST, completed_projects DESC
            LIMIT 50
            "#,
        )
        .bind(disc)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as::<_, User>(
            r#"
            SELECT id, wallet_address, email, display_name, role, avatar_url,
                   bio, discipline, skills, rating, completed_projects,
                   verified, created_at, updated_at
            FROM users
            WHERE role IN ('CREATOR', 'USER')
            ORDER BY rating DESC NULLS LAST, completed_projects DESC
            LIMIT 50
            "#,
        )
        .fetch_all(&state.db)
        .await
    };

    match result {
        Ok(freelancers) => {
            let total = freelancers.len();
            HttpResponse::Ok().json(ApiResponse::ok(
                serde_json::json!({
                    "freelancers": freelancers,
                    "total": total,
                    "filters": { "discipline": discipline }
                }),
                None,
            ))
        }
        Err(e) => {
            tracing::error!("Failed to list freelancers: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to list freelancers: {}",
                e
            )))
        }
    }
}

async fn get_freelancer(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let wallet_address = path.into_inner();

    let result = sqlx::query_as::<_, User>(
        r#"
        SELECT id, wallet_address, email, display_name, role, avatar_url,
               bio, discipline, skills, rating, completed_projects,
               verified, created_at, updated_at
        FROM users WHERE wallet_address = $1
        "#,
    )
    .bind(&wallet_address)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(user)) => HttpResponse::Ok().json(ApiResponse::ok(
            serde_json::json!({
                "id": user.id,
                "wallet_address": user.wallet_address,
                "discipline": user.discipline,
                "rating": user.rating,
                "completed_projects": user.completed_projects,
                "verified": user.verified
            }),
            None,
        )),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<()>::err(
            "Freelancer not found".to_string(),
        )),
        Err(e) => {
            tracing::error!("Failed to get freelancer: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to get freelancer: {}",
                e
            )))
        }
    }
}

async fn get_escrow(state: web::Data<AppState>, path: web::Path<uuid::Uuid>) -> HttpResponse {
    let escrow_id = path.into_inner();

    let result = sqlx::query_as::<_, EscrowAccount>(
        r#"
        SELECT id, bounty_id, application_id, client_wallet, freelancer_wallet,
               total_amount, released_amount, status, stellar_escrow_account,
               milestones, created_at, updated_at
        FROM escrow_accounts WHERE id = $1
        "#,
    )
    .bind(escrow_id)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(escrow)) => HttpResponse::Ok().json(ApiResponse::ok(
            serde_json::json!({
                "id": escrow.id,
                "bounty_id": escrow.bounty_id,
                "total_amount": escrow.total_amount,
                "released_amount": escrow.released_amount,
                "status": escrow.status
            }),
            None,
        )),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<()>::err(
            "Escrow not found".to_string(),
        )),
        Err(e) => {
            tracing::error!("Failed to get escrow: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to get escrow: {}",
                e
            )))
        }
    }
}

async fn release_escrow(state: web::Data<AppState>, path: web::Path<uuid::Uuid>) -> HttpResponse {
    let escrow_id = path.into_inner();
    tracing::info!("Releasing escrow: {}", escrow_id);

    let result = sqlx::query_as::<_, EscrowAccount>(
        r#"
        UPDATE escrow_accounts
        SET status = 'RELEASED',
            released_amount = total_amount,
            updated_at = NOW()
        WHERE id = $1 AND status IN ('FUNDED', 'PARTIALLY_RELEASED')
        RETURNING id, bounty_id, application_id, client_wallet, freelancer_wallet,
                   total_amount, released_amount, status, stellar_escrow_account,
                   milestones, created_at, updated_at
        "#,
    )
    .bind(escrow_id)
    .fetch_optional(&state.db)
    .await;

    match result {
        Ok(Some(escrow)) => HttpResponse::Ok().json(ApiResponse::ok(
            serde_json::json!({
                "id": escrow.id,
                "status": escrow.status,
                "released_amount": escrow.total_amount
            }),
            Some("Funds released successfully".to_string()),
        )),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<()>::err(
            "Escrow not found or already released".to_string(),
        )),
        Err(e) => {
            tracing::error!("Failed to release escrow: {}", e);
            HttpResponse::InternalServerError().json(ApiResponse::<()>::err(format!(
                "Failed to release escrow: {}",
                e
            )))
        }
    }
}

// ============================================================
// Main Entry Point
// ============================================================

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_api=debug".to_string()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("Failed to create database pool");

    tracing::info!("Database connection established");

    let port = std::env::var("API_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .expect("API_PORT must be a valid port number");

    let host = std::env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    tracing::info!("Starting Stellar API on {}:{}", host, port);

    let app_state = web::Data::new(AppState { db: pool });

    tracing::info!("Starting Stellar API on {}:{} (press Ctrl+C to stop)", host, port);

    let app_state = web::Data::new(AppState { db: pool });

    let server = HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
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
    .workers(4)
    .keep_alive(std::time::Duration::from_secs(75))
    .graceful_shutdown(std::time::Duration::from_secs(30));

    // Get server handle for graceful shutdown
    server.await.expect("Server error");

    tracing::info!("API server shutdown complete");
    Ok(())
}
