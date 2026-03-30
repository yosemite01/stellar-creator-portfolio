mod config;
mod db;
mod error;
mod handlers;
mod tokens;

use actix_web::{middleware, web, App, HttpServer};
use anyhow::Context;
use sqlx::PgPool;
use stellar_discovery::{create_discovery, ServiceInfo};

use opentelemetry::trace::TracerProvider as _;
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{runtime, trace::{self}, Resource};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Registry};

#[actix_web::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    // Initialize OpenTelemetry
    let tracer_provider = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(std::env::var("OTLP_ENDPOINT").unwrap_or_else(|_| "http://jaeger:4317".to_string())),
        )
        .with_trace_config(
            trace::Config::default().with_resource(Resource::new(vec![KeyValue::new(
                opentelemetry_semantic_conventions::resource::SERVICE_NAME,
                "stellar-auth",
            )])),
        )
        .install_batch(runtime::Tokio)
        .expect("Failed to initialize tracer");

    let tracer = tracer_provider.tracer("stellar-auth");
    let telemetry = OpenTelemetryLayer::new(tracer);
    
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,stellar_auth=debug"));

    let formatting_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stdout);

    Registry::default()
        .with(env_filter)
        .with(telemetry)
        .with(formatting_layer)
        .init();

    let config = config::Config::from_env().context("invalid configuration")?;
    if config.mint_secret.is_none() && config.dev_mint_allow {
        tracing::warn!(
            "AUTH_DEV_MINT is enabled without AUTH_MINT_SECRET: token mint is unauthenticated; do not use in production"
        );
    }
    let pool = PgPool::connect(&config.database_url)
        .await
        .context("failed to connect to database")?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("failed to run database migrations")?;

    let host = config.host.clone();
    let port = config.port;
    let config_data = web::Data::new(config);

    // ── Service Discovery ────────────────────────────────────────────────
    let discovery = create_discovery()
        .await
        .context("failed to initialise service discovery")?;

    let service_info = ServiceInfo::new("stellar-auth", &host, port);
    let service_id = service_info.id.clone();

    if let Err(e) = discovery.register(service_info).await {
        tracing::warn!("Service discovery registration failed (non-fatal): {e}");
    }

    tracing::info!("Starting stellar-auth on {}:{}", host, port);

    HttpServer::new(move || {
        App::new()
            .app_data(config_data.clone())
            .app_data(web::Data::new(pool.clone()))
            .wrap(tracing_actix_web::TracingLogger::default())
            .wrap(middleware::NormalizePath::trim())
            .route("/health", web::get().to(handlers::health))
            .route("/auth/register", web::post().to(handlers::register))
            .route("/auth/login", web::post().to(handlers::login))
            .route("/auth/token", web::post().to(handlers::mint_tokens))
            .route("/auth/refresh", web::post().to(handlers::refresh_tokens))
            .route(
                "/auth/oauth2/{provider}/authorize",
                web::get().to(handlers::oauth2_authorize),
            )
            .route(
                "/auth/oauth2/{provider}/token",
                web::post().to(handlers::oauth2_token_exchange),
            )
            .route("/auth/logout", web::post().to(handlers::logout))
            .route("/auth/logout/all", web::post().to(handlers::logout_all))
            .route("/auth/me", web::get().to(handlers::get_me))
            .route("/auth/me", web::patch().to(handlers::update_profile))
            .route("/auth/password/change", web::post().to(handlers::change_password))
    })
    .bind((host.as_str(), port))?
    .run()
    .await?;

    // Deregister from service discovery on shutdown
    if let Err(e) = discovery.deregister(&service_id).await {
        tracing::warn!("Service discovery deregistration failed: {e}");
    }

    Ok(())
}
