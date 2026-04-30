mod config;
mod models;
mod email;
mod sms;
mod push;
mod dispatcher;

use crate::config::Settings;
use crate::dispatcher::NotificationDispatcher;
use crate::models::{Notification, NotificationChannel};
use tracing_subscriber::fmt::format::FmtSpan;

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
    let dispatcher = NotificationDispatcher::new(settings);

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

    // Keep the service alive (placeholder for an actual message loop)
    tracing::info!("Service is now idling (listening for events placeholder)");
    
    // Simulate a long-running service loop
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
    }
}
