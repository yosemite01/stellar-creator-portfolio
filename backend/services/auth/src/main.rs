use actix_web::{middleware, web, App, HttpRequest, HttpResponse, HttpServer};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, TokenData, Validation};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing_subscriber;
use uuid::Uuid;

// ============================================================
// Configuration
// ============================================================

#[derive(Clone)]
pub struct Config {
    pub jwt_secret: String,
    pub jwt_expiry_seconds: i64,
    pub refresh_token_expiry_days: i64,
    pub database_url: String,
}

impl Config {
    fn from_env() -> Self {
        let jwt_secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "change_me_in_production_min_32_chars_!!".to_string());
        let jwt_expiry_seconds: i64 = std::env::var("JWT_EXPIRY_SECONDS")
            .unwrap_or_else(|_| "3600".to_string())
            .parse()
            .unwrap_or(3600);
        let refresh_token_expiry_days: i64 = std::env::var("REFRESH_TOKEN_EXPIRY_DAYS")
            .unwrap_or_else(|_| "30".to_string())
            .parse()
            .unwrap_or(30);
        let database_url = std::env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set");

        Config {
            jwt_secret,
            jwt_expiry_seconds,
            refresh_token_expiry_days,
            database_url,
        }
    }
}

// ============================================================
// JWT Claims
// ============================================================

#[derive(Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,        // user_id (UUID)
    pub wallet: String,     // wallet address
    pub role: String,       // USER, CREATOR, CLIENT, ADMIN
    pub exp: i64,           // expiration timestamp
    pub iat: i64,           // issued at
    pub token_type: String, // "access" or "refresh"
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RefreshClaims {
    pub sub: String,        // user_id (UUID)
    pub jti: String,        // unique token id for revocation
    pub exp: i64,           // expiration timestamp
    pub iat: i64,           // issued at
    pub token_type: String, // "refresh"
}

// ============================================================
// Database Models
// ============================================================

#[derive(Clone, Serialize, Deserialize, sqlx::FromRow, Debug)]
pub struct User {
    pub id: Uuid,
    pub wallet_address: String,
    pub email: Option<String>,
    pub display_name: String,
    pub role: String,
    pub password_hash: Option<String>,
    pub verified: Option<bool>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Serialize, Deserialize, sqlx::FromRow, Debug)]
pub struct RefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub revoked: bool,
}

// ============================================================
// API Request/Response Types
// ============================================================

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub wallet_address: String,
    pub display_name: String,
    pub email: Option<String>,
    pub password: Option<String>, // Optional for wallet-only auth
    pub role: Option<String>,     // CREATOR or CLIENT, defaults to CREATOR
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub wallet_address: String,
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct LogoutRequest {
    pub refresh_token: Option<String>,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub user: UserInfo,
}

