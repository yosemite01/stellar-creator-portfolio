//! Alert management for users.
//!
//! Alerts are owned by the user who created them (identified by the JWT `sub` claim).
//! Update and delete operations enforce ownership: a request is rejected with 403 Forbidden
//! if the authenticated user's `sub` does not match the alert's `user_id`.

use actix_web::{web, HttpMessage, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

use crate::{ApiError, ApiErrorCode, ApiResponse};
use crate::auth::Claims;

// ── Data model ────────────────────────────────────────────────────────────────

/// Severity level of an alert.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

/// A stored alert record.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    /// Unique alert identifier.
    pub id: String,
    /// The `sub` claim of the JWT that created this alert — used for ownership checks.
    pub user_id: String,
    pub title: String,
    pub message: String,
    pub severity: AlertSeverity,
    pub created_at: String,
    /// ISO timestamp set when the alert is acknowledged; `None` if unread.
    pub read_at: Option<String>,
}

/// Request body for creating a new alert.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAlertRequest {
    pub title: String,
    pub message: String,
    pub severity: Option<AlertSeverity>,
}

/// Request body for updating an existing alert.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAlertRequest {
    pub title: Option<String>,
    pub message: Option<String>,
    pub severity: Option<AlertSeverity>,
    /// Pass `true` to mark the alert as read, `false` to clear the read timestamp.
    pub mark_read: Option<bool>,
}

// ── In-memory store (development / testing) ───────────────────────────────────

/// Thread-safe in-memory alert store keyed by alert ID.
pub struct AlertStore {
    pub alerts: Mutex<HashMap<String, Alert>>,
}

