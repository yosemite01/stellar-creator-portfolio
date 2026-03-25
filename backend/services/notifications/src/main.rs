//! Stellar Platform Notifications Service
//! 
//! Multi-channel notification service supporting in-app, email, and webhook notifications.
//! 
//! Usage:
//!   cargo run --bin stellar-notifications

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio::time::{interval, Duration as TokioDuration};
use tracing_subscriber;
use uuid::Uuid;

// ============================================================
// Configuration
// ============================================================

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
    pub webhook_api_key: Option<String>,
    pub sendgrid_api_key: Option<String>,
    pub queue_interval_secs: u64,
    pub batch_size: usize,
}

impl Config {
    fn from_env() -> Self {
        Config {
            database_url: std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            smtp_host: std::env::var("SMTP_HOST").ok(),
            smtp_port: std::env::var("SMTP_PORT").ok().and_then(|p| p.parse().ok()),
            smtp_username: std::env::var("SMTP_USERNAME").ok(),
            smtp_password: std::env::var("SMTP_PASSWORD").ok(),
            smtp_from: std::env::var("SMTP_FROM").ok(),
            webhook_api_key: std::env::var("WEBHOOK_API_KEY").ok(),
            sendgrid_api_key: std::env::var("SENDGRID_API_KEY").ok(),
            queue_interval_secs: std::env::var("QUEUE_INTERVAL_SECS")
                .unwrap_or_else(|_| "5".to_string())
                .parse()
                .unwrap_or(5),
            batch_size: std::env::var("BATCH_SIZE")
                .unwrap_or_else(|_| "50".to_string())
                .parse()
                .unwrap_or(50),
        }
    }
}