#[derive(Serialize)]
pub struct UserInfo {
    pub id: Uuid,
    pub wallet_address: String,
    pub display_name: String,
    pub email: Option<String>,
    pub role: String,
    pub verified: bool,
}

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    fn ok(data: T, message: Option<String>) -> Self {
        ApiResponse {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    fn err(error: String) -> Self {
        ApiResponse {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

// ============================================================
// Application State
// ============================================================

pub struct AppState {
    pub db: PgPool,
    pub config: Config,
}

// ============================================================
// Password Hashing
// ============================================================

fn hash_password(password: &str) -> Result<String, anyhow::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = argon2::Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)?
        .to_string();
    Ok(hash)
}

fn verify_password(password: &str, hash: &str) -> Result<bool, anyhow::Error> {
    let parsed_hash = PasswordHash::new(hash)?;
    Ok(argon2::Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

// ============================================================
// JWT Utilities
// ============================================================

fn create_access_token(
    user: &User,
    config: &Config,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now().timestamp();
    let claims = Claims {
        sub: user.id.to_string(),
        wallet: user.wallet_address.clone(),
        role: user.role.clone(),
        exp: now + config.jwt_expiry_seconds,
        iat: now,
        token_type: "access".to_string(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
}

fn create_refresh_token(
    user_id: Uuid,
    jti: Uuid,
    config: &Config,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now().timestamp();
    let claims = RefreshClaims {
        sub: user_id.to_string(),
        jti: jti.to_string(),
        exp: now + (config.refresh_token_expiry_days * 86400),
        iat: now,
        token_type: "refresh".to_string(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
}

fn validate_token<T: serde::de::DeserializeOwned>(
    token: &str,
    secret: &str,
) -> Result<TokenData<T>, jsonwebtoken::errors::Error> {
    decode::<T>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
}

fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ============================================================
// Middleware: Extract User from JWT
// ============================================================

async fn extract_user_from_request(
    req: &HttpRequest,
    config: &Config,
) -> Option<Claims> {
    let auth_header = req.headers().get("Authorization")?;
    let auth_str = auth_header.to_str().ok()?;
    if !auth_str.starts_with("Bearer ") {
        return None;
    }
    let token = &auth_str[7..];
    let token_data = validate_token::<Claims>(token, &config.jwt_secret).ok()?;
    if token_data.claims.token_type != "access" {
        return None;
    }
    Some(token_data.claims)
}

// ============================================================
// Handlers
// ============================================================

async fn health(state: web::Data<AppState>) -> HttpResponse {
    match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "status": "healthy",
            "service": "stellar-auth",
            "version": "0.1.0",
            "database": "connected"
        })),
        Err(_) => HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "status": "unhealthy",
            "database": "disconnected"
        })),
    }
}

async fn register(
    state: web::Data<AppState>,
    body: web::Json<RegisterRequest>,
) -> HttpResponse {
    tracing::info!("Register request for wallet: {}", body.wallet_address);

    // Check if user already exists
    let existing = sqlx::query_as::<_, User>(
        "SELECT id, wallet_address, email, display_name, role, password_hash, verified, created_at, updated_at 
         FROM users WHERE wallet_address = $1 OR email = $2",
    )
    .bind(&body.wallet_address)
    .bind(&body.email)
    .fetch_optional(&state.db)
    .await;

    match existing {
        Ok(Some(_)) => {
            return HttpResponse::Conflict().json(ApiResponse::<()>::err(
                "User with this wallet or email already exists".to_string(),
            ));
        }
        Err(e) => {
            tracing::error!("Database error: {}", e);
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::err("Database error".to_string()));
        }
        _ => {}
    }

    // Hash password if provided
    let password_hash = if let Some(ref pwd) = body.password {
        match hash_password(pwd) {
            Ok(h) => Some(h),
            Err(e) => {
                tracing::error!("Password hashing failed: {}", e);
                return HttpResponse::InternalServerError()
                    .json(ApiResponse::<()>::err("Failed to process password".to_string()));
            }
        }
    } else {
        None
    };

    let role = body.role.clone().unwrap_or_else(|| "CREATOR".to_string());
    let display_name = body.display_name.clone();
    let wallet_address = body.wallet_address.clone();

    // Create user
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (wallet_address, display_name, email, password_hash, role)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (wallet_address) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            email = COALESCE(EXCLUDED.email, users.email)
        RETURNING id, wallet_address, email, display_name, role, password_hash, verified, created_at, updated_at
        "#,
    )
    .bind(&wallet_address)
    .bind(&display_name)
    .bind(&body.email)
    .bind(&password_hash)
    .bind(&role)
    .fetch_one(&state.db)
    .await;

    match user {
        Ok(user) => {
            tracing::info!("User registered: {} ({})", user.id, user.wallet_address);
            
            // Generate tokens
            let access_token = match create_access_token(&user, &state.config) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("Failed to create access token: {}", e);
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::err("Failed to generate token".to_string()));
                }
            };

            let jti = Uuid::new_v4();
            let refresh_token = match create_refresh_token(user.id, jti, &state.config) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("Failed to create refresh token: {}", e);
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::err("Failed to generate refresh token".to_string()));
                }
            };

            // Store refresh token hash
            let token_hash = hash_token(&refresh_token);
            let expires_at = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
            let _ = sqlx::query(
                "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
            )
            .bind(user.id)
            .bind(&token_hash)
            .bind(expires_at)
            .execute(&state.db)
            .await;

            HttpResponse::Created().json(ApiResponse::ok(
                AuthResponse {
                    access_token,
                    refresh_token,
                    token_type: "Bearer".to_string(),
                    expires_in: state.config.jwt_expiry_seconds,
                    user: UserInfo {
                        id: user.id,
                        wallet_address: user.wallet_address,
                        display_name: user.display_name,
                        email: user.email,
                        role: user.role,
                        verified: user.verified.unwrap_or(false),
                    },
                },
                Some("Registration successful".to_string()),
            ))
        }
        Err(e) => {
            tracing::error!("Failed to create user: {}", e);
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::err(format!("Failed to create user: {}", e)))
        }
    }
}

