use actix_web::{web, HttpResponse};
use deadpool_redis::{redis::AsyncCommands, Pool};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::ApiResponse;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize, Debug, ToSchema)]
pub struct WebhookRegistration {
    /// Public HTTPS URL to deliver events to
    pub url: String,
    /// Events to subscribe to, e.g. ["bounty.created", "application.submitted", "escrow.released"]
    pub events: Vec<String>,
    /// Optional secret for HMAC signature header
    pub secret: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, ToSchema)]
pub struct Webhook {
    pub id: String,
    pub url: String,
    pub events: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WebhookPayload {
    pub event: String,
    pub data: serde_json::Value,
}

const REDIS_KEY: &str = "webhooks:registry";

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Register a new webhook
#[utoipa::path(
    post, path = "/api/webhooks",
    request_body = WebhookRegistration,
    responses(
        (status = 201, description = "Webhook registered"),
        (status = 400, description = "Invalid request"),
    ),
    tag = "webhooks"
)]
pub async fn register_webhook(
    redis: web::Data<Pool>,
    body: web::Json<WebhookRegistration>,
) -> HttpResponse {
    if body.url.is_empty() || body.events.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "success": false,
            "error": "url and events are required"
        }));
    }

    let webhook = Webhook {
        id: Uuid::new_v4().to_string(),
        url: body.url.clone(),
        events: body.events.clone(),
    };

    if let Ok(mut conn) = redis.get().await {
        let _: () = conn
            .hset(REDIS_KEY, &webhook.id, serde_json::to_string(&webhook).unwrap())
            .await
            .unwrap_or(());
    }

    HttpResponse::Created().json(ApiResponse::ok(
        serde_json::json!({ "id": webhook.id, "url": webhook.url, "events": webhook.events }),
        Some("Webhook registered".to_string()),
    ))
}

/// List all registered webhooks
#[utoipa::path(
    get, path = "/api/webhooks",
    responses((status = 200, description = "List of webhooks")),
    tag = "webhooks"
)]
pub async fn list_webhooks(redis: web::Data<Pool>) -> HttpResponse {
    let webhooks = load_all(&redis).await;
    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({ "webhooks": webhooks }),
        None::<String>,
    ))
}

/// Delete a webhook by ID
#[utoipa::path(
    delete, path = "/api/webhooks/{id}",
    params(("id" = String, Path, description = "Webhook ID")),
    responses(
        (status = 200, description = "Webhook deleted"),
        (status = 404, description = "Not found"),
    ),
    tag = "webhooks"
)]
pub async fn delete_webhook(redis: web::Data<Pool>, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    if let Ok(mut conn) = redis.get().await {
        let deleted: i64 = conn.hdel(REDIS_KEY, &id).await.unwrap_or(0);
        if deleted == 0 {
            return HttpResponse::NotFound().json(serde_json::json!({
                "success": false,
                "error": "Webhook not found"
            }));
        }
    }
    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({ "id": id }),
        Some("Webhook deleted".to_string()),
    ))
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/// Fire-and-forget delivery to all webhooks subscribed to `event`.
pub async fn trigger_webhooks(redis: &Pool, event: &str, data: serde_json::Value) {
    let webhooks = load_all(redis).await;
    let client = reqwest::Client::new();
    let payload = WebhookPayload { event: event.to_string(), data };

    for wh in webhooks.into_iter().filter(|w| w.events.iter().any(|e| e == event)) {
        let client = client.clone();
        let payload = payload.clone();
        let url = wh.url.clone();
        tokio::spawn(async move {
            if let Err(e) = client.post(&url).json(&payload).send().await {
                tracing::warn!("Webhook delivery failed to {}: {}", url, e);
            }
        });
    }
}

async fn load_all(redis: &Pool) -> Vec<Webhook> {
    let Ok(mut conn) = redis.get().await else {
        return vec![];
    };
    let map: std::collections::HashMap<String, String> =
        conn.hgetall(REDIS_KEY).await.unwrap_or_default();
    map.values().filter_map(|v| serde_json::from_str(v).ok()).collect()
}
