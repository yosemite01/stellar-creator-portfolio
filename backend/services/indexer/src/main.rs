//! Stellar Platform Indexer Service
//! 
//! Listens to Soroban smart contract events and syncs them to PostgreSQL.
//! Supports the Bounty, Escrow, Freelancer, and Governance contracts.
//! 
//! Usage:
//!   cargo run --bin stellar-indexer
//! 
//! Environment Variables:
//!   STELLAR_RPC_URL       - Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
//!   STELLAR_NETWORK       - Network name (default: testnet)
//!   BOUNTY_CONTRACT_ID     - Bounty contract public key
//!   ESCROW_CONTRACT_ID    - Escrow contract public key  
//!   FREELANCER_CONTRACT_ID - Freelancer contract public key
//!   GOVERNANCE_CONTRACT_ID - Governance contract public key
//!   DATABASE_URL          - PostgreSQL connection string
//!   POLL_INTERVAL_SECS    - Polling interval (default: 5)

use anyhow::Result;
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::interval;
use tracing_subscriber;
use uuid::Uuid;

// ============================================================
// Configuration
// ============================================================

#[derive(Clone]
struct Config {
    rpc_url: String,
    bounty_contract_id: Option<String>,
    escrow_contract_id: Option<String>,
    freelancer_contract_id: Option<String>,
    governance_contract_id: Option<String>,
    poll_interval_secs: u64,
    database_url: String,
}

impl Config {
    fn from_env() -> Self {
        Config {
            rpc_url: std::env::var("STELLAR_RPC_URL")
                .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".to_string()),
            bounty_contract_id: std::env::var("BOUNTY_CONTRACT_ID").ok(),
            escrow_contract_id: std::env::var("ESCROW_CONTRACT_ID").ok(),
            freelancer_contract_id: std::env::var("FREELANCER_CONTRACT_ID").ok(),
            governance_contract_id: std::env::var("GOVERNANCE_CONTRACT_ID").ok(),
            poll_interval_secs: std::env::var("POLL_INTERVAL_SECS")
                .unwrap_or_else(|_| "5".to_string())
                .parse()
                .unwrap_or(5),
            database_url: std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
        }
    }
}

// ============================================================
// Soroban RPC Types
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SorobanRpcResponse<T> {
    result: Option<T>,
    error: Option<SorobanRpcError>,
    id: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SorobanRpcError {
    code: i32,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GetEventsResponse {
    events: Vec<ContractEvent>,
    cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ContractEvent {
    id: String,
    contract_id: String,
    #[serde(rename = "type")]
    event_type: String,
    ledger: Option<u32>,
    ledgerseq: Option<u32>,
    paging_token: Option<String>,
    timestamp: Option<String>,
    topic: Vec<String>,
    value: ContractEventValue,
    in_successful_contract_call: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ContractEventValue {
    #[serde(rename = "type")]
    value_type: String,
    data: Option<serde_json::Value>,
}

// ============================================================
// Event Processing
// ============================================================

fn format_topic(topics: &[String]) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    (
        topics.get(0).cloned(),
        topics.get(1).cloned(),
        topics.get(2).cloned(),
        topics.get(3).cloned(),
    )
}

fn extract_event_type(topics: &[String]) -> String {
    topics.first().cloned().unwrap_or_else(|| "Unknown".to_string())
}

async fn ensure_table_exists(pool: &PgPool) -> Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS indexed_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id VARCHAR(255) UNIQUE NOT NULL,
            contract_id VARCHAR(56) NOT NULL,
            event_type VARCHAR(255) NOT NULL,
            topic_0 TEXT,
            topic_1 TEXT,
            topic_2 TEXT,
            topic_3 TEXT,
            value_data JSONB,
            ledger INTEGER,
            timestamp TIMESTAMPTZ,
            cursor VARCHAR(255) NOT NULL,
            processed BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_events_cursor ON indexed_events(cursor)")
        .execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_events_contract ON indexed_events(contract_id)")
        .execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_events_type ON indexed_events(event_type)")
        .execute(pool).await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON indexed_events(timestamp DESC)")
        .execute(pool).await?;

    Ok(())
}

async fn process_event(
    db: &PgPool,
    event: &ContractEvent,
    cursor: &str,
) -> Result<()> {
    let (topic_0, topic_1, topic_2, topic_3) = format_topic(&event.topic);
    let event_type = extract_event_type(&event.topic);
    let value_data = event.value.data.clone();

    let timestamp = event.timestamp
        .as_ref()
        .and_then(|ts| DateTime::parse_from_rfc3339(ts).ok())
        .map(|dt| dt.with_timezone(&Utc));

    // Skip if already indexed
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM indexed_events WHERE event_id = $1)"
    )
    .bind(&event.id)
    .fetch_one(db)
    .await?;

    if exists {
        return Ok(());
    }

    let ledger = event.ledger.or(event.ledgerseq).map(|l| l as i32);

    sqlx::query(
        r#"
        INSERT INTO indexed_events 
        (id, event_id, contract_id, event_type, topic_0, topic_1, topic_2, topic_3, 
         value_data, ledger, timestamp, cursor, processed)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(&event.id)
    .bind(&event.contract_id)
    .bind(&event_type)
    .bind(&topic_0)
    .bind(&topic_1)
    .bind(&topic_2)
    .bind(&topic_3)
    .bind(&value_data)
    .bind(ledger)
    .bind(timestamp)
    .bind(cursor)
    .execute(db)
    .await?;

    tracing::info!(
        event_id = %event.id,
        contract_id = %event.contract_id,
        event_type = %event_type,
        ledger = ?ledger,
        "Indexed event"
    );

    // Handle specific event types
    handle_event(&event_type, &value_data).await;

    Ok(())
}

async fn handle_event(event_type: &str, data: &Option<serde_json::Value>) {
    match event_type {
        "bounty_created" | "BountyCreated" => {
            tracing::info!("Bounty created event: {:?}", data);
        }
        "application_submitted" | "ApplicationSubmitted" => {
            tracing::info!("Application submitted: {:?}", data);
        }
        "bounty_completed" | "BountyCompleted" => {
            tracing::info!("Bounty completed: {:?}", data);
        }
        "bounty_cancelled" | "BountyCancelled" => {
            tracing::info!("Bounty cancelled: {:?}", data);
        }
        "escrow_created" | "EscrowCreated" => {
            tracing::info!("Escrow created: {:?}", data);
        }
        "escrow_released" | "EscrowReleased" => {
            tracing::info!("Escrow released: {:?}", data);
        }
        _ => {
            tracing::debug!("Unhandled event type: {}", event_type);
        }
    }
}

// ============================================================
// Soroban RPC Client
// ============================================================

async fn get_events(
    http: &Client,
    rpc_url: &str,
    contract_ids: &[String],
    cursor: Option<&str>,
) -> Result<GetEventsResponse> {
    #[derive(Serialize)]
    struct GetEventsParams<'a> {
        start_ledger: Option<u32>,
        filters: Vec<ContractFilter<'a>>,
        cursor: Option<&'a str>,
        limit: Option<u32>,
    }

    #[derive(Serialize)]
    struct ContractFilter<'a> {
        #[serde(rename = "type")]
        contract_filter_type: &'a str,
        contract_ids: Vec<&'a str>,
    }

    #[derive(Serialize)]
    struct GetEventsRequest<'a> {
        jsonrpc: &'a str,
        id: usize,
        method: &'a str,
        params: GetEventsParams<'a>,
    }

    let mut filters = Vec::new();
    
    if contract_ids.is_empty() {
        // Listen to all contract events
        filters.push(ContractFilter {
            contract_filter_type: "all",
            contract_ids: vec![],
        });
    } else {
        filters.push(ContractFilter {
            contract_filter_type: "contract",
            contract_ids: contract_ids.iter().map(|s| s.as_str()).collect(),
        });
    }

    let request = GetEventsRequest {
        jsonrpc: "2.0",
        id: 1,
        method: "getEvents",
        params: GetEventsParams {
            start_ledger: None,
            filters,
            cursor,
            limit: Some(100),
        },
    };

    let resp = http
        .post(rpc_url)
        .json(&request)
        .send()
        .await?
        .json::<SorobanRpcResponse<GetEventsResponse>>()
        .await?;

    if let Some(err) = resp.error {
        anyhow::bail!("Soroban RPC error {}: {}", err.code, err.message);
    }

    resp.result.ok_or_else(|| anyhow::anyhow!("No result in Soroban RPC response"))
}

