/// Stripe (and Coinbase Commerce) payment webhook handler — Issue #346
///
/// Receives signed webhook payloads from external payment processors and maps
/// them to escrow operations via the Stellar SDK.
///
/// Security: every incoming request must carry a valid HMAC-SHA256 signature
/// in the `X-Webhook-Signature` header.  The secret is read from the
/// `WEBHOOK_SECRET` environment variable.
use actix_web::{web, HttpRequest, HttpResponse};
use deadpool_redis::{redis::AsyncCommands, Pool};
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};
use tracing::{info, warn, error};

use crate::{ApiResponse, ApiError, ApiErrorCode};

// ── Payload types ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WebhookEventType {
    PaymentSucceeded,
    PaymentFailed,
    PaymentRefunded,
    DisputeOpened,
    DisputeResolved,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct WebhookPayload {
    pub event_type: WebhookEventType,
    /// Escrow ID on the Stellar contract to act upon.
    pub escrow_id: String,
    /// Amount in the token's smallest unit.
    pub amount: i64,
    /// ISO-8601 timestamp from the external provider.
    pub timestamp: String,
    /// Provider-assigned event ID for idempotency.
    pub provider_event_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct WebhookAck {
    pub received: bool,
    pub escrow_id: String,
    pub action_taken: String,
}

// ── Signature verification ────────────────────────────────────────────────────

/// Verify the HMAC-SHA256 signature supplied in `X-Webhook-Signature`.
/// Returns `Ok(())` when valid, `Err(reason)` otherwise.
pub fn verify_signature(secret: &str, body: &[u8], signature_header: &str) -> Result<(), &'static str> {
    use subtle::ConstantTimeEq;
    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| "invalid secret")?;
    mac.update(body);

    let expected_mac = mac.finalize().into_bytes();
    let sig = signature_header.trim_start_matches("sha256=");

    let provided_bytes = hex::decode(sig).map_err(|_| "invalid hex in signature")?;

    if expected_mac.ct_eq(&provided_bytes[..]).unwrap_u8() == 0 {
        return Err("signature mismatch");
    }
    Ok(())
}

// ── Idempotency ───────────────────────────────────────────────────────────────

const PROCESSED_EVENTS_PREFIX: &str = "webhook:processed:";
const PROCESSED_EVENTS_TTL: u64 = 86400; // 24 hours

/// Check if an event has already been processed (idempotency check).
/// Returns `Ok(false)` if new, `Ok(true)` if duplicate, `Err` on Redis error.
async fn is_event_duplicate(redis: &Pool, event_id: &str) -> Result<bool, String> {
    let Ok(mut conn) = redis.get().await else {
        return Err("Redis connection failed".to_string());
    };
    let key = format!("{}{}", PROCESSED_EVENTS_PREFIX, event_id);
    let exists: bool = conn.exists(&key).await.unwrap_or(false);
    Ok(exists)
}

/// Mark an event as processed with a TTL.
async fn mark_event_processed(redis: &Pool, event_id: &str) -> Result<(), String> {
    let Ok(mut conn) = redis.get().await else {
        return Err("Redis connection failed".to_string());
    };
    let key = format!("{}{}", PROCESSED_EVENTS_PREFIX, event_id);
    let _: () = conn.set_ex(&key, "1", PROCESSED_EVENTS_TTL).await
        .map_err(|e| format!("Failed to mark event processed: {}", e))?;
    Ok(())
}

// ── Action mapping ────────────────────────────────────────────────────────────

/// Map an incoming webhook event to a human-readable escrow action label.
/// In production this would invoke the Stellar SDK to call the contract.
pub fn map_event_to_action(event_type: &WebhookEventType) -> &'static str {
    match event_type {
        WebhookEventType::PaymentSucceeded => "release_escrow",
        WebhookEventType::PaymentFailed    => "refund_escrow",
        WebhookEventType::PaymentRefunded  => "refund_escrow",
        WebhookEventType::DisputeOpened    => "dispute_escrow",
        WebhookEventType::DisputeResolved  => "resolve_dispute",
    }
}

// ── Handler ───────────────────────────────────────────────────────────────────

