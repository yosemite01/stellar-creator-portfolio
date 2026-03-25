use actix_web::{middleware, web, App, HttpResponse, HttpServer};
use serde::Serialize;
use std::env;

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
    version: String,
    network: String,
}

async fn health(
    network: web::Data<String>,
) -> HttpResponse {
    HttpResponse::Ok().json(HealthResponse {
        status: "healthy".to_string(),
        service: "stellar-indexer".to_string(),
        version: "0.1.0".to_string(),
        network: network.get_ref().clone(),
    })
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_indexer=debug".to_string()),
        )
        .init();

    let port: u16 = env::var("INDEXER_PORT")
        .unwrap_or_else(|_| "3002".to_string())
        .parse()
        .unwrap_or(3002);

    let network = env::var("STELLAR_NETWORK").unwrap_or_else(|_| "testnet".to_string());
    let rpc_url = env::var("STELLAR_RPC_URL")
        .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".to_string());
    let db_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://stellar:stellar_dev_password@localhost:5432/stellar_db".to_string());

    tracing::info!("stellar-indexer service starting...");
    tracing::info!("Configuration:");
    tracing::info!("  Port: {}", port);
    tracing::info!("  Network: {}", network);
    tracing::info!("  RPC URL: {}", rpc_url);
    tracing::info!("  Database: [hidden]");

    tracing::info!("Starting Stellar Indexer on 0.0.0.0:{}", port);

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(network.clone()))
            .wrap(middleware::Logger::default())
            .route("/health", web::get().to(health))
    })
    .bind(("0.0.0.0", port))?
    .run()
    .await
}
