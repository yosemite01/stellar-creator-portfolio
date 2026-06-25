//! Prometheus metrics for the Stellar API.
//!
//! Exposes request counts, latencies, and business metrics at `GET /metrics`.
//! Uses `actix-web-prom` middleware for automatic HTTP metrics and custom
//! `prometheus` counters/histograms for business-level observability.

use actix_web_prom::PrometheusMetricsBuilder;
use prometheus::{opts, Histogram, HistogramOpts, IntCounter, IntCounterVec, Registry};

/// Custom business metrics registered alongside the HTTP middleware metrics.
#[derive(Clone)]
pub struct BusinessMetrics {
    pub bounties_created: IntCounter,
    pub applications_submitted: IntCounter,
    pub freelancers_registered: IntCounter,
    pub escrows_released: IntCounter,
    pub escrows_deposits: IntCounterVec,
    pub dispute_resolution_seconds: Histogram,
    pub stellar_rpc_calls: IntCounterVec,
    pub db_query_duration_seconds: Histogram,
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

        let escrows_deposits = IntCounterVec::new(
            opts!(
                "stellar_escrows_deposits_total",
                "Total escrow deposits by token"
            ),
            &["token"],
        )
        .expect("metric can be created");

        let dispute_resolution_seconds = Histogram::with_opts(HistogramOpts::new(
            "stellar_dispute_resolution_seconds",
            "Time taken to resolve disputes"
        ))
        .expect("metric can be created");

        let stellar_rpc_calls = IntCounterVec::new(
            opts!(
                "stellar_rpc_calls_total",
                "Total number of Stellar RPC calls by method and status"
            ),
            &["method", "status"],
        )
        .expect("metric can be created");

        let db_query_duration_seconds = Histogram::with_opts(HistogramOpts::new(
            "db_query_duration_seconds",
            "Database query duration by query type"
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
        registry.register(Box::new(escrows_deposits.clone())).ok();
        registry.register(Box::new(dispute_resolution_seconds.clone())).ok();
        registry.register(Box::new(stellar_rpc_calls.clone())).ok();
        registry.register(Box::new(db_query_duration_seconds.clone())).ok();
        registry.register(Box::new(api_errors.clone())).ok();

        Self {
            bounties_created,
            applications_submitted,
            freelancers_registered,
            escrows_released,
            escrows_deposits,
            dispute_resolution_seconds,
            stellar_rpc_calls,
            db_query_duration_seconds,
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

    let business = BusinessMetrics::new(&prometheus.registry);

    (prometheus, business)
}
