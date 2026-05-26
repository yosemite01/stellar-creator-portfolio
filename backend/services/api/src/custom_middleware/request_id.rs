use actix_web::{
    dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform},
    Error, HttpMessage,
};
use futures::future::LocalBoxFuture;
use std::future::{ready, Ready};
use std::task::{Context, Poll};
use tracing::Span;
use uuid::Uuid;

/// Header name for request ID
pub const REQUEST_ID_HEADER: &str = "X-Request-ID";

/// Middleware that generates and propagates request IDs
pub struct RequestId;

impl<S, B> Transform<S, ServiceRequest> for RequestId
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type InitError = ();
    type Transform = RequestIdMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(RequestIdMiddleware { service }))
    }
}

pub struct RequestIdMiddleware<S> {
    service: S,
}

impl<S, B> Service<ServiceRequest> for RequestIdMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        // Extract or generate request ID
        let request_id = req
            .headers()
            .get(REQUEST_ID_HEADER)
            .and_then(|h| h.to_str().ok())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        // Store request ID in request extensions for handler access
        req.extensions_mut().insert(RequestIdExtension(request_id.clone()));

        // Create a tracing span with the request ID
        let span = tracing::info_span!(
            "request",
            request_id = %request_id,
            method = %req.method(),
            path = %req.path(),
        );

        let fut = self.service.call(req);

        Box::pin(async move {
            let _enter = span.enter();
            
            tracing::info!("Processing request");
            
            let mut res = fut.await?;
            
            // Add request ID to response headers
            res.headers_mut().insert(
                actix_web::http::header::HeaderName::from_static("x-request-id"),
                actix_web::http::header::HeaderValue::from_str(&request_id)
                    .unwrap_or_else(|_| actix_web::http::header::HeaderValue::from_static("invalid")),
            );
            
            tracing::info!("Request completed");
            
            Ok(res)
        })
    }
}

/// Extension type to store request ID in request extensions
#[derive(Clone, Debug)]
pub struct RequestIdExtension(pub String);

