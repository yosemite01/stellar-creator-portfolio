use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Notification types supported by the system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationType {
    /// Email notification
    Email,
    /// In-app notification (stored for user retrieval)
    InApp,
    /// Push notification to mobile/web
    Push,
    /// Webhook callback to external service
    Webhook,
    /// SMS notification
    Sms,
}

/// Priority levels for notifications
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Low,
    Normal,
    High,
    Critical,
}

impl Default for Priority {
    fn default() -> Self {
        Priority::Normal
    }
}

/// Current status of a notification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationStatus {
    /// Waiting in queue to be processed
    Pending,
    /// Currently being processed
    Processing,
    /// Successfully delivered
    Delivered,
    /// Failed to deliver
    Failed,
    /// Permanently failed after max retries
    DeadLetter,
    /// Cancelled by user or system
    Cancelled,
}

/// Email-specific notification payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailPayload {
    pub to: Vec<String>,
    pub cc: Option<Vec<String>>,
    pub bcc: Option<Vec<String>>,
    pub subject: String,
    pub body_html: Option<String>,
    pub body_text: String,
    pub attachments: Option<Vec<Attachment>>,
}

/// Attachment for email notifications
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub filename: String,
    pub content_type: String,
    pub content: String, // Base64 encoded
}

/// In-app notification payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InAppPayload {
    pub user_id: String,
    pub title: String,
    pub message: String,
    pub action_url: Option<String>,
    pub icon: Option<String>,
}

/// Push notification payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushPayload {
    pub device_tokens: Vec<String>,
    pub title: String,
    pub body: String,
    pub data: Option<serde_json::Value>,
    pub platform: PushPlatform,
}

/// Push notification platforms
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PushPlatform {
    Fcm,    // Firebase Cloud Messaging
    Apns,   // Apple Push Notification Service
    WebPush,
}

/// Webhook notification payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookPayload {
    pub url: String,
    pub method: String,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub body: serde_json::Value,
    pub timeout_seconds: Option<u64>,
}

/// SMS notification payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmsPayload {
    pub phone_numbers: Vec<String>,
    pub message: String,
    pub sender_id: Option<String>,
}

/// Union type for all notification payloads
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationPayload {
    Email(EmailPayload),
    InApp(InAppPayload),
    Push(PushPayload),
    Webhook(WebhookPayload),
    Sms(SmsPayload),
}

/// Main notification structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub notification_type: NotificationType,
    pub payload: NotificationPayload,
    pub priority: Priority,
    pub status: NotificationStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub error_message: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

impl Notification {
    /// Create a new notification
    pub fn new(
        notification_type: NotificationType,
        payload: NotificationPayload,
        priority: Priority,
        max_retries: u32,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            notification_type,
            payload,
            priority,
            status: NotificationStatus::Pending,
            created_at: now,
            updated_at: now,
            scheduled_at: None,
            retry_count: 0,
            max_retries,
            error_message: None,
            metadata: None,
        }
    }

    /// Mark notification as processing
    pub fn mark_processing(&mut self) {
        self.status = NotificationStatus::Processing;
        self.updated_at = Utc::now();
    }

    /// Mark notification as delivered
    pub fn mark_delivered(&mut self) {
        self.status = NotificationStatus::Delivered;
        self.updated_at = Utc::now();
        self.error_message = None;
    }

    /// Mark notification as failed
    pub fn mark_failed(&mut self, error: String) {
        self.retry_count += 1;
        self.error_message = Some(error);
        
        if self.retry_count >= self.max_retries {
            self.status = NotificationStatus::DeadLetter;
        } else {
            self.status = NotificationStatus::Failed;
        }
        self.updated_at = Utc::now();
    }

    /// Check if notification can be retried
    pub fn can_retry(&self) -> bool {
        self.retry_count < self.max_retries && 
        matches!(self.status, NotificationStatus::Failed | NotificationStatus::Pending)
    }

    /// Calculate retry delay based on retry count (exponential backoff)
    pub fn retry_delay_seconds(&self, base_delay: u64) -> u64 {
        base_delay * 2_u64.pow(self.retry_count)
    }
}

/// Request to send a notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendNotificationRequest {
    pub notification_type: NotificationType,
    pub payload: NotificationPayload,
    #[serde(default)]
    pub priority: Priority,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub metadata: Option<serde_json::Value>,
}

/// Response after sending a notification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendNotificationResponse {
    pub id: String,
    pub status: NotificationStatus,
    pub message: String,
}

/// Notification status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationStatusResponse {
    pub id: String,
    pub status: NotificationStatus,
    pub notification_type: NotificationType,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub error_message: Option<String>,
}

impl From<Notification> for NotificationStatusResponse {
    fn from(n: Notification) -> Self {
        Self {
            id: n.id,
            status: n.status,
            notification_type: n.notification_type,
            created_at: n.created_at,
            updated_at: n.updated_at,
            retry_count: n.retry_count,
            max_retries: n.max_retries,
            error_message: n.error_message,
        }
    }
}

/// Queue statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStats {
    pub pending: u64,
    pub processing: u64,
    pub delivered: u64,
    pub failed: u64,
    pub dead_letter: u64,
}
