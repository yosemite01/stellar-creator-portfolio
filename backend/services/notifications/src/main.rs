use actix_web::{web, App, HttpServer};
use deadpool_redis::{Config, Pool, Runtime};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, error};

mod config;
mod error;
mod handlers;
mod models;
mod queue;
mod worker;

use crate::config::AppConfig;
use crate::handlers::{health_check, send_notification, get_notification_status, retry_notification};
use crate::queue::NotificationQueue;
use crate::worker::NotificationWorker;

/// Application state shared across handlers
pub struct AppState {
    pub queue: Arc<NotificationQueue>,
    pub worker: Arc<Mutex<NotificationWorker>>,
    pub config: AppConfig,
}

#[actix_web::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    info!("Starting Stellar Notifications Service...");

    // Load configuration
    let config = AppConfig::from_env()?;
    info!("Configuration loaded successfully");

    // Create Redis connection pool
    let redis_config = Config::from_url(&config.redis_url);
    let redis_pool: Pool = redis_config
        .create_pool(Some(Runtime::Tokio1))
        .map_err(|e| anyhow::anyhow!("Failed to create Redis pool: {}", e))?;
    
    info!("Redis connection pool created");

    // Test Redis connection
    let mut conn = redis_pool.get().await?;
    let _: String = redis::cmd("PING")
        .query_async(&mut conn)
        .await?;
    info!("Redis connection verified");

    // Create notification queue
    let queue = Arc::new(NotificationQueue::new(redis_pool.clone()));
    info!("Notification queue initialized");

    // Create and start background worker
    let worker = Arc::new(Mutex::new(
        NotificationWorker::new(
            redis_pool.clone(),
            config.smtp_config.clone(),
            config.webhook_base_url.clone(),
        )
    ));
    
    // Start worker in background task
    let worker_clone = Arc::clone(&worker);
    tokio::spawn(async move {
        info!("Starting notification worker...");
        if let Err(e) = worker_clone.lock().await.start().await {
            error!("Worker error: {}", e);
        }
    });

    // Create application state
    let app_state = web::Data::new(AppState {
        queue,
        worker,
        config: config.clone(),
    });

    // Start HTTP server
    let bind_address = format!("{}:{}", config.host, config.port);
    info!("Starting HTTP server on {}", bind_address);

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .route("/health", web::get().to(health_check))
            .route("/notifications", web::post().to(send_notification))
            .route("/notifications/{id}/status", web::get().to(get_notification_status))
            .route("/notifications/{id}/retry", web::post().to(retry_notification))
    })
    .bind(&bind_address)?
    .run()
    .await?;

    Ok(())
}
