use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing_subscriber;

/// Metrics collection for observability
#[derive(Default)]
pub struct Metrics {
    pub request_count: AtomicU64,
    pub error_count: AtomicU64,
    pub active_requests: AtomicU64,
    pub total_response_time_ms: AtomicU64,
    pub endpoint_counts: std::collections::HashMap<String, Arc<AtomicU64>>,
}

impl Metrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_request(&self, endpoint: &str) {
        self.request_count.fetch_add(1, Ordering::Relaxed);
        self.active_requests.fetch_add(1, Ordering::Relaxed);
        
        let counter = self.endpoint_counts
            .entry(endpoint.to_string())
            .or_insert_with(|| Arc::new(AtomicU64::new(0)));
        counter.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_response(&self, duration: Duration, is_error: bool) {
        self.active_requests.fetch_sub(1, Ordering::Relaxed);
        self.total_response_time_ms.fetch_add(
            duration.as_millis() as u64,
            Ordering::Relaxed,
        );
        if is_error {
            self.error_count.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn get_snapshot(&self) -> MetricsSnapshot {
        let endpoint_counts: std::collections::HashMap<String, u64> = self
            .endpoint_counts
            .iter()
            .map(|(k, v)| (k.clone(), v.load(Ordering::Relaxed)))
            .collect();
        
        MetricsSnapshot {
            request_count: self.request_count.load(Ordering::Relaxed),
            error_count: self.error_count.load(Ordering::Relaxed),
            active_requests: self.active_requests.load(Ordering::Relaxed),
            total_response_time_ms: self.total_response_time_ms.load(Ordering::Relaxed),
            avg_response_time_ms: {
                let count = self.request_count.load(Ordering::Relaxed);
                if count > 0 {
                    self.total_response_time_ms.load(Ordering::Relaxed) / count
                } else {
                    0
                }
            },
            endpoint_counts,
        }
    }

    pub fn prometheus_text(&self) -> String {
        let snap = self.get_snapshot();
        let mut output = String::new();
        
        output.push_str("# HELP stellar_api_requests_total Total number of API requests\n");
        output.push_str("# TYPE stellar_api_requests_total counter\n");
        output.push_str(&format!("stellar_api_requests_total {}\n", snap.request_count));
        
        output.push_str("\n# HELP stellar_api_errors_total Total number of API errors\n");
        output.push_str("# TYPE stellar_api_errors_total counter\n");
        output.push_str(&format!("stellar_api_errors_total {}\n", snap.error_count));
        
        output.push_str("\n# HELP stellar_api_active_requests Current number of active requests\n");
        output.push_str("# TYPE stellar_api_active_requests gauge\n");
        output.push_str(&format!("stellar_api_active_requests {}\n", snap.active_requests));
        
        output.push_str("\n# HELP stellar_api_response_time_ms_avg Average response time in milliseconds\n");
        output.push_str("# TYPE stellar_api_response_time_ms_avg gauge\n");
        output.push_str(&format!("stellar_api_response_time_ms_avg {}\n", snap.avg_response_time_ms));
        
        output.push_str("\n# HELP stellar_api_endpoint_requests_total Requests per endpoint\n");
        output.push_str("# TYPE stellar_api_endpoint_requests_total counter\n");
        for (endpoint, count) in &snap.endpoint_counts {
            let sanitized = endpoint.replace(['/', '-', '.'], "_");
            output.push_str(&format!(
                "stellar_api_endpoint_requests_total{{endpoint=\"{}\"}} {}\n",
                sanitized, count
            ));
        }
        
        output
    }
}

#[derive(Clone, Serialize)]
pub struct MetricsSnapshot {
    pub request_count: u64,
    pub error_count: u64,
    pub active_requests: u64,
    pub total_response_time_ms: u64,
    pub avg_response_time_ms: u64,
    pub endpoint_counts: std::collections::HashMap<String, u64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BountyRequest {
    pub creator: String,
    pub title: String,
    pub description: String,
    pub budget: i128,
    pub deadline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BountyApplication {
    pub bounty_id: u64,
    pub freelancer: String,
    pub proposal: String,
    pub proposed_budget: i128,
    pub timeline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FreelancerRegistration {
    pub name: String,
    pub discipline: String,
    pub bio: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
    pub message: Option<String>,
}

impl<T> ApiResponse<T> {
    fn ok(data: T, message: Option<String>) -> Self {
        ApiResponse {
            success: true,
            data: Some(data),
            error: None,
            message,
        }
    }

    #[allow(dead_code)]
    fn err(error: String) -> Self
    where
        T: Default,
    {
        ApiResponse {
            success: false,
            data: None,
            error: Some(error),
            message: None,
        }
    }
}

async fn health() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "healthy",
        "service": "stellar-api",
        "version": "0.1.0"
    }))
}

async fn metrics(metrics: web::Data<Arc<Metrics>>) -> HttpResponse {
    let prom_text = metrics.prometheus_text();
    HttpResponse::Ok()
        .content_type("text/plain; version=0.0.4")
        .body(prom_text)
}

async fn create_bounty(
    metrics: web::Data<Arc<Metrics>>,
    body: web::Json<BountyRequest>,
) -> HttpResponse {
    metrics.record_request("/api/bounties");
    let start = Instant::now();
    
    tracing::info!("Creating bounty: {:?}", body.title);
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "bounty_id": 1,
            "creator": body.creator,
            "title": body.title,
            "budget": body.budget,
            "status": "open"
        }),
        Some("Bounty created successfully".to_string()),
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Created().json(response)
}

