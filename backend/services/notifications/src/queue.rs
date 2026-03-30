use crate::error::NotificationError;
use crate::models::{Notification, NotificationStatus, Priority};
use chrono::Utc;
use deadpool_redis::{Pool, Connection};
use redis::AsyncCommands;
use serde_json;
use std::sync::Arc;
use tracing::{debug, error, info, warn};

/// Redis keys for different queues
const QUEUE_PENDING: &str = "notifications:queue:pending";
const QUEUE_PROCESSING: &str = "notifications:queue:processing";
const QUEUE_DELIVERED: &str = "notifications:queue:delivered";
const QUEUE_FAILED: &str = "notifications:queue:failed";
const QUEUE_DEAD_LETTER: &str = "notifications:queue:dead_letter";
const NOTIFICATION_DATA_PREFIX: &str = "notifications:data:";

/// Redis-based notification queue implementation
#[derive(Clone)]
pub struct NotificationQueue {
    pool: Pool,
}

impl NotificationQueue {
    /// Create a new notification queue
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    /// Get a connection from the pool
    async fn get_conn(&self) -> Result<Connection, NotificationError> {
        self.pool.get().await.map_err(NotificationError::Pool)
    }

    /// Enqueue a notification
    /// 
    /// Adds the notification to the pending queue with priority-based scoring
    pub async fn enqueue(&self, notification: &Notification) -> Result<(), NotificationError> {
        let mut conn = self.get_conn().await?;
        
        // Serialize notification
        let notification_json = serde_json::to_string(notification)?;
        
        // Store notification data
        let data_key = format!("{}{}", NOTIFICATION_DATA_PREFIX, notification.id);
        conn.set(&data_key, &notification_json).await?;
        
        // Calculate priority score (lower = higher priority)
        let score = Self::priority_score(&notification.priority);
        
        // Add to pending queue with scheduled time consideration
        let final_score = if let Some(scheduled) = notification.scheduled_at {
            let scheduled_timestamp = scheduled.timestamp() as f64;
            scheduled_timestamp.max(score)
        } else {
            score
        };
        
        conn.zadd(QUEUE_PENDING, &notification.id, final_score).await?;
        
        info!(
            "Enqueued notification {} of type {:?} with priority {:?}",
            notification.id, notification.notification_type, notification.priority
        );
        
        Ok(())
    }

    /// Dequeue the next notification for processing
    /// 
    /// Uses Redis sorted set to get the highest priority notification
    pub async fn dequeue(&self) -> Result<Option<Notification>, NotificationError> {
        let mut conn = self.get_conn().await?;
        
        // Get the notification with lowest score (highest priority)
        let result: Option<(String, f64)> = conn
            .zpopmin(QUEUE_PENDING, 1)
            .await?;
        
        if let Some((notification_id, _)) = result {
            // Get notification data
            let data_key = format!("{}{}", NOTIFICATION_DATA_PREFIX, notification_id);
            let notification_json: Option<String> = conn.get(&data_key).await?;
            
            if let Some(json) = notification_json {
                let mut notification: Notification = serde_json::from_str(&json)?;
                
                // Check if scheduled for later
                if let Some(scheduled) = notification.scheduled_at {
                    if scheduled > Utc::now() {
                        // Put it back in the queue
                        let score = scheduled.timestamp() as f64;
                        conn.zadd(QUEUE_PENDING, &notification_id, score).await?;
                        return Ok(None);
                    }
                }
                
                // Move to processing queue
                notification.mark_processing();
                let updated_json = serde_json::to_string(&notification)?;
                conn.set(&data_key, &updated_json).await?;
                conn.zadd(QUEUE_PROCESSING, &notification_id, Utc::now().timestamp() as f64).await?;
                
                debug!("Dequeued notification {} for processing", notification_id);
                return Ok(Some(notification));
            } else {
                warn!("Notification data not found for ID: {}", notification_id);
                // Remove from pending since data is missing
                conn.zrem(QUEUE_PENDING, &notification_id).await?;
            }
        }
        
        Ok(None)
    }

    /// Mark a notification as delivered
    pub async fn mark_delivered(&self, notification_id: &str) -> Result<(), NotificationError> {
        let mut conn = self.get_conn().await?;
        
        // Get and update notification
        let data_key = format!("{}{}", NOTIFICATION_DATA_PREFIX, notification_id);
        let notification_json: Option<String> = conn.get(&data_key).await?;
        
        if let Some(json) = notification_json {
            let mut notification: Notification = serde_json::from_str(&json)?;
            notification.mark_delivered();
            
            let updated_json = serde_json::to_string(&notification)?;
            conn.set(&data_key, &updated_json).await?;
            
            // Move from processing to delivered
            conn.zrem(QUEUE_PROCESSING, notification_id).await?;
            conn.zadd(QUEUE_DELIVERED, notification_id, Utc::now().timestamp() as f64).await?;
            
            info!("Notification {} marked as delivered", notification_id);
        }
        
        Ok(())
    }