// ============================================================
// Notification Types
// ============================================================

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum NotificationChannel {
    InApp,
    Email,
    Webhook,
    #[cfg(feature = "sms")]
    SMS,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum NotificationType {
    BountyCreated,
    BountyApplicationReceived,
    BountyApplicationAccepted,
    BountyApplicationRejected,
    BountyCompleted,
    BountyCancelled,
    PaymentReceived,
    PaymentSent,
    NewMessage,
    SystemAlert,
    Reminder,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Notification {
    pub id: Uuid,
    pub user_id: Option<Uuid>,        // None for broadcast
    pub notification_type: NotificationType,
    pub title: String,
    pub message: String,
    pub data: Option<serde_json::Value>,  // Additional context
    pub channels: Vec<NotificationChannel>,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NotificationPreferences {
    pub user_id: Uuid,
    pub email_enabled: bool,
    pub in_app_enabled: bool,
    pub webhook_enabled: bool,
    pub webhook_url: Option<String>,
    pub notification_types: HashMap<NotificationType, bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NotificationRecord {
    pub id: Uuid,
    pub notification_id: Uuid,
    pub channel: NotificationChannel,
    pub recipient: String,           // email address or webhook URL
    pub status: NotificationStatus,
    pub attempts: i32,
    pub last_attempt_at: Option<DateTime<Utc>>,
    pub sent_at: Option<DateTime<Utc>>,
    pub delivered_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum NotificationStatus {
    Pending,
    Queued,
    Sending,
    Sent,
    Delivered,
    Failed,
    Unsubscribed,
}

// ============================================================
// Notification Templates
// ============================================================

pub struct NotificationTemplate {
    pub notification_type: NotificationType,
    pub title: String,
    pub message_template: String,
    pub default_channels: Vec<NotificationChannel>,
}

impl NotificationTemplate {
    pub fn all() -> Vec<Self> {
        vec![
            NotificationTemplate {
                notification_type: NotificationType::BountyCreated,
                title: "New Bounty Posted".to_string(),
                message_template: "A new bounty \"{title}\" has been posted with a budget of {budget} XLM.".to_string(),
                default_channels: vec![NotificationChannel::InApp, NotificationChannel::Email],
            },
            NotificationTemplate {
                notification_type: NotificationType::BountyApplicationReceived,
                title: "New Application Received".to_string(),
                message_template: "You have received a new application for bounty \"{title}\" from {applicant}.".to_string(),
                default_channels: vec![NotificationChannel::InApp, NotificationChannel::Email],
            },
            NotificationTemplate {
                notification_type: NotificationType::BountyApplicationAccepted,
                title: "Application Accepted!".to_string(),
                message_template: "Your application for bounty \"{title}\" has been accepted! Budget: {budget} XLM.".to_string(),
                default_channels: vec![NotificationChannel::InApp, NotificationChannel::Email],
            },
            NotificationTemplate {
                notification_type: NotificationType::BountyApplicationRejected,
                title: "Application Update".to_string(),
                message_template: "Your application for bounty \"{title}\" was not selected this time.".to_string(),
                default_channels: vec![NotificationChannel::InApp],
            },
            NotificationTemplate {
                notification_type: NotificationType::BountyCompleted,
                title: "Bounty Completed".to_string(),
                message_template: "Bounty \"{title}\" has been marked as completed. Payment of {budget} XLM has been released.".to_string(),
                default_channels: vec![NotificationChannel::InApp, NotificationChannel::Email],
            },
            NotificationTemplate {
                notification_type: NotificationType::BountyCancelled,
                title: "Bounty Cancelled".to_string(),
                message_template: "Bounty \"{title}\" has been cancelled by the creator.".to_string(),
                default_channels: vec![NotificationChannel::InApp],
            },
            NotificationTemplate {
                notification_type: NotificationType::PaymentReceived,
                title: "Payment Received".to_string(),
                message_template: "You have received {amount} XLM for completing bounty \"{title}\".".to_string(),
                default_channels: vec![NotificationChannel::InApp, NotificationChannel::Email],
            },
            NotificationTemplate {
                notification_type: NotificationType::NewMessage,
                title: "New Message".to_string(),
                message_template: "You have a new message from {sender}: {preview}".to_string(),
                default_channels: vec![NotificationChannel::InApp, NotificationChannel::Email],
            },
            NotificationTemplate {
                notification_type: NotificationType::Reminder,
                title: "Reminder".to_string(),
                message_template: "{message}".to_string(),
                default_channels: vec![NotificationChannel::InApp],
            },
            NotificationTemplate {
                notification_type: NotificationType::SystemAlert,
                title: "System Alert".to_string(),
                message_template: "{message}".to_string(),
                default_channels: vec![NotificationChannel::InApp, NotificationChannel::Email],
            },
        ]
    }

    pub fn find(&self, notification_type: &NotificationType) -> Option<&'static NotificationTemplate> {
        Self::all().iter().find(|t| t.notification_type == *notification_type)
    }

    pub fn render(&self, variables: &HashMap<&str, &str>) -> String {
        let mut message = self.message_template.clone();
        for (key, value) in variables {
            message = message.replace(&format!("{{{}}}", key), value);
        }
        message
    }
}

// ============================================================
// Notification Service
// ============================================================

pub struct NotificationService {
    db: PgPool,
    http: reqwest::Client,
    config: Config,
}

impl NotificationService {
    fn new(db: PgPool, http: reqwest::Client, config: Config) -> Self {
        NotificationService { db, http, config }
    }

    /// Create and queue a notification
    async fn send(
        &self,
        user_id: Option<Uuid>,
        notification_type: NotificationType,
        title: String,
        message: String,
        data: Option<serde_json::Value>,
        channels: Vec<NotificationChannel>,
    ) -> Result<Uuid> {
        // Generate unique notification ID
        let notification_id = Uuid::new_v4();

        // Insert notification record
        sqlx::query(
            r#"
            INSERT INTO notifications (id, user_id, notification_type, title, message, data, read, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
            "#,
        )
        .bind(notification_id)
        .bind(user_id)
        .bind(serde_json::to_string(&notification_type)?)
        .bind(&title)
        .bind(&message)
        .bind(&data)
        .execute(&self.db)
        .await?;

        // Queue for each channel
        for channel in &channels {
            let recipient = if let Some(uid) = user_id {
                self.get_recipient_for_channel(uid, channel).await?
            } else {
                String::new() // Broadcast - no specific recipient
            };

            if recipient.is_empty() && *channel != NotificationChannel::InApp {
                tracing::warn!("No recipient for channel {:?}, skipping", channel);
                continue;
            }

            self.queue_channel_notification(notification_id, channel.clone(), &recipient).await?;
        }

        tracing::info!(
            "Queued notification {} for {:?} via {:?}",
            notification_id,
            user_id,
            channels
        );

        Ok(notification_id)
    }

    async fn get_recipient_for_channel(
        &self,
        user_id: Uuid,
        channel: &NotificationChannel,
    ) -> Result<Option<String>> {
        match channel {
            NotificationChannel::InApp => Ok(None), // In-app doesn't need recipient
            NotificationChannel::Email => {
                let email: Option<String> = sqlx::query_scalar(
                    "SELECT email FROM users WHERE id = $1 AND email IS NOT NULL"
                )
                .bind(user_id)
                .fetch_optional(&self.db)
                .await?;
                Ok(email)
            }
            NotificationChannel::Webhook => {
                let webhook_url: Option<String> = sqlx::query_scalar(
                    "SELECT webhook_url FROM notification_preferences WHERE user_id = $1"
                )
                .bind(user_id)
                .fetch_optional(&self.db)
                .await?;
                Ok(webhook_url)
            }
            #[cfg(feature = "sms")]
            NotificationChannel::SMS => {
                let phone: Option<String> = sqlx::query_scalar(
                    "SELECT phone FROM users WHERE id = $1"
                )
                .bind(user_id)
                .fetch_optional(&self.db)
                .await?;
                Ok(phone)
            }
        }
    }

    async fn queue_channel_notification(
        &self,
        notification_id: Uuid,
        channel: NotificationChannel,
        recipient: &str,
    ) -> Result<()> {
        let id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO notification_queue 
            (id, notification_id, channel, recipient, status, attempts, created_at)
            VALUES ($1, $2, $3, $4, 'pending', 0, NOW())
            "#,
        )
        .bind(id)
        .bind(notification_id)
        .bind(serde_json::to_string(&channel)?)
        .bind(recipient)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    /// Process pending notifications in the queue
    async fn process_queue(&self, batch_size: usize) -> Result<(usize, usize)> {
        let mut sent = 0;
        let mut failed = 0;

        // Fetch pending notifications
        let pending = sqlx::query_as::<_, (Uuid, Uuid, String, String, String, Option<String>)>(
            r#"
            SELECT id, notification_id, channel, recipient, title, message
            FROM notification_queue
            WHERE status = 'pending' AND attempts < 3
            ORDER BY created_at ASC
            LIMIT $1
            "#,
        )
        .bind(batch_size as i32)
        .fetch_all(&self.db)
        .await?;

        for (queue_id, notification_id, channel_str, recipient, title, message) in pending {
            let channel: NotificationChannel = serde_json::from_str(&channel_str)
                .unwrap_or(NotificationChannel::InApp);

            // Update status to sending
            sqlx::query("UPDATE notification_queue SET status = 'sending', attempts = attempts + 1, last_attempt_at = NOW() WHERE id = $1")
                .bind(queue_id)
                .execute(&self.db)
                .await?;

            // Attempt delivery
            let result = match channel {
                NotificationChannel::InApp => Ok(()), // In-app is just stored
                NotificationChannel::Email => self.send_email(&recipient, &title, &message).await,
                NotificationChannel::Webhook => self.send_webhook(&recipient, &title, &message).await,
                #[cfg(feature = "sms")]
                NotificationChannel::SMS => self.send_sms(&recipient, &message).await,
            };

            match result {
                Ok(()) => {
                    sqlx::query(
                        "UPDATE notification_queue SET status = 'sent', sent_at = NOW() WHERE id = $1"
                    )
                    .bind(queue_id)
                    .execute(&self.db)
                    .await?;
                    sent += 1;
                    tracing::info!("Sent {:?} notification {} to {}", channel, notification_id, recipient);
                }
                Err(e) => {
                    let error_msg = format!("{}", e);
                    sqlx::query(
                        "UPDATE notification_queue SET status = 'failed', error_message = $2 WHERE id = $1"
                    )
                    .bind(queue_id)
                    .bind(&error_msg)
                    .execute(&self.db)
                    .await?;
                    failed += 1;
                    tracing::error!("Failed to send {:?} notification {}: {}", channel, notification_id, e);
                }
            }
        }

        Ok((sent, failed))
    }

    async fn send_email(&self, to: &str, subject: &str, body: &str) -> Result<()> {
        if self.config.smtp_host.is_none() && self.config.sendgrid_api_key.is_none() {
            tracing::warn!("Email sending not configured, skipping email to {}", to);
            return Ok(());
        }

        if let Some(ref sendgrid_key) = self.config.sendgrid_api_key {
            self.send_via_sendgrid(sendgrid_key, to, subject, body).await?;
        } else if let (Some(host), Some(username), Some(password), Some(from)) = (
            &self.config.smtp_host,
            &self.config.smtp_username,
            &self.config.smtp_password,
            &self.config.smtp_from,
        ) {
            self.send_via_smtp(host, *self.config.smtp_port.unwrap_or(587), username, password, from, to, subject, body).await?;
        }

        Ok(())
    }

    async fn send_via_sendgrid(&self, api_key: &str, to: &str, subject: &str, body: &str) -> Result<()> {
        let from_email = self.config.smtp_from.unwrap_or_else(|| "noreply@stellar.com".to_string());
        
        #[derive(Serialize)]
        struct SendGridRequest<'a> {
            personalizations: Vec<SendGridPersonalization<'a>>,
            from: SendGridEmail<'a>,
            subject: &'a str,
            content: Vec<SendGridContent<'a>>,
        }

        #[derive(Serialize)]
        struct SendGridPersonalization<'a> {
            to: Vec<SendGridEmail<'a>>,
        }

        #[derive(Serialize)]
        struct SendGridEmail<'a> {
            email: &'a str,
        }

        #[derive(Serialize)]
        struct SendGridContent<'a> {
            #[serde(rename = "type")]
            content_type: &'a str,
            value: &'a str,
        }

        let request = SendGridRequest {
            personalizations: vec![SendGridPersonalization {
                to: vec![SendGridEmail { email: to }],
            }],
            from: SendGridEmail { email: &from_email },
            subject,
            content: vec![SendGridContent {
                content_type: "text/plain",
                value: body,
            }],
        };

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.sendgrid.com/v3/mail/send")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if response.status().is_success() {
            Ok(())
        } else {
            anyhow::bail!("SendGrid API error: {}", response.status());
        }
    }

    async fn send_via_smtp(
        &self,
        _host: &str,
        _port: u16,
        _username: &str,
        _password: &str,
        _from: &str,
        _to: &str,
        _subject: &str,
        _body: &str,
    ) -> Result<()> {
        // In production, use a proper SMTP library like `lettre`
        // For now, log the email
        tracing::info!(
            "SMTP email: to={}, subject={}, body={}",
            _to,
            _subject,
            _body
        );
        Ok(())
    }

    async fn send_webhook(&self, url: &str, title: &str, message: &str) -> Result<()> {
        #[derive(Serialize)]
        struct WebhookPayload<'a> {
            title: &'a str,
            message: &'a str,
            timestamp: String,
            source: &'a str,
        }

        let payload = WebhookPayload {
            title,
            message,
            timestamp: Utc::now().to_rfc3339(),
            source: "stellar-platform",
        };

        let mut request = self.http.post(url);
        if let Some(ref api_key) = self.config.webhook_api_key {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }
        request = request.header("Content-Type", "application/json");

        let response = request.json(&payload).send().await?;

        if response.status().is_success() {
            Ok(())
        } else {
            anyhow::bail!("Webhook error: {}", response.status());
        }
    }

    #[cfg(feature = "sms")]
    async fn send_sms(&self, _to: &str, _message: &str) -> Result<()> {
        // Twilio integration would go here
        tracing::info!("SMS to {}: {}", _to, _message);
        Ok(())
    }

    /// Mark notification as read
    async fn mark_read(&self, notification_id: Uuid, user_id: Uuid) -> Result<()> {
        sqlx::query(
            "UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2"
        )
        .bind(notification_id)
        .bind(user_id)
        .execute(&self.db)
        .await?;
        Ok(())
    }

    /// Get unread count for a user
    async fn get_unread_count(&self, user_id: Uuid) -> Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = false"
        )
        .bind(user_id)
        .fetch_one(&self.db)
        .await?;
        Ok(count)
    }

    /// Get notifications for a user
    async fn get_notifications(
        &self,
        user_id: Uuid,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<Notification>> {
        let notifications = sqlx::query_as::<_, Notification>(
            r#"
            SELECT id, user_id, notification_type, title, message, data, read, created_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(user_id)
        .bind(limit as i32)
        .bind(offset as i32)
        .fetch_all(&self.db)
        .await?;
        Ok(notifications)
    }

    /// Update user notification preferences
    async fn update_preferences(
        &self,
        preferences: NotificationPreferences,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO notification_preferences 
            (user_id, email_enabled, in_app_enabled, webhook_enabled, webhook_url, notification_types)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id) DO UPDATE SET
                email_enabled = EXCLUDED.email_enabled,
                in_app_enabled = EXCLUDED.in_app_enabled,
                webhook_enabled = EXCLUDED.webhook_enabled,
                webhook_url = EXCLUDED.webhook_url,
                notification_types = EXCLUDED.notification_types
            "#,
        )
        .bind(preferences.user_id)
        .bind(preferences.email_enabled)
        .bind(preferences.in_app_enabled)
        .bind(preferences.webhook_enabled)
        .bind(&preferences.webhook_url)
        .bind(serde_json::to_value(&preferences.notification_types)?)
        .execute(&self.db)
        .await?;
        Ok(())
    }
}

