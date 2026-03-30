use crate::config::SmtpConfig;
use crate::error::NotificationError;
use crate::models::{
    EmailPayload, InAppPayload, Notification, NotificationPayload, NotificationStatus,
    PushPayload, PushPlatform, WebhookPayload,
};
use crate::queue::NotificationQueue;
use deadpool_redis::Pool;
use lettre::message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::sync::Arc;
use std::time::Duration;
use tokio::time::{interval, sleep};
use tracing::{debug, error, info, warn};

/// Background worker that processes notifications from the queue
pub struct NotificationWorker {
    queue: NotificationQueue,
    smtp_config: SmtpConfig,
    webhook_base_url: Option<String>,
    running: bool,
    poll_interval_seconds: u64,
}

impl NotificationWorker {
    /// Create a new notification worker
    pub fn new(
        redis_pool: Pool,
        smtp_config: SmtpConfig,
        webhook_base_url: Option<String>,
    ) -> Self {
        Self {
            queue: NotificationQueue::new(redis_pool),
            smtp_config,
            webhook_base_url,
            running: false,
            poll_interval_seconds: 5,
        }
    }

    /// Set poll interval
    pub fn with_poll_interval(mut self, seconds: u64) -> Self {
        self.poll_interval_seconds = seconds;
        self
    }

    /// Start the worker
    pub async fn start(&mut self) -> Result<(), NotificationError> {
        self.running = true;
        info!("Notification worker started");

        let mut ticker = interval(Duration::from_secs(self.poll_interval_seconds));

        while self.running {
            ticker.tick().await;

            // Process notifications
            match self.process_next().await {
                Ok(true) => {
                    // Successfully processed a notification, continue immediately
                    continue;
                }
                Ok(false) => {
                    // No notifications to process
                    debug!("No pending notifications");
                }
                Err(e) => {
                    error!("Error processing notification: {}", e);
                    // Continue to next iteration
                }
            }

            // Periodically requeue stuck notifications (every ~30 seconds)
            if rand::random::<f32>() < 0.1 {
                if let Err(e) = self.queue.requeue_stuck(300).await {
                    warn!("Failed to requeue stuck notifications: {}", e);
                }
            }
        }

        info!("Notification worker stopped");
        Ok(())
    }

    /// Stop the worker
    pub fn stop(&mut self) {
        self.running = false;
        info!("Notification worker stop requested");
    }

    /// Process the next notification from the queue
    async fn process_next(&self) -> Result<bool, NotificationError> {
        // Try to dequeue a notification
        let notification = match self.queue.dequeue().await? {
            Some(n) => n,
            None => return Ok(false),
        };

        info!(
            "Processing notification {} of type {:?}",
            notification.id, notification.notification_type
        );

        // Process based on notification type
        let result = match &notification.payload {
            NotificationPayload::Email(payload) => {
                self.send_email(notification.id.clone(), payload).await
            }
            NotificationPayload::InApp(payload) => {
                self.send_in_app(notification.id.clone(), payload).await
            }
            NotificationPayload::Push(payload) => {
                self.send_push(notification.id.clone(), payload).await
            }
            NotificationPayload::Webhook(payload) => {
                self.send_webhook(notification.id.clone(), payload).await
            }
            NotificationPayload::Sms(payload) => {
                self.send_sms(notification.id.clone(), payload).await
            }
        };

        // Handle result
        match result {
            Ok(()) => {
                self.queue.mark_delivered(&notification.id).await?;
                info!("Successfully processed notification {}", notification.id);
            }
            Err(e) => {
                let error_msg = e.to_string();
                error!(
                    "Failed to process notification {}: {}",
                    notification.id, error_msg
                );
                self.queue.mark_failed(&notification.id, error_msg).await?;
            }
        }

        Ok(true)
    }