async fn list_bounties(metrics: web::Data<Arc<Metrics>>) -> HttpResponse {
    metrics.record_request("/api/bounties");
    let start = Instant::now();
    
    tracing::info!("Listing bounties");
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "bounties": [], "total": 0, "page": 1, "limit": 10 }),
        None,
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Ok().json(response)
}

async fn get_bounty(
    metrics: web::Data<Arc<Metrics>>,
    path: web::Path<u64>,
) -> HttpResponse {
    metrics.record_request("/api/bounties/{id}");
    let start = Instant::now();
    let bounty_id = path.into_inner();
    
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": bounty_id, "title": "Sample Bounty", "status": "open" }),
        None,
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Ok().json(response)
}

async fn apply_for_bounty(
    metrics: web::Data<Arc<Metrics>>,
    path: web::Path<u64>,
    body: web::Json<BountyApplication>,
) -> HttpResponse {
    metrics.record_request("/api/bounties/{id}/apply");
    let start = Instant::now();
    let bounty_id = path.into_inner();
    
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "application_id": 1,
            "bounty_id": bounty_id,
            "freelancer": body.freelancer,
            "status": "pending"
        }),
        Some("Application submitted successfully".to_string()),
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Created().json(response)
}

async fn register_freelancer(
    metrics: web::Data<Arc<Metrics>>,
    body: web::Json<FreelancerRegistration>,
) -> HttpResponse {
    metrics.record_request("/api/freelancers/register");
    let start = Instant::now();
    
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "name": body.name,
            "discipline": body.discipline,
            "verified": false
        }),
        Some("Freelancer registered successfully".to_string()),
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Ok().json(response)
}

async fn list_freelancers(
    metrics: web::Data<Arc<Metrics>>,
) -> HttpResponse {
    metrics.record_request("/api/freelancers");
    let start = Instant::now();
    
    tracing::info!("Listing freelancers");
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "freelancers": [], "total": 0 }),
        None,
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Ok().json(response)
}

async fn get_freelancer(
    metrics: web::Data<Arc<Metrics>>,
    path: web::Path<String>,
) -> HttpResponse {
    metrics.record_request("/api/freelancers/{address}");
    let start = Instant::now();
    let address = path.into_inner();
    
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({
            "address": address,
            "discipline": "UI/UX Design",
            "rating": 4.8,
            "completed_projects": 0
        }),
        None,
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Ok().json(response)
}

