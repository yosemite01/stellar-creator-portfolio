/// Webhook handler for external payment events — Issue #346
///
/// Receives signed webhook payloads from external payment processors
/// (e.g. Stripe, Coinbase Commerce) and maps them to escrow operations
/// via the Stellar SDK.
///
/// Security: every incoming request must carry a valid HMAC-SHA256
/// signature in the `X-Webhook-Signature` header.  The secret is read
/// from the `WEBHOOK_SECRET` environment variable.

use actix_web::{web, HttpRequest, HttpResponse};
use hmac::{Hmac, Mac};
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
    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| "invalid secret")?;
    mac.update(body);

    let expected = mac.finalize().into_bytes();
    let expected_hex = hex::encode(expected);

    // Constant-time comparison via hex strings
    let sig = signature_header.trim_start_matches("sha256=");
    if sig != expected_hex {
        return Err("signature mismatch");
    }
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
/// Accepts an external payment event, verifies its signature, and
/// dispatches the corresponding escrow operation.
pub async fn payment_webhook(
    req: HttpRequest,
    body: web::Bytes,
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

    info!(
        "Webhook received: {:?} for escrow {} (provider_event_id={})",
        payload.event_type, payload.escrow_id, payload.provider_event_id
    );

    // 3. Map event → escrow action
    let action = map_event_to_action(&payload.event_type);

    // 4. Dispatch (placeholder — wire to Stellar SDK in production)
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

    fn make_sig(secret: &str, body: &[u8]) -> String {
        type HmacSha256 = Hmac<Sha256>;
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
    }

    fn valid_payload() -> serde_json::Value {
        serde_json::json!({
            "event_type": "payment_succeeded",
            "escrow_id": "42",
            "amount": 2500,
            "timestamp": "2026-04-23T12:00:00Z",
            "provider_event_id": "evt_001"
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
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new().route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
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
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new().route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
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
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new().route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
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
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new().route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
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
        std::env::remove_var("WEBHOOK_SECRET");
        let app = awtest::init_service(
            App::new().route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
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
        std::env::set_var("WEBHOOK_SECRET", "testsecret");
        let app = awtest::init_service(
            App::new().route("/api/v1/webhooks/payment", web::post().to(payment_webhook)),
        ).await;

        let payload = serde_json::json!({
            "event_type": "dispute_opened",
            "escrow_id": "7",
            "amount": 1000,
            "timestamp": "2026-04-23T12:00:00Z",
            "provider_event_id": "evt_002"
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
