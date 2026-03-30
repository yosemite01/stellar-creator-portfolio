use reqwest::Client;
use serde_json::json;
use crate::models::{NotificationChannel, NotificationError, Result};
use crate::config::Settings;

pub struct SmsProvider {
    client: Client,
    sid: String,
    auth_token: String,
    from_number: String,
}

impl SmsProvider {
    pub fn new(settings: &Settings) -> Self {
        Self {
            client: Client::new(),
            sid: settings.twilio_sid.clone(),
            auth_token: settings.twilio_auth_token.clone(),
            from_number: settings.twilio_from_number.clone(),
        }
    }

    pub async fn send(&self, to: &str, body: &str) -> Result<()> {
        let url = format!(
            "https://api.twilio.com/2010-04-01/Accounts/{}/Messages.json",
            self.sid
        );

        let response = self.client
            .post(url)
            .basic_auth(&self.sid, Some(&self.auth_token))
            .form(&[
                ("To", to),
                ("From", &self.from_number),
                ("Body", body),
            ])
            .send()
            .await
            .map_err(|e| NotificationError::Delivery {
                channel: NotificationChannel::SMS,
                reason: e.to_string(),
            })?;

        if !response.status().is_success() {
            let error_json = response.text().await.unwrap_or_default();
            return Err(NotificationError::Delivery {
                channel: NotificationChannel::SMS,
                reason: format!("Twilio API error: {error_json}"),
            });
        }

        Ok(())
    }
}
