use std::sync::Arc;
use tokio::time::{sleep, Duration};
use crate::models::{Notification, NotificationChannel, NotificationError, Result};
use crate::email::EmailProvider;
use crate::sms::SmsProvider;
use crate::push::PushProvider;
use crate::config::Settings;

pub struct NotificationDispatcher {
    email: Arc<EmailProvider>,
    sms: Arc<SmsProvider>,
    push: Arc<PushProvider>,
}

impl NotificationDispatcher {
    pub fn new(settings: Settings) -> Self {
        Self {
            email: Arc::new(EmailProvider::new(&settings)),
            sms: Arc::new(SmsProvider::new(&settings)),
            push: Arc::new(PushProvider::new(&settings)),
        }
    }

    pub async fn dispatch(&self, notification: Notification) -> Result<()> {
        let max_retries = 3;
        let mut attempts = 0;

        loop {
            attempts += 1;
            tracing::info!(
                "Attempt {} to send {:?} notification to {}",
                attempts,
                notification.channel,
                notification.recipient
            );

            let result = match notification.channel {
                NotificationChannel::Email => {
                    let subject = notification.subject.as_deref().unwrap_or("No Subject");
                    self.email.send(&notification.recipient, subject, &notification.message).await
                }
                NotificationChannel::SMS => {
                    self.sms.send(&notification.recipient, &notification.message).await
                }
                NotificationChannel::Push => {
                    self.push.send(&notification.recipient, &notification.message).await
                }
            };

            match result {
                Ok(_) => {
                    tracing::info!(
                        "Successfully sent {:?} notification to {}",
                        notification.channel,
                        notification.recipient
                    );
                    return Ok(());
                }
                Err(error) if attempts < max_retries => {
                    let backoff = Duration::from_secs(2u64.pow(attempts));
                    tracing::warn!(
                        "Error sending notification (attempt {}/{}): {}. Retrying in {:?}...",
                        attempts,
                        max_retries,
                        error,
                        backoff
                    );
                    sleep(backoff).await;
                }
                Err(error) => {
                    tracing::error!(
                        "Failed to send notification after {} attempts: {}",
                        attempts,
                        error
                    );
                    return Err(error);
                }
            }
        }
    }
}
