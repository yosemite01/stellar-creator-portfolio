use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[allow(clippy::upper_case_acronyms)] // `SMS` is part of the serde wire format; renaming would be a breaking change
pub enum NotificationChannel {
    Email,
    SMS,
    Push,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub user_id: String,
    pub channel: NotificationChannel,
    pub recipient: String,
    pub subject: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserNotificationPreferences {
    pub user_id: String,
    pub email_enabled: bool,
    pub sms_enabled: bool,
    pub push_enabled: bool,
    pub quiet_hours_start: Option<u32>, // 0-23
    pub quiet_hours_end: Option<u32>,   // 0-23
}

impl Default for UserNotificationPreferences {
    fn default() -> Self {
        Self {
            user_id: String::new(),
            email_enabled: true,
            sms_enabled: true,
            push_enabled: true,
            quiet_hours_start: None,
            quiet_hours_end: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum NotificationError {
    #[error("Configuration error: {0}")]
    Config(String),
    #[error("Delivery failed for channel {channel:?}: {reason}")]
    Delivery {
        channel: NotificationChannel,
        reason: String,
    },
    #[error("Rate limited")]
    #[allow(dead_code)] // reserved for future rate-limiting support
    RateLimited,
    #[error("Notification opted out by user preference for channel {channel:?}")]
    PreferenceOptOut { channel: NotificationChannel },
    #[error("Invalid recipient: {0}")]
    InvalidRecipient(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, NotificationError>;
