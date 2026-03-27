//! Prometheus metrics for the Stellar API.
//!
//! Exposes request counts, latencies, and business metrics at `GET /metrics`.
//! Uses `actix-web-prom` middleware for automatic HTTP metrics and custom
//! `prometheus` counters/histograms for business-level observability.

use actix_web_prom::PrometheusMetricsBuilder;
use prometheus::{opts, IntCounter, IntCounterVec, Registry};

/// Custom business metrics registered alongside the HTTP middleware metrics.
#[derive(Clone)]
pub struct BusinessMetrics {
    pub bounties_created: IntCounter,
    pub applications_submitted: IntCounter,
    pub freelancers_registered: IntCounter,
    pub escrows_released: IntCounter,
    pub api_errors: IntCounterVec,
}

impl BusinessMetrics {
    pub fn new(registry: &Registry) -> Self {
        let bounties_created = IntCounter::with_opts(opts!(
            "stellar_bounties_created_total",
            "Total number of bounties created"
        ))
        .expect("metric can be created");

        let applications_submitted = IntCounter::with_opts(opts!(
            "stellar_applications_submitted_total",
            "Total number of bounty applications submitted"
        ))
        .expect("metric can be created");

        let freelancers_registered = IntCounter::with_opts(opts!(
            "stellar_freelancers_registered_total",
            "Total number of freelancers registered"
        ))
        .expect("metric can be created");

        let escrows_released = IntCounter::with_opts(opts!(
            "stellar_escrows_released_total",
            "Total number of escrows released"
        ))
        .expect("metric can be created");

        let api_errors = IntCounterVec::new(
            opts!(
                "stellar_api_errors_total",
                "Total API errors by endpoint and status code"
            ),
            &["endpoint", "status"],
        )
        .expect("metric can be created");

        registry.register(Box::new(bounties_created.clone())).ok();
        registry.register(Box::new(applications_submitted.clone())).ok();
        registry.register(Box::new(freelancers_registered.clone())).ok();
        registry.register(Box::new(escrows_released.clone())).ok();
        registry.register(Box::new(api_errors.clone())).ok();

        Self {
            bounties_created,
            applications_submitted,
            freelancers_registered,
            escrows_released,
            api_errors,
        }
    }
}

/// Build the Prometheus middleware and register custom business metrics.
/// Returns the middleware (to wrap the App) and the business metrics (to share via app_data).
pub fn setup_metrics() -> (actix_web_prom::PrometheusMetrics, BusinessMetrics) {
    let prometheus = PrometheusMetricsBuilder::new("stellar_api")
        .endpoint("/metrics")
        .build()
        .expect("failed to build Prometheus metrics middleware");

    let business = BusinessMetrics::new(prometheus.registry.as_ref());

    (prometheus, business)
}