async fn get_escrow(
    metrics: web::Data<Arc<Metrics>>,
    path: web::Path<u64>,
) -> HttpResponse {
    metrics.record_request("/api/escrow/{id}");
    let start = Instant::now();
    let escrow_id = path.into_inner();
    
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": escrow_id, "status": "active", "amount": 0 }),
        None,
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Ok().json(response)
}

async fn release_escrow(
    metrics: web::Data<Arc<Metrics>>,
    path: web::Path<u64>,
) -> HttpResponse {
    metrics.record_request("/api/escrow/{id}/release");
    let start = Instant::now();
    let escrow_id = path.into_inner();
    
    let response: ApiResponse<serde_json::Value> = ApiResponse::ok(
        serde_json::json!({ "id": escrow_id, "status": "released" }),
        Some("Funds released successfully".to_string()),
    );
    metrics.record_response(start.elapsed(), false);
    HttpResponse::Ok().json(response)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_api=debug".to_string()),
        )
        .init();

    let port = std::env::var("API_PORT")
        .unwrap_or_else(|_| "3001".to_string())
        .parse::<u16>()
        .expect("API_PORT must be a valid port number");

    let host = std::env::var("API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    tracing::info!("Starting Stellar API on {}:{}", host, port);

    let metrics = Arc::new(Metrics::new());

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(metrics.clone()))
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            .route("/health", web::get().to(health))
            .route("/metrics", web::get().to(metrics))
            .route("/api/bounties", web::post().to(create_bounty))
            .route("/api/bounties", web::get().to(list_bounties))
            .route("/api/bounties/{id}", web::get().to(get_bounty))
            .route("/api/bounties/{id}/apply", web::post().to(apply_for_bounty))
            .route("/api/freelancers/register", web::post().to(register_freelancer))
            .route("/api/freelancers", web::get().to(list_freelancers))
            .route("/api/freelancers/{address}", web::get().to(get_freelancer))
            .route("/api/escrow/{id}", web::get().to(get_escrow))
            .route("/api/escrow/{id}/release", web::post().to(release_escrow))
    })
    .bind((host.as_str(), port))?
    .run()
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_record_request() {
        let metrics = Metrics::new();
        metrics.record_request("/api/bounties");
        metrics.record_request("/api/bounties");
        metrics.record_request("/api/freelancers");
        
        let snap = metrics.get_snapshot();
        assert_eq!(snap.request_count, 3);
        assert_eq!(snap.endpoint_counts.get("/api/bounties").copied(), Some(2));
        assert_eq!(snap.endpoint_counts.get("/api/freelancers").copied(), Some(1));
    }

    #[test]
    fn test_metrics_record_response() {
        let metrics = Metrics::new();
        metrics.record_request("/api/bounties");
        metrics.record_response(Duration::from_millis(100), false);
        
        let snap = metrics.get_snapshot();
        assert_eq!(snap.request_count, 1);
        assert_eq!(snap.total_response_time_ms, 100);
        assert_eq!(snap.avg_response_time_ms, 100);
    }

    #[test]
    fn test_metrics_error_tracking() {
        let metrics = Metrics::new();
        metrics.record_request("/api/bounties");
        metrics.record_response(Duration::from_millis(50), true);
        
        let snap = metrics.get_snapshot();
        assert_eq!(snap.error_count, 1);
    }

    #[test]
    fn test_api_response_ok() {
        let response: ApiResponse<String> = ApiResponse::ok("test".to_string(), None);
        assert!(response.success);
        assert_eq!(response.data, Some("test".to_string()));
    }

    #[test]
    fn test_api_response_err() {
        let response: ApiResponse<String> = ApiResponse::err("error".to_string());
        assert!(!response.success);
        assert_eq!(response.error, Some("error".to_string()));
    }
}