impl AlertStore {
    pub fn new() -> Self {
        AlertStore {
            alerts: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AlertStore {
    fn default() -> Self {
        Self::new()
    }
}

// ── Validation helpers ────────────────────────────────────────────────────────

fn validate_create_request(req: &CreateAlertRequest) -> Vec<(String, String)> {
    let mut errors = Vec::new();
    if req.title.trim().is_empty() {
        errors.push(("title".to_string(), "Title is required".to_string()));
    }
    if req.message.trim().is_empty() {
        errors.push(("message".to_string(), "Message is required".to_string()));
    }
    errors
}

fn validate_update_request(req: &UpdateAlertRequest) -> Vec<(String, String)> {
    let mut errors = Vec::new();
    if let Some(ref title) = req.title {
        if title.trim().is_empty() {
            errors.push(("title".to_string(), "Title must not be empty".to_string()));
        }
    }
    if let Some(ref message) = req.message {
        if message.trim().is_empty() {
            errors.push(("message".to_string(), "Message must not be empty".to_string()));
        }
    }
    errors
}

// ── Ownership check ───────────────────────────────────────────────────────────

/// Returns `true` when the authenticated user owns the alert.
///
/// Admins bypass the ownership check so they can manage any alert.
fn is_owner_or_admin(claims: &Claims, alert: &Alert) -> bool {
    claims.role == "admin" || claims.sub == alert.user_id
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// `POST /api/v1/alerts` — create a new alert for the authenticated user.
pub async fn create_alert(
    req: HttpRequest,
    store: web::Data<AlertStore>,
    body: web::Json<CreateAlertRequest>,
) -> HttpResponse {
    let claims = match req.extensions().get::<Claims>().cloned() {
        Some(c) => c,
        None => {
            return HttpResponse::Unauthorized().json(ApiResponse::<()>::err(ApiError::new(
                ApiErrorCode::Unauthorized,
                "Authentication required",
            )));
        }
    };

    let field_errors = validate_create_request(&body);
    if !field_errors.is_empty() {
        let errors = field_errors
            .into_iter()
            .map(|(field, message)| crate::FieldError { field, message })
            .collect();
        return HttpResponse::UnprocessableEntity().json(ApiResponse::<()>::err(
            ApiError::with_field_errors(
                ApiErrorCode::ValidationError,
                "Alert creation failed",
                errors,
            ),
        ));
    }

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let alert = Alert {
        id: id.clone(),
        user_id: claims.sub.clone(),
        title: body.title.trim().to_string(),
        message: body.message.trim().to_string(),
        severity: body.severity.clone().unwrap_or(AlertSeverity::Info),
        created_at: now,
        read_at: None,
    };

    store.alerts.lock().unwrap().insert(id.clone(), alert.clone());

    tracing::info!("Alert {} created by user {}", id, claims.sub);

    HttpResponse::Created().json(ApiResponse::ok(alert, Some("Alert created".to_string())))
}

/// `GET /api/v1/alerts` — list all alerts belonging to the authenticated user.
pub async fn list_alerts(
    req: HttpRequest,
    store: web::Data<AlertStore>,
) -> HttpResponse {
    let claims = match req.extensions().get::<Claims>().cloned() {
        Some(c) => c,
        None => {
            return HttpResponse::Unauthorized().json(ApiResponse::<()>::err(ApiError::new(
                ApiErrorCode::Unauthorized,
                "Authentication required",
            )));
        }
    };

    let alerts: Vec<Alert> = store
        .alerts
        .lock()
        .unwrap()
        .values()
        .filter(|a| a.user_id == claims.sub)
        .cloned()
        .collect();

    HttpResponse::Ok().json(ApiResponse::ok(alerts, None))
}

/// `PATCH /api/v1/alerts/{id}` — update an alert.
///
/// Only the alert owner (or an admin) may update the alert.
/// Returns 403 Forbidden if the authenticated user does not own the alert.
pub async fn update_alert(
    req: HttpRequest,
    store: web::Data<AlertStore>,
    path: web::Path<String>,
    body: web::Json<UpdateAlertRequest>,
) -> HttpResponse {
    let claims = match req.extensions().get::<Claims>().cloned() {
        Some(c) => c,
        None => {
            return HttpResponse::Unauthorized().json(ApiResponse::<()>::err(ApiError::new(
                ApiErrorCode::Unauthorized,
                "Authentication required",
            )));
        }
    };

    let alert_id = path.into_inner();

    let field_errors = validate_update_request(&body);
    if !field_errors.is_empty() {
        let errors = field_errors
            .into_iter()
            .map(|(field, message)| crate::FieldError { field, message })
            .collect();
        return HttpResponse::UnprocessableEntity().json(ApiResponse::<()>::err(
            ApiError::with_field_errors(
                ApiErrorCode::ValidationError,
                "Alert update failed",
                errors,
            ),
        ));
    }

    let mut store_lock = store.alerts.lock().unwrap();

    let alert = match store_lock.get(&alert_id) {
        Some(a) => a.clone(),
        None => {
            return HttpResponse::NotFound().json(ApiResponse::<()>::err(
                ApiError::not_found("Alert"),
            ));
        }
    };

    // ── Ownership check ───────────────────────────────────────────────────────
    if !is_owner_or_admin(&claims, &alert) {
        tracing::warn!(
            "User {} attempted to update alert {} owned by {}",
            claims.sub,
            alert_id,
            alert.user_id
        );
        return HttpResponse::Forbidden().json(ApiResponse::<()>::err(ApiError::new(
            ApiErrorCode::Forbidden,
            "You do not have permission to modify this alert",
        )));
    }

    // Apply partial updates.
    let mut updated = alert;
    if let Some(title) = &body.title {
        updated.title = title.trim().to_string();
    }
    if let Some(message) = &body.message {
        updated.message = message.trim().to_string();
    }
    if let Some(severity) = &body.severity {
        updated.severity = severity.clone();
    }
    if let Some(mark_read) = body.mark_read {
        updated.read_at = if mark_read {
            Some(chrono::Utc::now().to_rfc3339())
        } else {
            None
        };
    }

    store_lock.insert(alert_id.clone(), updated.clone());
    drop(store_lock);

    tracing::info!("Alert {} updated by user {}", alert_id, claims.sub);

    HttpResponse::Ok().json(ApiResponse::ok(updated, Some("Alert updated".to_string())))
}

/// `DELETE /api/v1/alerts/{id}` — delete an alert.
///
/// Only the alert owner (or an admin) may delete the alert.
/// Returns 403 Forbidden if the authenticated user does not own the alert.
pub async fn delete_alert(
    req: HttpRequest,
    store: web::Data<AlertStore>,
    path: web::Path<String>,
) -> HttpResponse {
    let claims = match req.extensions().get::<Claims>().cloned() {
        Some(c) => c,
        None => {
            return HttpResponse::Unauthorized().json(ApiResponse::<()>::err(ApiError::new(
                ApiErrorCode::Unauthorized,
                "Authentication required",
            )));
        }
    };

    let alert_id = path.into_inner();
    let mut store_lock = store.alerts.lock().unwrap();

    let alert = match store_lock.get(&alert_id) {
        Some(a) => a.clone(),
        None => {
            return HttpResponse::NotFound().json(ApiResponse::<()>::err(
                ApiError::not_found("Alert"),
            ));
        }
    };

    // ── Ownership check ───────────────────────────────────────────────────────
    if !is_owner_or_admin(&claims, &alert) {
        tracing::warn!(
            "User {} attempted to delete alert {} owned by {}",
            claims.sub,
            alert_id,
            alert.user_id
        );
        return HttpResponse::Forbidden().json(ApiResponse::<()>::err(ApiError::new(
            ApiErrorCode::Forbidden,
            "You do not have permission to delete this alert",
        )));
    }

    store_lock.remove(&alert_id);
    drop(store_lock);

    tracing::info!("Alert {} deleted by user {}", alert_id, claims.sub);

    HttpResponse::Ok().json(ApiResponse::ok(
        serde_json::json!({ "id": alert_id }),
        Some("Alert deleted".to_string()),
    ))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test as awtest, web, App};
    use crate::auth::{tests::make_token, JwtMiddleware};

    fn build_app(store: web::Data<AlertStore>) -> actix_web::App<
        impl actix_web::dev::ServiceFactory<
            actix_web::dev::ServiceRequest,
            Config = (),
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
            InitError = (),
        >,
    > {
        App::new()
            .app_data(store)
            .service(
                web::scope("/api/v1/alerts")
                    .wrap(JwtMiddleware)
                    .route("", web::post().to(create_alert))
                    .route("", web::get().to(list_alerts))
                    .route("/{id}", web::patch().to(update_alert))
                    .route("/{id}", web::delete().to(delete_alert)),
            )
    }

    // ── create ────────────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn create_alert_returns_201() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;
        let token = make_token("user-1", "creator", 3600);

        let req = awtest::TestRequest::post()
            .uri("/api/v1/alerts")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({
                "title": "Low balance",
                "message": "Your wallet balance is below 10 XLM"
            }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::CREATED);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        assert_eq!(body["success"], true);
        assert_eq!(body["data"]["userId"], "user-1");
        assert_eq!(body["data"]["title"], "Low balance");
    }

    #[actix_web::test]
    async fn create_alert_without_token_returns_401() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let req = awtest::TestRequest::post()
            .uri("/api/v1/alerts")
            .set_json(serde_json::json!({ "title": "t", "message": "m" }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    #[actix_web::test]
    async fn create_alert_empty_title_returns_422() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;
        let token = make_token("user-1", "creator", 3600);

        let req = awtest::TestRequest::post()
            .uri("/api/v1/alerts")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "title": "  ", "message": "msg" }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    // ── update ────────────────────────────────────────────────────────────────

    /// Helper: create an alert as `owner_sub` and return its ID.
    async fn seed_alert(
        app: &impl actix_web::dev::Service<
            actix_web::dev::ServiceRequest,
            Response = actix_web::dev::ServiceResponse,
            Error = actix_web::Error,
        >,
        owner_sub: &str,
    ) -> String {
        let token = make_token(owner_sub, "creator", 3600);
        let req = awtest::TestRequest::post()
            .uri("/api/v1/alerts")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "title": "Seed alert", "message": "Seed message" }))
            .to_request();
        let resp = awtest::call_service(app, req).await;
        let body: serde_json::Value = awtest::read_body_json(resp).await;
        body["data"]["id"].as_str().unwrap().to_string()
    }

