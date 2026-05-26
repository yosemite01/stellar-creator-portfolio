use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use crate::models::{NotificationChannel, NotificationError, Result};
use crate::config::Settings;

pub struct EmailProvider {
    transport: SmtpTransport,
    from_address: String,
}

impl EmailProvider {
    pub fn new(settings: &Settings) -> Self {
        let creds = Credentials::new(settings.smtp_user.clone(), settings.smtp_pass.clone());

        let transport = SmtpTransport::relay(&settings.smtp_host)
             .unwrap() // Safe since host is validated or default
             .port(settings.smtp_port)
             .credentials(creds)
             .build();

        Self {
            transport,
            from_address: settings.smtp_from.clone(),
        }
    }

    pub async fn send(&self, recipient: &str, subject: &str, body: &str) -> Result<()> {
        let email = Message::builder()
            .from(self.from_address.parse().map_err(|e| NotificationError::Internal(format!("Invalid from address: {e}"))).unwrap())
            .to(recipient.parse().map_err(|e| NotificationError::InvalidRecipient(format!("{e}"))).unwrap())
            .subject(subject)
            .body(body.to_string())
            .map_err(|e| NotificationError::Internal(e.to_string()))?;

        // Lettre's blocking transport is usually fine in individual tasks, 
        // but since we're in an async context, we could use tokio::task::spawn_blocking 
        // if we weren't using the async version of lettre (which we aren't here for simplicity).
        // For production, we'd use the async-smtp-transport.
        let transport = self.transport.clone();
        let email_clone = email.clone();

        tokio::task::spawn_blocking(move || {
            transport.send(&email_clone)
        })
        .await
        .map_err(|e| NotificationError::Internal(e.to_string()))?
        .map_err(|e| NotificationError::Delivery {
            channel: NotificationChannel::Email,
            reason: e.to_string(),
        })?;

        Ok(())
    }
}