async fn login(
    state: web::Data<AppState>,
    body: web::Json<LoginRequest>,
) -> HttpResponse {
    tracing::info!("Login request for wallet: {}", body.wallet_address);

    let user = sqlx::query_as::<_, User>(
        "SELECT id, wallet_address, email, display_name, role, password_hash, verified, created_at, updated_at 
         FROM users WHERE wallet_address = $1",
    )
    .bind(&body.wallet_address)
    .fetch_optional(&state.db)
    .await;

    match user {
        Ok(Some(user)) => {
            // Verify password if password auth is used
            if let Some(ref pwd) = body.password {
                if let Some(ref hash) = user.password_hash {
                    match verify_password(pwd, hash) {
                        Ok(false) => {
                            return HttpResponse::Unauthorized()
                                .json(ApiResponse::<()>::err("Invalid password".to_string()));
                        }
                        Err(e) => {
                            tracing::error!("Password verification failed: {}", e);
                            return HttpResponse::InternalServerError()
                                .json(ApiResponse::<()>::err("Authentication error".to_string()));
                        }
                        _ => {}
                    }
                }
            }

            // Generate tokens
            let access_token = match create_access_token(&user, &state.config) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("Failed to create access token: {}", e);
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::err("Failed to generate token".to_string()));
                }
            };

            let jti = Uuid::new_v4();
            let refresh_token = match create_refresh_token(user.id, jti, &state.config) {
                Ok(t) => t,
                Err(e) => {
                    tracing::error!("Failed to create refresh token: {}", e);
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::err("Failed to generate refresh token".to_string()));
                }
            };

            // Store refresh token hash
            let token_hash = hash_token(&refresh_token);
            let expires_at = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
            let _ = sqlx::query(
                "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
            )
            .bind(user.id)
            .bind(&token_hash)
            .bind(expires_at)
            .execute(&state.db)
            .await;

            tracing::info!("User logged in: {} ({})", user.id, user.wallet_address);

            HttpResponse::Ok().json(ApiResponse::ok(
                AuthResponse {
                    access_token,
                    refresh_token,
                    token_type: "Bearer".to_string(),
                    expires_in: state.config.jwt_expiry_seconds,
                    user: UserInfo {
                        id: user.id,
                        wallet_address: user.wallet_address,
                        display_name: user.display_name,
                        email: user.email,
                        role: user.role,
                        verified: user.verified.unwrap_or(false),
                    },
                },
                Some("Login successful".to_string()),
            ))
        }
        Ok(None) => {
            HttpResponse::NotFound().json(ApiResponse::<()>::err(
                "User not found. Please register first.".to_string(),
            ))
        }
        Err(e) => {
            tracing::error!("Database error: {}", e);
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::err("Database error".to_string()))
        }
    }
}

async fn refresh(
    state: web::Data<AppState>,
    body: web::Json<RefreshRequest>,
) -> HttpResponse {
    let token_data = match validate_token::<RefreshClaims>(&body.refresh_token, &state.config.jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("Invalid refresh token: {}", e);
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::err("Invalid refresh token".to_string()));
        }
    };

    if token_data.claims.token_type != "refresh" {
        return HttpResponse::Unauthorized()
            .json(ApiResponse::<()>::err("Invalid token type".to_string()));
    }

    let token_hash = hash_token(&body.refresh_token);
    
    // Check if token is valid and not revoked
    let stored_token = sqlx::query_as::<_, RefreshToken>(
        "SELECT id, user_id, token_hash, expires_at, created_at, revoked 
         FROM refresh_tokens WHERE token_hash = $1 AND revoked = false",
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await;

    let stored_token = match stored_token {
        Ok(Some(t)) => t,
        Ok(None) => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::err("Token revoked or not found".to_string()));
        }
        Err(e) => {
            tracing::error!("Database error: {}", e);
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::err("Database error".to_string()));
        }
    };

    // Check expiry
    if stored_token.expires_at < Utc::now() {
        return HttpResponse::Unauthorized()
            .json(ApiResponse::<()>::err("Refresh token expired".to_string()));
    }

    // Get user
    let user = sqlx::query_as::<_, User>(
        "SELECT id, wallet_address, email, display_name, role, password_hash, verified, created_at, updated_at 
         FROM users WHERE id = $1",
    )
    .bind(&stored_token.user_id)
    .fetch_optional(&state.db)
    .await;

    let user = match user {
        Ok(Some(u)) => u,
        Ok(None) => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::err("User not found".to_string()));
        }
        Err(e) => {
            tracing::error!("Database error: {}", e);
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::err("Database error".to_string()));
        }
    };

    // Revoke old refresh token
    let _ = sqlx::query("UPDATE refresh_tokens SET revoked = true WHERE id = $1")
        .bind(stored_token.id)
        .execute(&state.db)
        .await;

    // Generate new tokens
    let access_token = match create_access_token(&user, &state.config) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to create access token: {}", e);
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::err("Failed to generate token".to_string()));
        }
    };

    let jti = Uuid::new_v4();
    let new_refresh_token = match create_refresh_token(user.id, jti, &state.config) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Failed to create refresh token: {}", e);
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::err("Failed to generate refresh token".to_string()));
        }
    };

    // Store new refresh token hash
    let new_token_hash = hash_token(&new_refresh_token);
    let expires_at = Utc::now() + Duration::days(state.config.refresh_token_expiry_days);
    let _ = sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(user.id)
    .bind(&new_token_hash)
    .bind(expires_at)
    .execute(&state.db)
    .await;

    HttpResponse::Ok().json(ApiResponse::ok(
        AuthResponse {
            access_token,
            refresh_token: new_refresh_token,
            token_type: "Bearer".to_string(),
            expires_in: state.config.jwt_expiry_seconds,
            user: UserInfo {
                id: user.id,
                wallet_address: user.wallet_address,
                display_name: user.display_name,
                email: user.email,
                role: user.role,
                verified: user.verified.unwrap_or(false),
            },
        },
        Some("Token refreshed".to_string()),
    ))
}