// ============================================================
// Database Setup
// ============================================================

async fn ensure_tables(pool: &PgPool) -> Result<()> {
    // Notifications table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS notifications (
            id UUID PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            notification_type VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            data JSONB,
            read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Notification queue table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS notification_queue (
            id UUID PRIMARY KEY,
            notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
            channel VARCHAR(20) NOT NULL,
            recipient TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            last_attempt_at TIMESTAMPTZ,
            sent_at TIMESTAMPTZ,
            delivered_at TIMESTAMPTZ,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Notification preferences table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS notification_preferences (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            email_enabled BOOLEAN DEFAULT TRUE,
            in_app_enabled BOOLEAN DEFAULT TRUE,
            webhook_enabled BOOLEAN DEFAULT FALSE,
            webhook_url TEXT,
            notification_types JSONB DEFAULT '{}'
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)")
        .execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read) WHERE read = false")
        .execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)")
        .execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_notification_queue_status ON notification_queue(status) WHERE status = 'pending'")
        .execute(pool).await?;

    Ok(())
}

// ============================================================
// Main
// ============================================================

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "info,stellar_notifications=debug,warn".to_string()),
        )
        .init();

    let config = Config::from_env();

    tracing::info!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

    tracing::info!("Ensuring notification tables exist...");
    ensure_tables(&pool).await?;

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("Failed to create HTTP client");

    let service = Arc::new(NotificationService::new(pool, http, config.clone()));

    tracing::info!(
        "Notification service started (queue interval: {}s, batch size: {})",
        config.queue_interval_secs,
        config.batch_size
    );

    // Start queue processor
    let queue_interval = TokioDuration::from_secs(config.queue_interval_secs);
    let batch_size = config.batch_size;

    let service_clone = service.clone();
    tokio::spawn(async move {
        let mut interval = interval(queue_interval);
        loop {
            interval.tick().await;
            match service_clone.process_queue(batch_size).await {
                Ok((sent, failed)) => {
                    if sent > 0 || failed > 0 {
                        tracing::info!("Queue processed: {} sent, {} failed", sent, failed);
                    }
                }
                Err(e) => {
                    tracing::error!("Queue processing error: {}", e);
                }
            }
        }
    });

    // Keep running
    tracing::info!("Notification service running. Press Ctrl+C to stop.");
    tokio::signal::ctrl_c().await?;

    tracing::info!("Shutting down notification service...");
    Ok(())
}
