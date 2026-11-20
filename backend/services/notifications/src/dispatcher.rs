use std::sync::Arc;
use tokio::time::{sleep, Duration};
use crate::models::{Notification, NotificationChannel, Result};
use crate::email::EmailProvider;
use crate::sms::SmsProvider;
use crate::push::PushProvider;
use crate::config::Settings;

/// A channel-specific transport capable of delivering a notification.
///
/// Abstracting the concrete providers behind this trait lets `dispatch`'s
/// routing and retry logic be unit tested without making real network calls.
#[async_trait::async_trait]
pub trait NotificationSender: Send + Sync {
    async fn send_notification(&self, notification: &Notification) -> Result<()>;
}

#[async_trait::async_trait]
impl NotificationSender for EmailProvider {
    async fn send_notification(&self, notification: &Notification) -> Result<()> {
        let subject = notification.subject.as_deref().unwrap_or("No Subject");
        self.send(&notification.recipient, subject, &notification.message).await
    }
}

#[async_trait::async_trait]
impl NotificationSender for SmsProvider {
    async fn send_notification(&self, notification: &Notification) -> Result<()> {
        self.send(&notification.recipient, &notification.message).await
    }
}

#[async_trait::async_trait]
impl NotificationSender for PushProvider {
    async fn send_notification(&self, notification: &Notification) -> Result<()> {
        self.send(&notification.recipient, &notification.message).await
    }
}

pub struct NotificationDispatcher {
    email: Arc<dyn NotificationSender>,
    sms: Arc<dyn NotificationSender>,
    push: Arc<dyn NotificationSender>,
}

impl NotificationDispatcher {
    pub fn new(settings: Settings) -> Result<Self> {
        Ok(Self {
            email: Arc::new(EmailProvider::new(&settings)?),
            sms: Arc::new(SmsProvider::new(&settings)),
            push: Arc::new(PushProvider::new(&settings)),
        })
    }

    #[cfg(test)]
    fn from_senders(
        email: Arc<dyn NotificationSender>,
        sms: Arc<dyn NotificationSender>,
        push: Arc<dyn NotificationSender>,
    ) -> Self {
        Self { email, sms, push }
    }

    fn sender_for(&self, channel: &NotificationChannel) -> &Arc<dyn NotificationSender> {
        match channel {
            NotificationChannel::Email => &self.email,
            NotificationChannel::SMS => &self.sms,
            NotificationChannel::Push => &self.push,
        }
    }