    #[actix_web::test]
    async fn owner_can_update_their_alert() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        let token = make_token("user-1", "creator", 3600);

        let req = awtest::TestRequest::patch()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "title": "Updated title" }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        assert_eq!(body["data"]["title"], "Updated title");
    }

    #[actix_web::test]
    async fn other_user_cannot_update_alert_returns_403() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        // Different user attempts to update user-1's alert.
        let token = make_token("user-2", "creator", 3600);

        let req = awtest::TestRequest::patch()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "title": "Hijacked title" }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::FORBIDDEN);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "FORBIDDEN");
    }

    #[actix_web::test]
    async fn admin_can_update_any_alert() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        let admin_token = make_token("admin-user", "admin", 3600);

        let req = awtest::TestRequest::patch()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", admin_token)))
            .set_json(serde_json::json!({ "title": "Admin override" }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);
    }

    #[actix_web::test]
    async fn update_nonexistent_alert_returns_404() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;
        let token = make_token("user-1", "creator", 3600);

        let req = awtest::TestRequest::patch()
            .uri("/api/v1/alerts/does-not-exist")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "title": "x" }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn update_alert_empty_title_returns_422() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        let token = make_token("user-1", "creator", 3600);

        let req = awtest::TestRequest::patch()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "title": "   " }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    // ── delete ────────────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn owner_can_delete_their_alert() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        let token = make_token("user-1", "creator", 3600);

        let req = awtest::TestRequest::delete()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        assert_eq!(body["data"]["id"], id);
    }

    #[actix_web::test]
    async fn other_user_cannot_delete_alert_returns_403() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        let token = make_token("user-2", "creator", 3600);

        let req = awtest::TestRequest::delete()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::FORBIDDEN);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "FORBIDDEN");
    }

    #[actix_web::test]
    async fn admin_can_delete_any_alert() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        let admin_token = make_token("admin-user", "admin", 3600);

        let req = awtest::TestRequest::delete()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", admin_token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);
    }

    #[actix_web::test]
    async fn delete_nonexistent_alert_returns_404() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;
        let token = make_token("user-1", "creator", 3600);

        let req = awtest::TestRequest::delete()
            .uri("/api/v1/alerts/does-not-exist")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::NOT_FOUND);
    }

    #[actix_web::test]
    async fn delete_without_token_returns_401() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let req = awtest::TestRequest::delete()
            .uri("/api/v1/alerts/some-id")
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::UNAUTHORIZED);
    }

    // ── mark-read ─────────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn owner_can_mark_alert_as_read() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        let token = make_token("user-1", "creator", 3600);

        let req = awtest::TestRequest::patch()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "markRead": true }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        assert!(body["data"]["readAt"].is_string());
    }

    #[actix_web::test]
    async fn other_user_cannot_mark_alert_as_read() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        let id = seed_alert(&app, "user-1").await;
        let token = make_token("user-2", "creator", 3600);

        let req = awtest::TestRequest::patch()
            .uri(&format!("/api/v1/alerts/{}", id))
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .set_json(serde_json::json!({ "markRead": true }))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::FORBIDDEN);
    }

    // ── list ──────────────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn list_only_returns_own_alerts() {
        std::env::remove_var("JWT_SECRET");
        let store = web::Data::new(AlertStore::new());
        let app = awtest::init_service(build_app(store)).await;

        // user-1 creates two alerts, user-2 creates one.
        seed_alert(&app, "user-1").await;
        seed_alert(&app, "user-1").await;
        seed_alert(&app, "user-2").await;

        let token = make_token("user-1", "creator", 3600);
        let req = awtest::TestRequest::get()
            .uri("/api/v1/alerts")
            .insert_header(("Authorization", format!("Bearer {}", token)))
            .to_request();

        let resp = awtest::call_service(&app, req).await;
        assert_eq!(resp.status(), actix_web::http::StatusCode::OK);

        let body: serde_json::Value = awtest::read_body_json(resp).await;
        let alerts = body["data"].as_array().unwrap();
        assert_eq!(alerts.len(), 2);
        assert!(alerts.iter().all(|a| a["userId"] == "user-1"));
    }
}
