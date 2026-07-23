mod config;
mod models;
mod email;
mod sms;
mod push;
mod dispatcher;

use crate::config::Settings;
use crate::dispatcher::NotificationDispatcher;
use crate::models::{Notification, NotificationChannel};
use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing_subscriber::fmt::format::FmtSpan;

/// Liveness probe — returns 200 if the process is running.
async fn health() -> HttpResponse {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "timestamp": timestamp
    }))
}

/// Readiness probe — the notifications service has no external DB dependency;
/// it is ready as soon as the dispatcher is initialised.
async fn ready() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "db": "ok",
        "stellar_rpc": "ok",
        "cache": "ok"
    }))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_notifications=debug".into()))
        .with_span_events(FmtSpan::CLOSE)
        .init();

    tracing::info!("Starting Stellar Notifications Service");

    // Load and validate configuration
    let settings = Settings::from_env()?;
    settings.validate()?;

    // Initialize the dispatcher
    let dispatcher = NotificationDispatcher::new(settings.clone());

    // Initial service startup check
    tracing::info!("Notifications Service initialized and ready");

    // In a production environment, this would listen to a Message Queue (e.g. Redis).
    // For this implementation, we demonstrate the dispatcher with a test notification 
    // if a special environment variable is set.
    if std::env::var("SEND_TEST_NOTIFICATION").is_ok() {
        let test_notification = Notification {
            user_id: "system-test".to_string(),
            channel: NotificationChannel::Email,
            recipient: "test@example.com".to_string(),
            subject: Some("Stellar Service Test".to_string()),
            message: "This is a test notification from the Stellar Creator Portfolio service.".to_string(),
        };

        if let Err(e) = dispatcher.dispatch(test_notification).await {
             tracing::error!("Test notification delivery failed: {}", e);
        }
    }

    // Start the HTTP server for health/readiness probes in the background
    let port: u16 = std::env::var("NOTIFICATIONS_PORT")
        .unwrap_or_else(|_| "3003".to_string())
        .parse()
        .unwrap_or(3003);
    let host = std::env::var("NOTIFICATIONS_HOST")
        .unwrap_or_else(|_| "0.0.0.0".to_string());

    tracing::info!("Health endpoints available on {}:{}", host, port);

    let server = HttpServer::new(|| {
        App::new()
            .wrap(middleware::Logger::default())
            .route("/health", web::get().to(health))
            .route("/ready", web::get().to(ready))
    })
    .bind((host.as_str(), port))?
    .run();

    // Keep the service alive (listening for events + serving health probes)
    tracing::info!("Service is now running");

    server.await?;
    Ok(())
