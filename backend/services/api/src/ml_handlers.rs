//! HTTP handlers that expose ML predictions and real-time payment updates.
//!
//! ## Issue #426 – Real-time success probability updates
//! Previously the success probability was computed once and never included in
//! polling / streaming responses.  This module:
//!
//! 1. Computes the ML-derived success probability on every call to
//!    `payment_status_update` so clients always receive a fresh risk score.
//! 2. Embeds `success_probability` in the `PaymentUpdate` payload returned by
//!    both the polling endpoint (`GET /api/v1/payments/:id/status`) and the
//!    SSE streaming endpoint (`GET /api/v1/payments/:id/stream`).

use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::ml::{PaymentRecord, SimpleMLModel};

// ── Shared state ──────────────────────────────────────────────────────────────

/// Application state injected via `web::Data`.
pub struct MlAppState {
    pub model: Arc<SimpleMLModel>,
}

// ── Request / response types ──────────────────────────────────────────────────

/// Query parameters for the payment status endpoint.
#[derive(Debug, Deserialize)]
pub struct PaymentStatusQuery {
    /// Payment amount (smallest currency unit).
    pub amount: Option<f64>,
    /// Number of prior successful payments by this sender.
    pub sender_history_count: Option<f64>,
    /// Corridor reliability score in [0.0, 1.0].
    pub corridor_reliability: Option<f64>,
}

