mod config;
mod db;
mod error;
mod handlers;
mod tokens;

use actix_web::{middleware, web, App, HttpServer};
use anyhow::Context;
use sqlx::PgPool;

#[actix_web::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_auth=debug".to_string()),
        )
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

    tracing::info!("Starting stellar-auth on {}:{}", host, port);

    HttpServer::new(move || {
        App::new()
            .app_data(config_data.clone())
            .app_data(web::Data::new(pool.clone()))
            .wrap(middleware::Logger::default())
            .wrap(middleware::NormalizePath::trim())
            .route("/health", web::get().to(handlers::health))
            .route("/auth/token", web::post().to(handlers::mint_tokens))
            .route("/auth/refresh", web::post().to(handlers::refresh_tokens))
    })
    .bind((host.as_str(), port))?
    .run()
    .await?;

    Ok(())
}