/// POST /api/v1/webhooks/payment
///
/// Accepts an external payment event, verifies its signature, checks for duplicates,
/// and dispatches the corresponding escrow operation.
pub async fn payment_webhook(
    req: HttpRequest,
    body: web::Bytes,
    redis: web::Data<Pool>,
) -> HttpResponse {
    let secret = std::env::var("WEBHOOK_SECRET").unwrap_or_default();

    // 1. Verify signature
    let sig_header = req
        .headers()
        .get("X-Webhook-Signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if secret.is_empty() {
        warn!("WEBHOOK_SECRET not set — rejecting all webhook requests");
        return HttpResponse::Unauthorized()
            .json(ApiResponse::<()>::err(ApiError::new(
                ApiErrorCode::Unauthorized,
                "Webhook secret not configured",
            )));
    }

    if let Err(reason) = verify_signature(&secret, &body, sig_header) {
        warn!("Webhook signature verification failed: {}", reason);
        return HttpResponse::Unauthorized()
            .json(ApiResponse::<()>::err(ApiError::new(
                ApiErrorCode::Unauthorized,
                "Invalid webhook signature",
            )));
    }

    // 2. Parse payload
    let payload: WebhookPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to parse webhook payload: {}", e);
            return HttpResponse::BadRequest()
                .json(ApiResponse::<()>::err(ApiError::new(
                    ApiErrorCode::BadRequest,
                    "Invalid webhook payload",
                )));
        }
    };

    // 3. Check idempotency (avoid reprocessing)
    match is_event_duplicate(&redis, &payload.provider_event_id).await {
        Ok(true) => {
            info!(
                "Duplicate webhook received: {:?} for escrow {} (provider_event_id={})",
                payload.event_type, payload.escrow_id, payload.provider_event_id
            );
            let ack = WebhookAck {
                received: true,
                escrow_id: payload.escrow_id.clone(),
                action_taken: "duplicate".to_string(),
            };
            return HttpResponse::Ok().json(ApiResponse::ok(ack, None));
        }
        Ok(false) => {
            if let Err(e) = mark_event_processed(&redis, &payload.provider_event_id).await {
                warn!("Failed to mark event as processed: {}", e);
            }
        }
        Err(e) => {
            warn!("Idempotency check failed: {}", e);
            // Continue processing — don't fail on Redis errors
        }
    }

    info!(
        "Webhook received: {:?} for escrow {} (provider_event_id={})",
        payload.event_type, payload.escrow_id, payload.provider_event_id
    );

    // 4. Map event → escrow action
    let action = map_event_to_action(&payload.event_type);

    // 5. Dispatch (placeholder — wire to Stellar SDK in production)
    info!("Dispatching action '{}' for escrow {}", action, payload.escrow_id);

    let ack = WebhookAck {
        received: true,
        escrow_id: payload.escrow_id.clone(),
        action_taken: action.to_string(),
    };

    HttpResponse::Ok().json(ApiResponse::ok(ack, None))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
pub mod tests {
    use super::*;
    use actix_web::{test as awtest, web, App};
    use std::sync::Mutex;

    // `cargo test` runs test functions on multiple threads by default, but
    // `std::env::set_var`/`remove_var` mutate process-global state — two of
    // these tests running concurrently can see each other's WEBHOOK_SECRET
    // briefly unset. Serialize just the tests that touch it.
    lazy_static::lazy_static! {
        static ref WEBHOOK_SECRET_ENV_LOCK: Mutex<()> = Mutex::new(());
    }

    /// `payment_webhook` extracts `web::Data<Pool>`; without registering one,
    /// actix rejects the request before the handler body runs at all (every
    /// test would see 500s regardless of what it's actually exercising).
    fn test_redis_pool() -> Pool {
        deadpool_redis::Config::from_url("redis://127.0.0.1:6379/")
            .create_pool(Some(deadpool_redis::Runtime::Tokio1))
            .expect("failed to create test redis pool")
    }

    fn make_sig(secret: &str, body: &[u8]) -> String {
        type HmacSha256 = Hmac<Sha256>;
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
    }

    /// Unique per call so repeated test runs against a real (non-flushed)
    /// Redis instance don't get short-circuited by the idempotency check.
    fn unique_event_id() -> String {
        format!("evt_{}", uuid::Uuid::new_v4())
    }

    fn valid_payload() -> serde_json::Value {
        serde_json::json!({
            "event_type": "payment_succeeded",
            "escrow_id": "42",
            "amount": 2500,
            "timestamp": "2026-04-23T12:00:00Z",
            "provider_event_id": unique_event_id()
        })
    }

    // ── verify_signature ──────────────────────────────────────────────────────

    #[test]
    fn valid_signature_passes() {
        let body = b"hello";
        let sig = make_sig("mysecret", body);
        assert!(verify_signature("mysecret", body, &sig).is_ok());
    }

    #[test]
    fn wrong_secret_fails() {
        let body = b"hello";
        let sig = make_sig("mysecret", body);
        assert!(verify_signature("wrongsecret", body, &sig).is_err());
    }

    #[test]
    fn tampered_body_fails() {
        let sig = make_sig("mysecret", b"original");
        assert!(verify_signature("mysecret", b"tampered", &sig).is_err());
    }

    #[test]
    fn empty_signature_fails() {
        assert!(verify_signature("mysecret", b"body", "").is_err());
    }