/// Real-time payment update payload.
///
/// `success_probability` is recomputed on every request so clients always
/// receive the latest ML risk score (fixes issue #426).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentUpdate {
    /// Payment identifier.
    pub payment_id: String,
    /// Current payment status.
    pub status: String,
    /// ML-derived probability that this payment will succeed, in [0.0, 1.0].
    /// Recomputed on every update so the value reflects the current model.
    pub success_probability: f64,
    /// Unix timestamp (seconds) when this update was generated.
    pub updated_at: u64,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn build_record(query: &PaymentStatusQuery) -> PaymentRecord {
    PaymentRecord {
        timestamp_secs: now_secs(),
        amount: query.amount.unwrap_or(500_000.0),
        sender_history_count: query.sender_history_count.unwrap_or(10.0),
        corridor_reliability: query.corridor_reliability.unwrap_or(0.8),
        success: false, // label unused during inference
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// `GET /api/v1/payments/{id}/status`
///
/// Returns the current payment status together with a freshly computed
/// `success_probability` so the client always sees an up-to-date risk score.
pub async fn payment_status_update(
    path: web::Path<String>,
    query: web::Query<PaymentStatusQuery>,
    state: web::Data<MlAppState>,
) -> HttpResponse {
    let payment_id = path.into_inner();
    let record = build_record(&query);
    let probability = state.model.predict_success_probability(&record);

    let update = PaymentUpdate {
        payment_id,
        status: "pending".to_string(),
        success_probability: (probability * 10_000.0).round() / 10_000.0,
        updated_at: now_secs(),
    };

    HttpResponse::Ok().json(update)
}

/// `GET /api/v1/payments/{id}/stream`
///
/// Server-Sent Events stream.  Each event contains a `PaymentUpdate` with a
/// freshly computed `success_probability`.
///
/// The response uses `text/event-stream` so browsers and polling clients can
/// consume it with the EventSource API.
pub async fn payment_stream(
    path: web::Path<String>,
    query: web::Query<PaymentStatusQuery>,
    state: web::Data<MlAppState>,
) -> HttpResponse {
    let payment_id = path.into_inner();
    let record = build_record(&query);
    let probability = state.model.predict_success_probability(&record);

    let update = PaymentUpdate {
        payment_id,
        status: "pending".to_string(),
        success_probability: (probability * 10_000.0).round() / 10_000.0,
        updated_at: now_secs(),
    };

    // Serialise as a single SSE event so the client can parse it with
    // EventSource.  In a production system this would be a long-lived stream;
    // here we emit one event and close to keep the implementation minimal.
    let json = serde_json::to_string(&update).unwrap_or_default();
    let sse_body = format!("data: {}\n\n", json);

    HttpResponse::Ok()
        .content_type("text/event-stream")
        .insert_header(("Cache-Control", "no-cache"))
        .insert_header(("X-Accel-Buffering", "no"))
        .body(sse_body)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test as awtest, App};
    use crate::ml::SimpleMLModel;

    fn make_state() -> web::Data<MlAppState> {
        // Train on a small mixed dataset so predictions are non-trivial
        let records: Vec<PaymentRecord> = (0..40)
            .map(|i| PaymentRecord {
                timestamp_secs: now_secs(),
                amount: 500_000.0,
                sender_history_count: 20.0,
                corridor_reliability: 0.85,
                success: i % 5 != 0,
            })
            .collect();
        web::Data::new(MlAppState {
            model: Arc::new(SimpleMLModel::new(&records)),
        })
    }

    #[actix_web::test]
    async fn status_endpoint_returns_success_probability() {
        let state = make_state();
        let app = awtest::init_service(
            App::new()
                .app_data(state)
                .route(
                    "/api/v1/payments/{id}/status",
                    web::get().to(payment_status_update),
                ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/api/v1/payments/pay-123/status?amount=500000&senderHistoryCount=20&corridorReliability=0.85")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["paymentId"], "pay-123");
        assert!(json["successProbability"].is_number());
        let prob = json["successProbability"].as_f64().unwrap();
        assert!((0.0..=1.0).contains(&prob), "probability out of range: {prob}");
        assert!(json["updatedAt"].as_u64().unwrap() > 0);
    }

    #[actix_web::test]
    async fn status_endpoint_uses_defaults_when_query_absent() {
        let state = make_state();
        let app = awtest::init_service(
            App::new()
                .app_data(state)
                .route(
                    "/api/v1/payments/{id}/status",
                    web::get().to(payment_status_update),
                ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/api/v1/payments/pay-456/status")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body = awtest::read_body(resp).await;
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let prob = json["successProbability"].as_f64().unwrap();
        assert!((0.0..=1.0).contains(&prob));
    }

    #[actix_web::test]
    async fn stream_endpoint_returns_sse_content_type() {
        let state = make_state();
        let app = awtest::init_service(
            App::new()
                .app_data(state)
                .route(
                    "/api/v1/payments/{id}/stream",
                    web::get().to(payment_stream),
                ),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/api/v1/payments/pay-789/stream")
            .to_request();
        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let ct = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(ct.contains("text/event-stream"), "unexpected content-type: {ct}");

        let body = awtest::read_body(resp).await;
        let body_str = std::str::from_utf8(&body).unwrap();
        assert!(body_str.starts_with("data: "), "SSE body should start with 'data: '");

        // Parse the embedded JSON
        let json_str = body_str.trim_start_matches("data: ").trim_end_matches('\n');
        let json: serde_json::Value = serde_json::from_str(json_str).unwrap();
        let prob = json["successProbability"].as_f64().unwrap();
        assert!((0.0..=1.0).contains(&prob));
    }

    #[actix_web::test]
    async fn probability_differs_for_different_inputs() {
        let state = make_state();
        let app = awtest::init_service(
            App::new()
                .app_data(state)
                .route(
                    "/api/v1/payments/{id}/status",
                    web::get().to(payment_status_update),
                ),
        )
        .await;

        let req_good = awtest::TestRequest::get()
            .uri("/api/v1/payments/p1/status?amount=2000000&senderHistoryCount=80&corridorReliability=0.99")
            .to_request();
        let req_bad = awtest::TestRequest::get()
            .uri("/api/v1/payments/p2/status?amount=100&senderHistoryCount=0&corridorReliability=0.01")
            .to_request();

        let resp_good = awtest::call_service(&app, req_good).await;
        let resp_bad = awtest::call_service(&app, req_bad).await;

        let body_good = awtest::read_body(resp_good).await;
        let body_bad = awtest::read_body(resp_bad).await;

        let p_good = serde_json::from_slice::<serde_json::Value>(&body_good).unwrap()
            ["successProbability"]
            .as_f64()
            .unwrap();
        let p_bad = serde_json::from_slice::<serde_json::Value>(&body_bad).unwrap()
            ["successProbability"]
            .as_f64()
            .unwrap();

        assert!(
            p_good > p_bad,
            "good inputs ({p_good}) should yield higher probability than bad inputs ({p_bad})"
        );
    }
}