    pub async fn dispatch(&self, notification: Notification) -> Result<()> {
        let max_retries = 3;
        let mut attempts = 0;
        let sender = self.sender_for(&notification.channel);

        loop {
            attempts += 1;
            tracing::info!(
                "Attempt {} to send {:?} notification to {}",
                attempts,
                notification.channel,
                notification.recipient
            );

            match sender.send_notification(&notification).await {
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

    pub fn is_channel_enabled(
        &self,
        channel: &NotificationChannel,
        prefs: &crate::models::UserNotificationPreferences,
    ) -> bool {
        match channel {
            NotificationChannel::Email => prefs.email_enabled,
            NotificationChannel::SMS => prefs.sms_enabled,
            NotificationChannel::Push => prefs.push_enabled,
        }
    }

    /// Dispatches notification only if permitted by user preferences (#1758).
    pub async fn dispatch_with_preferences(
        &self,
        notification: Notification,
        preferences: Option<&crate::models::UserNotificationPreferences>,
    ) -> Result<()> {
        if let Some(prefs) = preferences {
            if !self.is_channel_enabled(&notification.channel, prefs) {
                tracing::info!(
                    "Skipping {:?} notification to {}: user opted out",
                    notification.channel,
                    notification.recipient
                );
                return Err(crate::models::NotificationError::PreferenceOptOut {
                    channel: notification.channel,
                });
            }
        }
        self.dispatch(notification).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NotificationError;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A sender that fails its first `fail_first_n` calls, then succeeds.
    struct FakeSender {
        calls: AtomicUsize,
        fail_first_n: usize,
    }

    impl FakeSender {
        fn always_ok() -> Self {
            Self { calls: AtomicUsize::new(0), fail_first_n: 0 }
        }
        fn always_err() -> Self {
            Self { calls: AtomicUsize::new(0), fail_first_n: usize::MAX }
        }
        fn fail_first(n: usize) -> Self {
            Self { calls: AtomicUsize::new(0), fail_first_n: n }
        }
        fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    #[async_trait::async_trait]
    impl NotificationSender for FakeSender {
        async fn send_notification(&self, _notification: &Notification) -> Result<()> {
            let attempt = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            if attempt <= self.fail_first_n {
                return Err(NotificationError::Delivery {
                    channel: NotificationChannel::Email,
                    reason: "simulated failure".to_string(),
                });
            }
            Ok(())
        }
    }

    /// A sender that panics if invoked — used to assert a channel's
    /// notification never reaches the wrong provider.
    struct PanicSender;

    #[async_trait::async_trait]
    impl NotificationSender for PanicSender {
        async fn send_notification(&self, _notification: &Notification) -> Result<()> {
            panic!("this sender should never be invoked for this channel");
        }
    }

    fn test_notification(channel: NotificationChannel) -> Notification {
        Notification {
            user_id: "user-1".to_string(),
            channel,
            recipient: "test@example.com".to_string(),
            subject: Some("Subject".to_string()),
            message: "Body".to_string(),
        }
    }

    #[tokio::test]
    async fn email_notification_routes_to_email_sender_only() {
        let email = Arc::new(FakeSender::always_ok());
        let dispatcher = NotificationDispatcher::from_senders(
            email.clone(),
            Arc::new(PanicSender),
            Arc::new(PanicSender),
        );

        let result = dispatcher.dispatch(test_notification(NotificationChannel::Email)).await;
        assert!(result.is_ok());
        assert_eq!(email.call_count(), 1);
    }

    #[tokio::test]
    async fn sms_notification_routes_to_sms_sender_only() {
        let sms = Arc::new(FakeSender::always_ok());
        let dispatcher = NotificationDispatcher::from_senders(
            Arc::new(PanicSender),
            sms.clone(),
            Arc::new(PanicSender),
        );

        let result = dispatcher.dispatch(test_notification(NotificationChannel::SMS)).await;
        assert!(result.is_ok());
        assert_eq!(sms.call_count(), 1);
    }

    #[tokio::test]
    async fn push_notification_routes_to_push_sender_only() {
        let push = Arc::new(FakeSender::always_ok());
        let dispatcher = NotificationDispatcher::from_senders(
            Arc::new(PanicSender),
            Arc::new(PanicSender),
            push.clone(),
        );

        let result = dispatcher.dispatch(test_notification(NotificationChannel::Push)).await;
        assert!(result.is_ok());
        assert_eq!(push.call_count(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn dispatch_retries_and_eventually_succeeds() {
        let email = Arc::new(FakeSender::fail_first(2));
        let dispatcher = NotificationDispatcher::from_senders(
            email.clone(),
            Arc::new(PanicSender),
            Arc::new(PanicSender),
        );

        let result = dispatcher.dispatch(test_notification(NotificationChannel::Email)).await;
        assert!(result.is_ok());
        assert_eq!(email.call_count(), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn dispatch_returns_err_after_exhausting_retries() {
        let email = Arc::new(FakeSender::always_err());
        let dispatcher = NotificationDispatcher::from_senders(
            email.clone(),
            Arc::new(PanicSender),
            Arc::new(PanicSender),
        );

        let result = dispatcher.dispatch(test_notification(NotificationChannel::Email)).await;
        assert!(result.is_err());
        assert_eq!(email.call_count(), 3);
    }

    /// `NotificationChannel` is a closed enum, so `dispatch` can never see an
    /// "unknown" channel at runtime — an unrecognized value is rejected here,
    /// at deserialization, before a `Notification` can even be constructed.
    #[test]
    fn unknown_channel_value_fails_deserialization_before_dispatch() {
        let raw = serde_json::json!({
            "user_id": "user-1",
            "channel": "Carrier-Pigeon",
            "recipient": "test@example.com",
            "subject": null,
            "message": "Body"
        });
        let result: std::result::Result<Notification, _> = serde_json::from_value(raw);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn dispatch_with_preferences_respects_opt_out() {
        let email = Arc::new(FakeSender::always_ok());
        let dispatcher = NotificationDispatcher::from_senders(
            email.clone(),
            Arc::new(PanicSender),
            Arc::new(PanicSender),
        );

        let prefs = crate::models::UserNotificationPreferences {
            user_id: "user-1".into(),
            email_enabled: false,
            sms_enabled: true,
            push_enabled: true,
            quiet_hours_start: None,
            quiet_hours_end: None,
        };

        let result = dispatcher
            .dispatch_with_preferences(
                test_notification(NotificationChannel::Email),
                Some(&prefs),
            )
            .await;

        assert!(matches!(
            result,
            Err(crate::models::NotificationError::PreferenceOptOut {
                channel: NotificationChannel::Email
            })
        ));
        assert_eq!(email.call_count(), 0);
    }
}