    /// Mark a notification as failed
    pub async fn mark_failed(
        &self, 
        notification_id: &str, 
        error: String
    ) -> Result<(), NotificationError> {
        let mut conn = self.get_conn().await?;
        
        // Get and update notification
        let data_key = format!("{}{}", NOTIFICATION_DATA_PREFIX, notification_id);
        let notification_json: Option<String> = conn.get(&data_key).await?;
        
        if let Some(json) = notification_json {
            let mut notification: Notification = serde_json::from_str(&json)?;
            notification.mark_failed(error);
            
            let updated_json = serde_json::to_string(&notification)?;
            conn.set(&data_key, &updated_json).await?;
            
            // Remove from processing
            conn.zrem(QUEUE_PROCESSING, notification_id).await?;
            
            if notification.status == NotificationStatus::DeadLetter {
                // Move to dead letter queue
                conn.zadd(QUEUE_DEAD_LETTER, notification_id, Utc::now().timestamp() as f64).await?;
                warn!(
                    "Notification {} moved to dead letter queue after {} retries",
                    notification_id, notification.retry_count
                );
            } else {
                // Add back to pending for retry with delayed score
                let retry_delay = notification.retry_delay_seconds(60);
                let retry_score = (Utc::now().timestamp() + retry_delay as i64) as f64;
                conn.zadd(QUEUE_PENDING, notification_id, retry_score).await?;
                info!(
                    "Notification {} scheduled for retry {} in {} seconds",
                    notification_id, notification.retry_count, retry_delay
                );
            }
        }
        
        Ok(())
    }

    /// Get notification by ID
    pub async fn get_notification(&self, notification_id: &str) -> Result<Option<Notification>, NotificationError> {
        let mut conn = self.get_conn().await?;
        
        let data_key = format!("{}{}", NOTIFICATION_DATA_PREFIX, notification_id);
        let notification_json: Option<String> = conn.get(&data_key).await?;
        
        if let Some(json) = notification_json {
            let notification: Notification = serde_json::from_str(&json)?;
            return Ok(Some(notification));
        }
        
        Ok(None)
    }

    /// Retry a failed notification
    pub async fn retry_notification(&self, notification_id: &str) -> Result<(), NotificationError> {
        let mut conn = self.get_conn().await?;
        
        let data_key = format!("{}{}", NOTIFICATION_DATA_PREFIX, notification_id);
        let notification_json: Option<String> = conn.get(&data_key).await?;
        
        if let Some(json) = notification_json {
            let mut notification: Notification = serde_json::from_str(&json)?;
            
            if !notification.can_retry() {
                return Err(NotificationError::MaxRetriesExceeded(notification_id.to_string()));
            }
            
            // Reset status to pending
            notification.status = NotificationStatus::Pending;
            notification.updated_at = Utc::now();
            
            let updated_json = serde_json::to_string(&notification)?;
            conn.set(&data_key, &updated_json).await?;
            
            // Remove from failed/dead letter and add to pending
            conn.zrem(QUEUE_FAILED, notification_id).await?;
            conn.zrem(QUEUE_DEAD_LETTER, notification_id).await?;
            
            let score = Self::priority_score(&notification.priority);
            conn.zadd(QUEUE_PENDING, notification_id, score).await?;
            
            info!("Notification {} queued for retry", notification_id);
            return Ok(());
        }
        
        Err(NotificationError::NotFound(notification_id.to_string()))
    }

    /// Get queue statistics
    pub async fn get_stats(&self) -> Result<crate::models::QueueStats, NotificationError> {
        let mut conn = self.get_conn().await?;
        
        let pending: u64 = conn.zcard(QUEUE_PENDING).await?;
        let processing: u64 = conn.zcard(QUEUE_PROCESSING).await?;
        let delivered: u64 = conn.zcard(QUEUE_DELIVERED).await?;
        let failed: u64 = conn.zcard(QUEUE_FAILED).await?;
        let dead_letter: u64 = conn.zcard(QUEUE_DEAD_LETTER).await?;
        
        Ok(crate::models::QueueStats {
            pending,
            processing,
            delivered,
            failed,
            dead_letter,
        })
    }

    /// Calculate priority score for Redis sorted set
    /// Lower score = higher priority
    fn priority_score(priority: &Priority) -> f64 {
        let base_score = Utc::now().timestamp() as f64;
        match priority {
            Priority::Critical => base_score - 1000000.0,
            Priority::High => base_score - 100000.0,
            Priority::Normal => base_score,
            Priority::Low => base_score + 100000.0,
        }
    }

