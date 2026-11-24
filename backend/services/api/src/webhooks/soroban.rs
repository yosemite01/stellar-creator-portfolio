/// Soroban event webhook registry and delivery
///
/// Allows external consumers to register HTTPS endpoints that receive
/// platform events (bounty, escrow, governance) as they are emitted by
/// the Soroban contracts indexed by the event indexer.
use actix_web::{web, HttpMessage, HttpRequest, HttpResponse};
use deadpool_redis::{redis::AsyncCommands, Pool};
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{ApiResponse, auth::Claims};

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
    pub owner: String,
    pub url: String,
    pub events: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WebhookPayload {
    pub event: String,
    pub data: serde_json::Value,
}

const REDIS_KEY: &str = "webhooks:registry";

// ── Validation ────────────────────────────────────────────────────────────────

fn is_safe_webhook_url(url_str: &str) -> Result<(), String> {
    let parsed_url = reqwest::Url::parse(url_str)
        .map_err(|_| "Invalid URL format".to_string())?;

    if parsed_url.scheme() != "https" {
        return Err("Webhook URL must use HTTPS scheme".to_string());
    }

    let host_str = parsed_url
        .host_str()
        .ok_or_else(|| "URL must have a valid host".to_string())?;

    if is_private_or_reserved_host(host_str) {
        return Err("Webhook URL cannot point to private, loopback, or reserved addresses".to_string());
    }

    Ok(())
}

fn is_private_or_reserved_host(host: &str) -> bool {
    if host == "localhost" {
        return true;
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || ipv4_is_reserved(&v4)
                    || v4.is_unspecified()
            }
            IpAddr::V6(v6) => {
                v6.is_loopback()
                    || ipv6_is_unique_local(&v6)
                    || ipv6_is_unicast_link_local(&v6)
                    || v6.is_unspecified()
            }
        };
    }

    false
}

/// `Ipv4Addr::is_reserved` (IANA "reserved for future use", `240.0.0.0/4`,
/// excluding the broadcast address) — stable equivalent. The corresponding
/// `std` method is still nightly-only (the `ip` feature).
fn ipv4_is_reserved(v4: &std::net::Ipv4Addr) -> bool {
    v4.octets()[0] & 0xf0 == 240 && !v4.is_broadcast()
}

/// `Ipv6Addr::is_private` (unique local, `fc00::/7`) — stable equivalent.
/// The corresponding `std` method is still nightly-only (the `ip` feature).
fn ipv6_is_unique_local(v6: &std::net::Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xfe00) == 0xfc00
}

/// `Ipv6Addr::is_link_local` (unicast, `fe80::/10`) — stable equivalent.
/// The corresponding `std` method is still nightly-only (the `ip` feature).
fn ipv6_is_unicast_link_local(v6: &std::net::Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xffc0) == 0xfe80
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Register a new webhook
#[utoipa::path(
    post, path = "/api/webhooks",
    request_body = WebhookRegistration,
    responses(
        (status = 201, description = "Webhook registered"),
        (status = 400, description = "Invalid request"),
        (status = 401, description = "Unauthorized"),
    ),
    tag = "webhooks"
)]
pub async fn register_webhook(
    redis: web::Data<Pool>,
    req: HttpRequest,
    body: web::Json<WebhookRegistration>,
) -> HttpResponse {
    let claims = match req.extensions().get::<Claims>() {
        Some(c) => c.clone(),
        None => return HttpResponse::Unauthorized().json(serde_json::json!({
            "success": false,
            "error": "Unauthorized"
        })),
    };

    if body.url.is_empty() || body.events.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "success": false,
            "error": "url and events are required"
        }));
    }

    if let Err(e) = is_safe_webhook_url(&body.url) {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "success": false,
            "error": e
        }));
    }

    let webhook = Webhook {
        id: Uuid::new_v4().to_string(),
        owner: claims.sub.clone(),
        url: body.url.clone(),
        events: body.events.clone(),
        secret: body.secret.clone(),
    };

    let serialized = match serde_json::to_string(&webhook) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to serialize webhook {}: {}", webhook.id, e);
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "success": false,
                "error": "Failed to register webhook"
            }));
        }
    };

    if let Ok(mut conn) = redis.get().await {
        let _: () = conn.hset(REDIS_KEY, &webhook.id, serialized).await.unwrap_or(());
    }

    HttpResponse::Created().json(ApiResponse::ok(
        serde_json::json!({ "id": webhook.id, "url": webhook.url, "events": webhook.events }),
        Some("Webhook registered".to_string()),
    ))
}