    #[test]
    fn signature_with_sha256_prefix_is_accepted() {
        let body = b"data";
        let sig = make_sig("secret", body);
        assert!(verify_signature("secret", body, &sig).is_ok());
    }

    // ── map_event_to_action ───────────────────────────────────────────────────

    #[test]
    fn payment_succeeded_maps_to_release() {
        assert_eq!(map_event_to_action(&WebhookEventType::PaymentSucceeded), "release_escrow");
    }

    #[test]
    fn payment_failed_maps_to_refund() {
        assert_eq!(map_event_to_action(&WebhookEventType::PaymentFailed), "refund_escrow");
    }

    #[test]
    fn payment_refunded_maps_to_refund() {
        assert_eq!(map_event_to_action(&WebhookEventType::PaymentRefunded), "refund_escrow");
    }

    #[test]
    fn dispute_opened_maps_to_dispute() {
        assert_eq!(map_event_to_action(&WebhookEventType::DisputeOpened), "dispute_escrow");
    }

    #[test]
    fn dispute_resolved_maps_to_resolve() {
        assert_eq!(map_event_to_action(&WebhookEventType::DisputeResolved), "resolve_dispute");
    }

    // ── HTTP handler ──────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn valid_webhook_returns_200_with_ack() {
        let _guard = WEBHOOK_SECRET_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_redis_pool()))
                .route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
        ).await;

        let body = serde_json::to_vec(&valid_payload()).unwrap();
        let sig = make_sig("testsecret", &body);

        let req = awtest::TestRequest::post()
            .uri("/api/v1/webhooks/payment")
            .insert_header(("X-Webhook-Signature", sig))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(body)
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let bytes = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"]["received"], true);
        assert_eq!(json["data"]["escrow_id"], "42");
        assert_eq!(json["data"]["action_taken"], "release_escrow");

        std::env::remove_var("WEBHOOK_SECRET");
    }

    #[actix_web::test]
    async fn missing_signature_returns_401() {
        let _guard = WEBHOOK_SECRET_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_redis_pool()))
                .route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
        ).await;

        let body = serde_json::to_vec(&valid_payload()).unwrap();
        let req = awtest::TestRequest::post()
            .uri("/api/v1/webhooks/payment")
            .insert_header(("Content-Type", "application/json"))
            .set_payload(body)
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
        std::env::remove_var("WEBHOOK_SECRET");
    }

    #[actix_web::test]
    async fn wrong_signature_returns_401() {
        let _guard = WEBHOOK_SECRET_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_redis_pool()))
                .route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
        ).await;

        let body = serde_json::to_vec(&valid_payload()).unwrap();
        let req = awtest::TestRequest::post()
            .uri("/api/v1/webhooks/payment")
            .insert_header(("X-Webhook-Signature", "sha256=badsignature"))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(body)
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
        std::env::remove_var("WEBHOOK_SECRET");
    }

    #[actix_web::test]
    async fn invalid_json_returns_400() {
        let _guard = WEBHOOK_SECRET_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_redis_pool()))
                .route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
        ).await;

        let body = b"not-json";
        let sig = make_sig("testsecret", body);
        let req = awtest::TestRequest::post()
            .uri("/api/v1/webhooks/payment")
            .insert_header(("X-Webhook-Signature", sig))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(body.to_vec())
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::BAD_REQUEST);
        std::env::remove_var("WEBHOOK_SECRET");
    }

    #[actix_web::test]
    async fn unconfigured_secret_returns_401() {
        let _guard = WEBHOOK_SECRET_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::remove_var("WEBHOOK_SECRET");
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_redis_pool()))
                .route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
        ).await;

        let body = serde_json::to_vec(&valid_payload()).unwrap();
        let req = awtest::TestRequest::post()
            .uri("/api/v1/webhooks/payment")
            .insert_header(("X-Webhook-Signature", "sha256=anything"))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(body)
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn dispute_event_maps_correctly() {
        let _guard = WEBHOOK_SECRET_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new()
                .app_data(web::Data::new(test_redis_pool()))
                .route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
        ).await;

        let payload = serde_json::json!({
            "event_type": "dispute_opened",
            "escrow_id": "7",
            "amount": 1000,
            "timestamp": "2026-04-23T12:00:00Z",
            "provider_event_id": unique_event_id()
        });
        let body = serde_json::to_vec(&payload).unwrap();
        let sig = make_sig("testsecret", &body);

        let req = awtest::TestRequest::post()
            .uri("/api/v1/webhooks/payment")
            .insert_header(("X-Webhook-Signature", sig))
            .insert_header(("Content-Type", "application/json"))
            .set_payload(body)
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);
        let bytes = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["data"]["action_taken"], "dispute_escrow");
        std::env::remove_var("WEBHOOK_SECRET");
    }
}
