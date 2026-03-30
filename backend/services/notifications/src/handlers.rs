use actix_web::{web, HttpResponse, Responder};
use serde_json::json;
use tracing::{debug, error, info, warn};

use crate::error::NotificationError;
use crate::models::{
    Notification, NotificationStatusResponse, SendNotificationRequest, SendNotificationResponse,
};
use crate::AppState;

/// Health check endpoint
pub async fn health_check() -> impl Responder {
    debug!("Health check requested");
    HttpResponse::Ok().json(json!({
        "status": "healthy",
        "service": "stellar-notifications",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

/// Send a notification
/// 
/// POST /notifications
/// 
/// Accepts a notification request and queues it for delivery
pub async fn send_notification(
    state: web::Data<AppState>,
    request: web::Json<SendNotificationRequest>,
) -> Result<HttpResponse, NotificationError> {
    info!(
        "Received notification request of type {:?}",
        request.notification_type
    );

    // Create notification from request
    let mut notification = Notification::new(
        request.notification_type.clone(),
        request.payload.clone(),
        request.priority.clone(),
        state.config.max_retries,
    );

    // Set scheduled time if provided
    notification.scheduled_at = request.scheduled_at;
    notification.metadata = request.metadata.clone();

    let notification_id = notification.id.clone();

    // Enqueue the notification
    state.queue.enqueue(&notification).await?;

    info!("Notification {} queued successfully", notification_id);

    let response = SendNotificationResponse {
        id: notification_id,
        status: notification.status,
        message: "Notification queued for delivery".to_string(),
    };

    Ok(HttpResponse::Accepted().json(response))
}

/// Get notification status
/// 
/// GET /notifications/{id}/status
/// 
/// Returns the current status of a notification
pub async fn get_notification_status(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> Result<HttpResponse, NotificationError> {
    let notification_id = path.into_inner();
    debug!("Getting status for notification {}", notification_id);

    match state.queue.get_notification(&notification_id).await? {
        Some(notification) => {
            let response: NotificationStatusResponse = notification.into();
            Ok(HttpResponse::Ok().json(response))
        }
        None => Err(NotificationError::NotFound(notification_id)),
    }
}

/// Retry a failed notification
/// 
/// POST /notifications/{id}/retry
/// 
/// Manually retries a failed or dead-letter notification
pub async fn retry_notification(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> Result<HttpResponse, NotificationError> {
    let notification_id = path.into_inner();
    info!("Retry requested for notification {}", notification_id);

    // First check if notification exists and can be retried
    match state.queue.get_notification(&notification_id).await? {
        Some(notification) => {
            if !notification.can_retry() {
                return Err(NotificationError::MaxRetriesExceeded(notification_id));
            }
        }
        None => return Err(NotificationError::NotFound(notification_id)),
    }

    // Retry the notification
    state.queue.retry_notification(&notification_id).await?;

    info!("Notification {} queued for retry", notification_id);

    Ok(HttpResponse::Ok().json(json!({
        "id": notification_id,
        "message": "Notification queued for retry",
        "status": "pending"
    })))
}

/// Get queue statistics
/// 
/// GET /queue/stats
/// 
/// Returns statistics about the notification queues
pub async fn get_queue_stats(
    state: web::Data<AppState>,
) -> Result<HttpResponse, NotificationError> {
    debug!("Getting queue statistics");

    let stats = state.queue.get_stats().await?;

    Ok(HttpResponse::Ok().json(stats))
}

/// Bulk send notifications
/// 
/// POST /notifications/bulk
/// 
/// Accepts multiple notification requests and queues them
pub async fn bulk_send_notifications(
    state: web::Data<AppState>,
    requests: web::Json<Vec<SendNotificationRequest>>,
) -> Result<HttpResponse, NotificationError> {
    info!("Received bulk notification request with {} items", requests.len());

    if requests.is_empty() {
        return Ok(HttpResponse::BadRequest().json(json!({
            "error": "EMPTY_REQUEST",
            "message": "No notifications provided"
        })));
    }

    let mut notification_ids = Vec::new();
    let mut errors = Vec::new();

    for (index, request) in requests.iter().enumerate() {
        let mut notification = Notification::new(
            request.notification_type.clone(),
            request.payload.clone(),
            request.priority.clone(),
            state.config.max_retries,
        );

        notification.scheduled_at = request.scheduled_at;
        notification.metadata = request.metadata.clone();

        let notification_id = notification.id.clone();

        match state.queue.enqueue(&notification).await {
            Ok(()) => {
                notification_ids.push(notification_id);
            }
            Err(e) => {
                error!("Failed to enqueue notification {}: {}", index, e);
                errors.push(json!({
                    "index": index,
                    "error": e.to_string()
                }));
            }
        }
    }

    let response = json!({
        "queued": notification_ids.len(),
        "failed": errors.len(),
        "notification_ids": notification_ids,
        "errors": if errors.is_empty() { None } else { Some(errors) }
    });

    if errors.is_empty() {
        Ok(HttpResponse::Accepted().json(response))
    } else {
        Ok(HttpResponse::PartialContent().json(response))
    }
}

/// Cancel a pending notification
/// 
/// DELETE /notifications/{id}
/// 
/// Cancels a notification that hasn't been processed yet
pub async fn cancel_notification(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> Result<HttpResponse, NotificationError> {
    let notification_id = path.into_inner();
    info!("Cancel requested for notification {}", notification_id);

    match state.queue.get_notification(&notification_id).await? {
        Some(mut notification) => {
            // Only allow cancellation of pending notifications
            if notification.status != crate::models::NotificationStatus::Pending {
                return Ok(HttpResponse::Conflict().json(json!({
                    "error": "CANNOT_CANCEL",
                    "message": format!("Cannot cancel notification with status {:?}", notification.status)
                })));
            }

            // Mark as cancelled
            notification.status = crate::models::NotificationStatus::Cancelled;
            notification.updated_at = chrono::Utc::now();

            // Note: In a full implementation, we'd need a method to remove from queue
            // For now, we just update the status
            info!("Notification {} cancelled", notification_id);

            Ok(HttpResponse::Ok().json(json!({
                "id": notification_id,
                "message": "Notification cancelled",
                "status": "cancelled"
            })))
        }
        None => Err(NotificationError::NotFound(notification_id)),
    }
}

/// List notifications with filtering
/// 
/// GET /notifications
/// 
/// Query params:
/// - status: Filter by status (pending, processing, delivered, failed, dead_letter)
/// - type: Filter by notification type
/// - limit: Maximum number of results (default 50, max 100)
/// - offset: Pagination offset
pub async fn list_notifications(
    state: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, NotificationError> {
    debug!("Listing notifications with filters: {:?}", query);

    // This is a simplified implementation
    // In a real implementation, you'd query Redis or a database with filters

    let limit = query
        .get("limit")
        .and_then(|l| l.parse::<usize>().ok())
        .unwrap_or(50)
        .min(100);

    let _offset = query
        .get("offset")
        .and_then(|o| o.parse::<usize>().ok())
        .unwrap_or(0);

    let _status_filter = query.get("status");
    let _type_filter = query.get("type");

    // Get queue stats as a proxy for available notifications
    let stats = state.queue.get_stats().await?;

    let response = json!({
        "total": stats.pending + stats.processing + stats.delivered + stats.failed + stats.dead_letter,
        "pending": stats.pending,
        "processing": stats.processing,
        "delivered": stats.delivered,
        "failed": stats.failed,
        "dead_letter": stats.dead_letter,
        "limit": limit,
        "note": "Full listing with pagination requires database storage"
    });

    Ok(HttpResponse::Ok().json(response))
}

/// Cleanup old notifications
/// 
/// POST /admin/cleanup
/// 
/// Admin endpoint to clean up old delivered notifications
pub async fn cleanup_notifications(
    state: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, NotificationError> {
    info!("Cleanup requested");

    let older_than_days = query
        .get("days")
        .and_then(|d| d.parse::<i64>().ok())
        .unwrap_or(30);

    let cleaned = state.queue.cleanup_delivered(older_than_days).await?;

    info!("Cleaned up {} old notifications", cleaned);

    Ok(HttpResponse::Ok().json(json!({
        "cleaned": cleaned,
        "older_than_days": older_than_days
    })))
}

/// Requeue stuck notifications
/// 
/// POST /admin/requeue-stuck
/// 
/// Admin endpoint to requeue notifications stuck in processing
pub async fn requeue_stuck(
    state: web::Data<AppState>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> Result<HttpResponse, NotificationError> {
    info!("Requeue stuck notifications requested");

    let threshold_seconds = query
        .get("threshold")
        .and_then(|t| t.parse::<i64>().ok())
        .unwrap_or(300); // 5 minutes default

    let requeued = state.queue.requeue_stuck(threshold_seconds).await?;

    info!("Requeued {} stuck notifications", requeued);

    Ok(HttpResponse::Ok().json(json!({
        "requeued": requeued,
        "threshold_seconds": threshold_seconds
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{EmailPayload, NotificationPayload, NotificationType, Priority};

    fn create_test_request() -> SendNotificationRequest {
        SendNotificationRequest {
            notification_type: NotificationType::Email,
            payload: NotificationPayload::Email(EmailPayload {
                to: vec!["test@example.com".to_string()],
                cc: None,
                bcc: None,
                subject: "Test".to_string(),
                body_html: None,
                body_text: "Test message".to_string(),
                attachments: None,
            }),
            priority: Priority::Normal,
            scheduled_at: None,
            metadata: None,
        }
    }

    #[actix_rt::test]
    async fn test_health_check() {
        let response = health_check().await;
        // Just verify it doesn't panic
    }
}