/// List all registered webhooks
#[utoipa::path(
    get, path = "/api/webhooks",
    responses(
        (status = 200, description = "List of webhooks"),
        (status = 401, description = "Unauthorized"),
    ),
    tag = "webhooks"
)]
pub async fn list_webhooks(
    redis: web::Data<Pool>,
    req: HttpRequest,
) -> HttpResponse {
    let claims = match req.extensions().get::<Claims>() {
        Some(c) => c.clone(),
        None => return HttpResponse::Unauthorized().json(serde_json::json!({
            "success": false,
            "error": "Unauthorized"
        })),
    };

    let all_webhooks = load_all(&redis).await;
    let user_webhooks: Vec<_> = all_webhooks
        .into_iter()
        .filter(|w| w.owner == claims.sub)
        .collect();

    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({ "webhooks": user_webhooks }),
        None::<String>,
    ))
}

/// Delete a webhook by ID
#[utoipa::path(
    delete, path = "/api/webhooks/{id}",
    params(("id" = String, Path, description = "Webhook ID")),
    responses(
        (status = 200, description = "Webhook deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — not webhook owner"),
        (status = 404, description = "Not found"),
    ),
    tag = "webhooks"
)]
pub async fn delete_webhook(
    redis: web::Data<Pool>,
    req: HttpRequest,
    path: web::Path<String>,
) -> HttpResponse {
    let claims = match req.extensions().get::<Claims>() {
        Some(c) => c.clone(),
        None => return HttpResponse::Unauthorized().json(serde_json::json!({
            "success": false,
            "error": "Unauthorized"
        })),
    };

    let id = path.into_inner();
    let Ok(mut conn) = redis.get().await else {
        return HttpResponse::InternalServerError().json(serde_json::json!({
            "success": false,
            "error": "Database error"
        }));
    };

    let webhook_json: Option<String> = conn.hget(REDIS_KEY, &id).await.unwrap_or(None);
    let webhook = match webhook_json.and_then(|j| serde_json::from_str(&j).ok()) {
        Some(w) => w,
        None => return HttpResponse::NotFound().json(serde_json::json!({
            "success": false,
            "error": "Webhook not found"
        })),
    };

    let webhook: Webhook = webhook;
    if webhook.owner != claims.sub {
        return HttpResponse::Forbidden().json(serde_json::json!({
            "success": false,
            "error": "Not webhook owner"
        }));
    }

    let deleted: i64 = conn.hdel(REDIS_KEY, &id).await.unwrap_or(0);
    if deleted == 0 {
        return HttpResponse::NotFound().json(serde_json::json!({
            "success": false,
            "error": "Webhook not found"
        }));
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
        let secret = wh.secret.clone();

        tokio::spawn(async move {
            let payload_bytes = match serde_json::to_vec(&payload) {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!("Failed to serialize webhook payload: {}", e);
                    return;
                }
            };

            let mut request = client.post(&url).json(&payload);

            if let Some(sec) = secret {
                type HmacSha256 = Hmac<Sha256>;
                let mut mac = match HmacSha256::new_from_slice(sec.as_bytes()) {
                    Ok(mac) => mac,
                    Err(_) => {
                        tracing::warn!("Invalid HMAC secret for webhook");
                        return;
                    }
                };
                mac.update(&payload_bytes);
                let signature = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));
                request = request.header("X-Webhook-Signature", signature);
            }

            if let Err(e) = request.send().await {
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