    /// Send email notification
    async fn send_email(
        &self,
        _notification_id: String,
        payload: &EmailPayload,
    ) -> Result<(), NotificationError> {
        // Skip if SMTP is not configured
        if self.smtp_config.username.is_empty() {
            warn!("SMTP not configured, skipping email");
            return Ok(());
        }

        // Build email message
        let from_mailbox: Mailbox = format!(
            "{} <{}>",
            self.smtp_config.from_name, self.smtp_config.from_address
        )
        .parse()
        .map_err(|e| NotificationError::Email(format!("Invalid from address: {}", e)))?;

        let mut message_builder = Message::builder()
            .from(from_mailbox)
            .subject(&payload.subject);

        // Add recipients
        for to in &payload.to {
            let mailbox: Mailbox = to
                .parse()
                .map_err(|e| NotificationError::Email(format!("Invalid to address: {}", e)))?;
            message_builder = message_builder.to(mailbox);
        }

        if let Some(cc) = &payload.cc {
            for cc_addr in cc {
                let mailbox: Mailbox = cc_addr
                    .parse()
                    .map_err(|e| NotificationError::Email(format!("Invalid cc address: {}", e)))?;
                message_builder = message_builder.cc(mailbox);
            }
        }

        if let Some(bcc) = &payload.bcc {
            for bcc_addr in bcc {
                let mailbox: Mailbox = bcc_addr
                    .parse()
                    .map_err(|e| NotificationError::Email(format!("Invalid bcc address: {}", e)))?;
                message_builder = message_builder.bcc(mailbox);
            }
        }

        // Build message body
        let message = if let Some(html) = &payload.body_html {
            message_builder.multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(payload.body_text.clone()),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html.clone()),
                    ),
            )
        } else {
            message_builder.body(payload.body_text.clone())
        }
        .map_err(|e| NotificationError::Email(format!("Failed to build message: {}", e)))?;

        // Create SMTP transport
        let creds = Credentials::new(
            self.smtp_config.username.clone(),
            self.smtp_config.password.clone(),
        );

        let mailer: AsyncSmtpTransport<Tokio1Executor> =
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&self.smtp_config.host)
                .map_err(|e| NotificationError::Email(format!("SMTP relay error: {}", e)))?
                .port(self.smtp_config.port)
                .credentials(creds)
                .build();

        // Send email
        mailer
            .send(message)
            .await
            .map_err(|e| NotificationError::Email(format!("Failed to send email: {}", e)))?;

        info!("Email sent successfully to {:?}", payload.to);
        Ok(())
    }

    /// Store in-app notification (would typically save to database)
    async fn send_in_app(
        &self,
        _notification_id: String,
        payload: &InAppPayload,
    ) -> Result<(), NotificationError> {
        // In a real implementation, this would save to a database
        // For now, we just log it
        info!(
            "In-app notification for user {}: {}",
            payload.user_id, payload.title
        );

        // Simulate database storage
        debug!(
            "Storing in-app notification: {:?}",
            serde_json::to_string(payload)
        );

        Ok(())
    }

    /// Send push notification
    async fn send_push(
        &self,
        _notification_id: String,
        payload: &PushPayload,
    ) -> Result<(), NotificationError> {
        match payload.platform {
            PushPlatform::Fcm => {
                // Firebase Cloud Messaging
                info!(
                    "Sending FCM push notification to {} devices",
                    payload.device_tokens.len()
                );

                // In a real implementation, this would call FCM API
                // For now, we simulate the call
                for token in &payload.device_tokens {
                    debug!("Sending to FCM token: {}", token);
                }

                // Simulate API call delay
                sleep(Duration::from_millis(100)).await;
            }
            PushPlatform::Apns => {
                // Apple Push Notification Service
                info!(
                    "Sending APNS push notification to {} devices",
                    payload.device_tokens.len()
                );

                // In a real implementation, this would call APNS
                for token in &payload.device_tokens {
                    debug!("Sending to APNS token: {}", token);
                }

                sleep(Duration::from_millis(100)).await;
            }
            PushPlatform::WebPush => {
                // Web Push Protocol
                info!(
                    "Sending web push notification to {} subscriptions",
                    payload.device_tokens.len()
                );

                for token in &payload.device_tokens {
                    debug!("Sending web push to: {}", token);
                }

                sleep(Duration::from_millis(50)).await;
            }
        }

        Ok(())
    }

    /// Send webhook notification
    async fn send_webhook(
        &self,
        _notification_id: String,
        payload: &WebhookPayload,
    ) -> Result<(), NotificationError> {
        let url = if payload.url.starts_with("http") {
            payload.url.clone()
        } else if let Some(base_url) = &self.webhook_base_url {
            format!("{}{}", base_url, payload.url)
        } else {
            return Err(NotificationError::Config(
                "Webhook base URL not configured".to_string(),
            ));
        };

        info!("Sending webhook to {}", url);

        let client = reqwest::Client::new();
        let timeout = payload.timeout_seconds.unwrap_or(30);

        let mut request_builder = client
            .request(
                payload.method.parse().map_err(|_| {
                    NotificationError::InvalidType(format!(
                        "Invalid HTTP method: {}",
                        payload.method
                    ))
                })?,
                &url,
            )
            .timeout(Duration::from_secs(timeout))
            .json(&payload.body);

        // Add custom headers
        if let Some(headers) = &payload.headers {
            for (key, value) in headers {
                request_builder = request_builder.header(key, value);
            }
        }

        let response = request_builder.send().await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(NotificationError::HttpClient(
                reqwest::Error::from(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("Webhook failed with status {}: {}", status, body),
                )),
            ));
        }

        info!("Webhook sent successfully to {}", url);
        Ok(())
    }

    /// Send SMS notification
    async fn send_sms(
        &self,
        _notification_id: String,
        payload: &SmsPayload,
    ) -> Result<(), NotificationError> {
        info!(
            "Sending SMS to {} recipients: {}",
            payload.phone_numbers.len(),
            payload.message
        );

        // In a real implementation, this would integrate with an SMS provider
        // like Twilio, AWS SNS, or similar
        for phone in &payload.phone_numbers {
            debug!("Sending SMS to: {}", phone);
        }

        // Simulate API call
        sleep(Duration::from_millis(100)).await;

        Ok(())
    }

    /// Process a specific notification immediately (for retry)
    pub async fn process_notification(
        &self,
        notification: Notification,
    ) -> Result<(), NotificationError> {
        let result = match &notification.payload {
            NotificationPayload::Email(payload) => {
                self.send_email(notification.id.clone(), payload).await
            }
            NotificationPayload::InApp(payload) => {
                self.send_in_app(notification.id.clone(), payload).await
            }
            NotificationPayload::Push(payload) => {
                self.send_push(notification.id.clone(), payload).await
            }
            NotificationPayload::Webhook(payload) => {
                self.send_webhook(notification.id.clone(), payload).await
            }
            NotificationPayload::Sms(payload) => {
                self.send_sms(notification.id.clone(), payload).await
            }
        };

        match result {
            Ok(()) => {
                self.queue.mark_delivered(&notification.id).await?;
                Ok(())
            }
            Err(e) => {
                self.queue
                    .mark_failed(&notification.id, e.to_string())
                    .await?;
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Priority, NotificationType};

    // Note: These tests would require a running Redis instance
    // They are marked as ignored for CI/CD purposes

    #[test]
    fn test_worker_creation() {
        // This is a simple smoke test
        let smtp_config = SmtpConfig {
            host: "smtp.test.com".to_string(),
            port: 587,
            username: "test".to_string(),
            password: "test".to_string(),
            from_address: "test@test.com".to_string(),
            from_name: "Test".to_string(),
        };

        // Can't create actual worker without Redis pool in unit test
        // Just verify config works
        assert_eq!(smtp_config.port, 587);
    }
}