    /// Clean up old delivered notifications (for maintenance)
    pub async fn cleanup_delivered(&self, older_than_days: i64) -> Result<u64, NotificationError> {
        let mut conn = self.get_conn().await?;
        
        let cutoff = Utc::now() - chrono::Duration::days(older_than_days);
        let cutoff_score = cutoff.timestamp() as f64;
        
        // Get old delivered notification IDs
        let old_ids: Vec<String> = conn
            .zrangebyscore(QUEUE_DELIVERED, 0.0, cutoff_score)
            .await?;
        
        let count = old_ids.len() as u64;
        
        // Remove from delivered queue and delete data
        for id in &old_ids {
            let data_key = format!("{}{}", NOTIFICATION_DATA_PREFIX, id);
            conn.del(&data_key).await?;
        }
        
        if count > 0 {
            conn.zremrangebyscore(QUEUE_DELIVERED, 0.0, cutoff_score).await?;
            info!("Cleaned up {} old delivered notifications", count);
        }
        
        Ok(count)
    }

    /// Requeue stuck notifications (those in processing for too long)
    pub async fn requeue_stuck(&self, stuck_threshold_seconds: i64) -> Result<u64, NotificationError> {
        let mut conn = self.get_conn().await?;
        
        let cutoff = Utc::now() - chrono::Duration::seconds(stuck_threshold_seconds);
        let cutoff_score = cutoff.timestamp() as f64;
        
        // Get stuck notification IDs
        let stuck_ids: Vec<String> = conn
            .zrangebyscore(QUEUE_PROCESSING, 0.0, cutoff_score)
            .await?;
        
        let count = stuck_ids.len() as u64;
        
        for id in &stuck_ids {
            // Get notification data
            let data_key = format!("{}{}", NOTIFICATION_DATA_PREFIX, id);
            let notification_json: Option<String> = conn.get(&data_key).await?;
            
            if let Some(json) = notification_json {
                if let Ok(mut notification) = serde_json::from_str::<Notification>(&json) {
                    // Mark as failed to trigger retry logic
                    notification.mark_failed("Processing timeout - requeued".to_string());
                    let updated_json = serde_json::to_string(&notification)?;
                    conn.set(&data_key, &updated_json).await?;
                }
            }
            
            // Remove from processing
            conn.zrem(QUEUE_PROCESSING, id).await?;
            
            // Add back to pending with retry delay
            let retry_score = (Utc::now().timestamp() + 60) as f64;
            conn.zadd(QUEUE_PENDING, id, retry_score).await?;
        }
        
        if count > 0 {
            warn!("Requeued {} stuck notifications", count);
        }
        
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EmailPayload, NotificationPayload, NotificationType};

    fn create_test_email_notification() -> Notification {
        let payload = NotificationPayload::Email(EmailPayload {
            to: vec!["test@example.com".to_string()],
            cc: None,
            bcc: None,
            subject: "Test".to_string(),
            body_html: None,
            body_text: "Test message".to_string(),
            attachments: None,
        });
        
        Notification::new(
            NotificationType::Email,
            payload,
            Priority::Normal,
            3,
        )
    }

    #[test]
    fn test_priority_score() {
        let critical = NotificationQueue::priority_score(&Priority::Critical);
        let high = NotificationQueue::priority_score(&Priority::High);
        let normal = NotificationQueue::priority_score(&Priority::Normal);
        let low = NotificationQueue::priority_score(&Priority::Low);
        
        assert!(critical < high);
        assert!(high < normal);
        assert!(normal < low);
    }

    #[test]
    fn test_notification_state_transitions() {
        let mut notification = create_test_email_notification();
        
        assert_eq!(notification.status, NotificationStatus::Pending);
        
        notification.mark_processing();
        assert_eq!(notification.status, NotificationStatus::Processing);
        
        notification.mark_delivered();
        assert_eq!(notification.status, NotificationStatus::Delivered);
        
        // Create new notification for failure test
        let mut notification2 = create_test_email_notification();
        notification2.mark_failed("Test error".to_string());
        assert_eq!(notification2.status, NotificationStatus::Failed);
        assert_eq!(notification2.retry_count, 1);
    }

    #[test]
    fn test_max_retries() {
        let mut notification = create_test_email_notification();
        notification.max_retries = 2;
        
        notification.mark_failed("Error 1".to_string());
        assert_eq!(notification.status, NotificationStatus::Failed);
        
        notification.mark_failed("Error 2".to_string());
        assert_eq!(notification.status, NotificationStatus::DeadLetter);
    }

    #[test]
    fn test_retry_delay() {
        let notification = create_test_email_notification();
        
        assert_eq!(notification.retry_delay_seconds(60), 60);
        
        let mut notification2 = create_test_email_notification();
        notification2.retry_count = 2;
        assert_eq!(notification2.retry_delay_seconds(60), 240); // 60 * 2^2
    }
}