// ============================================================
// Indexer
// ============================================================

struct Indexer {
    db: PgPool,
    http: Client,
    config: Config,
    last_cursor: Arc<RwLock<Option<String>>>,
}

impl Indexer {
    fn new(db: PgPool, http: Client, config: Config) -> Self {
        Indexer {
            db,
            http,
            config,
            last_cursor: Arc::new(RwLock::new(None)),
        }
    }

    fn contract_ids(&self) -> Vec<String> {
        let mut ids = Vec::new();
        if let Some(ref id) = self.config.bounty_contract_id {
            ids.push(id.clone());
        }
        if let Some(ref id) = self.config.escrow_contract_id {
            ids.push(id.clone());
        }
        if let Some(ref id) = self.config.freelancer_contract_id {
            ids.push(id.clone());
        }
        if let Some(ref id) = self.config.governance_contract_id {
            ids.push(id.clone());
        }
        ids
    }

    async fn run(&self) -> Result<()> {
        tracing::info!(
            "Starting indexer for RPC: {} (contracts: {:?})",
            self.config.rpc_url,
            self.contract_ids()
        );

        ensure_table_exists(&self.db).await?;
        tracing::info!("Database table verified/created");

        let mut poll_interval = interval(Duration::from_secs(self.config.poll_interval_secs));

        loop {
            poll_interval.tick().await;

            let cursor = {
                let guard = self.last_cursor.read().await;
                guard.clone()
            };

            match get_events(&self.http, &self.config.rpc_url, &self.contract_ids(), cursor.as_deref()).await {
                Ok(response) => {
                    if response.events.is_empty() {
                        tracing::debug!("No new events");
                        continue;
                    }

                    let new_cursor = response.cursor.clone();
                    let events_processed = response.events.len();

                    for event in &response.events {
                        let cursor_for_event = new_cursor.clone().unwrap_or_default();
                        if let Err(e) = process_event(&self.db, event, &cursor_for_event).await {
                            tracing::error!("Failed to process event {}: {}", event.id, e);
                        }
                    }

                    if let Some(ref nc) = new_cursor {
                        let mut guard = self.last_cursor.write().await;
                        *guard = Some(nc.clone());
                    }

                    tracing::info!("Processed {} events", events_processed);
                }
                Err(e) => {
                    tracing::error!("Failed to fetch events: {}", e);
                }
            }
        }
    }
}

// ============================================================
// Main
// ============================================================

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "info,stellar_indexer=debug,warn".to_string()),
        )
        .init();

    let config = Config::from_env();

    tracing::info!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

    tracing::info!("Connected to database");

    let http = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("Failed to create HTTP client");

    let indexer = Indexer::new(pool, http, config);
    indexer.run().await
}
