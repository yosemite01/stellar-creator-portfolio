use crate::models::{NotificationChannel, NotificationError, Result};
use crate::config::Settings;

pub struct PushProvider {
    app_id: Option<String>,
}

impl PushProvider {
    pub fn new(settings: &Settings) -> Self {
        Self {
            app_id: settings.push_app_id.clone(),
        }
    }

    pub async fn send(&self, recipient: &str, message: &str) -> Result<()> {
        if self.app_id.is_none() {
            tracing::warn!("Push app ID not configured; stubbing push notification");
        }

        tracing::info!(
            "Push notification stub: to={}, message={}",
            recipient, message
        );

        // This would integrate with Firebase Cloud Messaging (FCM) or Apple Push Notification service (APNs)
        // For now, we stub it as per requirements.

        Ok(())
    }
}