async fn logout(
    state: web::Data<AppState>,
    body: web::Json<LogoutRequest>,
) -> HttpResponse {
    if let Some(ref token) = body.refresh_token {
        let token_hash = hash_token(token);
        let result = sqlx::query("UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1")
            .bind(&token_hash)
            .execute(&state.db)
            .await;

        match result {
            Ok(r) => {
                tracing::info!("Logged out, {} tokens revoked", r.rows_affected());
            }
            Err(e) => {
                tracing::error!("Failed to revoke token: {}", e);
            }
        }
    }

    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({ "message": "Logged out successfully" }),
        None,
    ))
}

async fn me(
    req: HttpRequest,
    state: web::Data<AppState>,
) -> HttpResponse {
    let claims = match extract_user_from_request(&req, &state.config).await {
        Some(c) => c,
        None => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::err("Invalid or missing token".to_string()));
        }
    };

    let user_id = match Uuid::parse_str(&claims.sub) {
        Ok(id) => id,
        Err(_) => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::err("Invalid user ID".to_string()));
        }
    };

    let user = sqlx::query_as::<_, User>(
        "SELECT id, wallet_address, email, display_name, role, password_hash, verified, created_at, updated_at 
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await;

    match user {
        Ok(Some(user)) => HttpResponse::Ok().json(ApiResponse::ok(
            UserInfo {
                id: user.id,
                wallet_address: user.wallet_address,
                display_name: user.display_name,
                email: user.email,
                role: user.role,
                verified: user.verified.unwrap_or(false),
            },
            None,
        )),
        Ok(None) => HttpResponse::NotFound().json(ApiResponse::<()>::err(
            "User not found".to_string(),
        )),
        Err(e) => {
            tracing::error!("Database error: {}", e);
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::err("Database error".to_string()))
        }
    }
}

async fn verify_token(
    req: HttpRequest,
    state: web::Data<AppState>,
) -> HttpResponse {
    let claims = match extract_user_from_request(&req, &state.config).await {
        Some(c) => c,
        None => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::err("Invalid or missing token".to_string()));
        }
    };

    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({
            "valid": true,
            "wallet": claims.wallet,
            "role": claims.role,
            "exp": claims.exp
        }),
        None,
    ))
}

// ============================================================
// Main Entry Point
// ============================================================

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_auth=debug".to_string()),
        )
        .init();

    let config = Config::from_env();

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .expect("Failed to create database pool");

    tracing::info!("Database connection established");
    tracing::info!("Auth service starting...");

    let port = std::env::var("AUTH_PORT")
        .unwrap_or_else(|_| "3002".to_string())
        .parse::<u16>()
        .expect("AUTH_PORT must be a valid port number");

    let host = std::env::var("AUTH_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    tracing::info!("Starting Stellar Auth on {}:{}", host, port);

    let app_state = web::Data::new(AppState {
        db: pool,
        config: config.clone(),
    });

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .wrap(middleware::Logger::default())
            .route("/health", web::get().to(health))
            .route("/auth/register", web::post().to(register))
            .route("/auth/login", web::post().to(login))
            .route("/auth/refresh", web::post().to(refresh))
            .route("/auth/logout", web::post().to(logout))
            .route("/auth/me", web::get().to(me))
            .route("/auth/verify", web::get().to(verify_token))
    })
    .bind((host.as_str(), port))?
    .run()
    .await
}