/// Helper function to extract request ID from request extensions
pub fn get_request_id(req: &actix_web::HttpRequest) -> Option<String> {
    req.extensions().get::<RequestIdExtension>().map(|ext| ext.0.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, web, App, HttpResponse};

    async fn test_handler(req: actix_web::HttpRequest) -> HttpResponse {
        let request_id = get_request_id(&req).unwrap_or_else(|| "none".to_string());
        HttpResponse::Ok().body(request_id)
    }

    #[actix_web::test]
    async fn test_generates_request_id() {
        let app = test::init_service(
            App::new()
                .wrap(RequestId)
                .route("/test", web::get().to(test_handler))
        ).await;

        let req = test::TestRequest::get().uri("/test").to_request();
        let resp = test::call_service(&app, req).await;

        assert!(resp.headers().contains_key("x-request-id"));
        
        // Verify it's a valid UUID format
        let request_id = resp.headers()
            .get("x-request-id")
            .and_then(|h| h.to_str().ok())
            .unwrap();
        
        // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        assert_eq!(request_id.len(), 36);
        assert_eq!(request_id.chars().filter(|c| *c == '-').count(), 4);
    }

    #[actix_web::test]
    async fn test_accepts_existing_request_id() {
        let app = test::init_service(
            App::new()
                .wrap(RequestId)
                .route("/test", web::get().to(test_handler))
        ).await;

        let custom_id = "custom-request-id-123";
        let req = test::TestRequest::get()
            .uri("/test")
            .insert_header((REQUEST_ID_HEADER, custom_id))
            .to_request();
        
        let resp = test::call_service(&app, req).await;
        
        let response_id = resp.headers()
            .get("x-request-id")
            .and_then(|h| h.to_str().ok())
            .unwrap();
        
        assert_eq!(response_id, custom_id);
    }

    #[actix_web::test]
    async fn test_request_id_accessible_in_handler() {
        let app = test::init_service(
            App::new()
                .wrap(RequestId)
                .route("/test", web::get().to(test_handler))
        ).await;

        let req = test::TestRequest::get().uri("/test").to_request();
        let resp = test::call_service(&app, req).await;

        // The handler returns the request ID in the body
        let body = test::read_body(resp).await;
        let body_str = std::str::from_utf8(&body).unwrap();
        
        // Should not be "none" (the default when get_request_id fails)
        assert_ne!(body_str, "none");
        assert!(!body_str.is_empty());
    }

    #[actix_web::test]
    async fn test_different_requests_get_different_ids() {
        let app = test::init_service(
            App::new()
                .wrap(RequestId)
                .route("/test", web::get().to(test_handler))
        ).await;

        let req1 = test::TestRequest::get().uri("/test").to_request();
        let resp1 = test::call_service(&app, req1).await;
        let id1 = resp1.headers()
            .get("x-request-id")
            .and_then(|h| h.to_str().ok())
            .unwrap();

        let req2 = test::TestRequest::get().uri("/test").to_request();
        let resp2 = test::call_service(&app, req2).await;
        let id2 = resp2.headers()
            .get("x-request-id")
            .and_then(|h| h.to_str().ok())
            .unwrap();

        // Each request should get a unique ID
        assert_ne!(id1, id2);
    }

    #[actix_web::test]
    async fn test_request_id_with_post_request() {
        let app = test::init_service(
            App::new()
                .wrap(RequestId)
                .route("/test", web::post().to(test_handler))
        ).await;

        let req = test::TestRequest::post()
            .uri("/test")
            .set_payload("test data")
            .to_request();
        
        let resp = test::call_service(&app, req).await;

        assert!(resp.headers().contains_key("x-request-id"));
    }

    #[actix_web::test]
    async fn test_request_id_with_multiple_routes() {
        async fn handler1(req: actix_web::HttpRequest) -> HttpResponse {
            let request_id = get_request_id(&req).unwrap_or_default();
            HttpResponse::Ok().json(serde_json::json!({"route": "1", "id": request_id}))
        }

        async fn handler2(req: actix_web::HttpRequest) -> HttpResponse {
            let request_id = get_request_id(&req).unwrap_or_default();
            HttpResponse::Ok().json(serde_json::json!({"route": "2", "id": request_id}))
        }

        let app = test::init_service(
            App::new()
                .wrap(RequestId)
                .route("/route1", web::get().to(handler1))
                .route("/route2", web::get().to(handler2))
        ).await;

        let req1 = test::TestRequest::get().uri("/route1").to_request();
        let resp1 = test::call_service(&app, req1).await;
        assert!(resp1.headers().contains_key("x-request-id"));

        let req2 = test::TestRequest::get().uri("/route2").to_request();
        let resp2 = test::call_service(&app, req2).await;
        assert!(resp2.headers().contains_key("x-request-id"));
    }

    #[actix_web::test]
    async fn test_case_insensitive_header_acceptance() {
        let app = test::init_service(
            App::new()
                .wrap(RequestId)
                .route("/test", web::get().to(test_handler))
        ).await;

        let custom_id = "case-test-id";
        // Test with different case variations
        let req = test::TestRequest::get()
            .uri("/test")
            .insert_header(("x-request-id", custom_id))
            .to_request();
        
        let resp = test::call_service(&app, req).await;
        
        let response_id = resp.headers()
            .get("x-request-id")
            .and_then(|h| h.to_str().ok())
            .unwrap();
        
        assert_eq!(response_id, custom_id);
    }

    #[test]
    fn test_request_id_extension_clone() {
        let ext1 = RequestIdExtension("test-id".to_string());
        let ext2 = ext1.clone();
        assert_eq!(ext1.0, ext2.0);
    }

    #[test]
    fn test_request_id_extension_debug() {
        let ext = RequestIdExtension("test-id".to_string());
        let debug_str = format!("{:?}", ext);
        assert!(debug_str.contains("test-id"));
    }
}
