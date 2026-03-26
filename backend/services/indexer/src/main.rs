//! Blockchain Indexer Service for Stellar Creator Portfolio
//! 
//! Listens to Soroban events from bounty contracts and syncs to PostgreSQL.
//! Provides real-time updates for frontend about bounty status changes.

use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::{env, error::Error, time::Duration};
use chrono::{DateTime, Utc};

/// Stellar RPC client configuration
struct StellarRpcClient {
    rpc_url: String,
    network_passphrase: String,
}

/// Event record to store in database
#[derive(Debug, Serialize, Deserialize)]
struct IndexedEvent {
    id: Option<i64>,
    event_type: String,
    contract_id: String,
    topic: String,
    data: serde_json::Value,
    ledger_sequence: i64,
    created_at: DateTime<Utc>,
}

/// Bounty event types
enum BountyEventType {
    BountyCreated,
    BountyReserved,
    BountySubmitted,
    BountyCompleted,
    WorkSubmitted,
}

impl StellarRpcClient {
    fn new() -> Result<Self, Box<dyn Error>> {
        let rpc_url = env::var("STELLAR_RPC_URL")
            .unwrap_or_else(|_| "https://soroban-test.stellar.org:443".to_string());
        let network = env::var("STELLAR_NETWORK")
            .unwrap_or_else(|_| "Test SDF Network ; September 2015".to_string());
        
        Ok(Self {
            rpc_url,
            network_passphrase: network,
        })
    }

    /// Get latest ledger sequence
    async fn get_latest_ledger(&self) -> Result<i64, Box<dyn Error>> {
        let client = reqwest::Client::new();
        let response = client.post(&self.rpc_url)
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getLatestLedger",
                "params": []
            }))
            .send()
            .await?
            .json::<serde_json::Value>()
            .await?;

        if let Some(result) = response.get("result") {
            if let Some(sequence) = result.get("sequence") {
                return Ok(sequence.as_i64().unwrap_or(0));
            }
        }
        
        Err("Failed to get latest ledger".into())
    }

    /// Get events for a range of ledgers
    async fn get_events(&self, start_ledger: i64, limit: u32) -> Result<serde_json::Value, Box<dyn Error>> {
        let client = reqwest::Client::new();
        let response = client.post(&self.rpc_url)
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getEvents",
                "params": {
                    "startLedger": start_ledger,
                    "limit": limit
                }
            }))
            .send()
            .await?
            .json::<serde_json::Value>()
            .await?;

        Ok(response)
    }
}

/// Indexer service
struct IndexerService {
    db_pool: PgPool,
    stellar_client: StellarRpcClient,
    last_processed_ledger: i64,
}

impl IndexerService {
    async fn new() -> Result<Self, Box<dyn Error>> {
        let database_url = env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set");
        
        let db_pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(&database_url)
            .await?;

        // Create events table if not exists
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS indexed_events (
                id SERIAL PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                contract_id VARCHAR(100) NOT NULL,
                topic TEXT NOT NULL,
                data JSONB NOT NULL,
                ledger_sequence BIGINT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
            "#
        )
        .execute(&db_pool)
        .await?;

        let stellar_client = StellarRpcClient::new()?;
        
        // Get last processed ledger from DB or start from current
        let last_ledger = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(ledger_sequence), 0) FROM indexed_events"
        )
        .fetch_one(&db_pool)
        .await?;

        Ok(Self {
            db_pool,
            stellar_client,
            last_processed_ledger: last_ledger,
        })
    }

    /// Process events from Stellar blockchain
    async fn process_events(&mut self) -> Result<(), Box<dyn Error>> {
        // Get events from last processed ledger
        let response = self.stellar_client.get_events(self.last_processed_ledger + 1, 100).await?;
        
        if let Some(events) = response.get("result").and_then(|r| r.get("events")) {
            if let Some(event_array) = events.as_array() {
                for event in event_array {
                    self.process_single_event(event).await?;
                }
                
                // Update last processed ledger
                if let Some(ledger) = event_array.last()
                    .and_then(|e| e.get("ledger"))
                    .and_then(|l| l.as_i64())
                {
                    self.last_processed_ledger = ledger;
                }
            }
        }

        Ok(())
    }

    /// Process a single event and store in database
    async fn process_single_event(&self, event: &serde_json::Value) -> Result<(), Box<dyn Error>> {
        let event_type = event
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");

        let contract_id = event
            .get("contractId")
            .and_then(|c| c.as_str())
            .unwrap_or("");

        // Skip non-bounty events
        if !contract_id.is_empty() {
            let topic = event
                .get("topic")
                .map(|t| t.to_string())
                .unwrap_or_default();

            let data = event
                .get("value")
                .cloned()
                .unwrap_or(serde_json::Value::Null);

            let ledger = event
                .get("ledger")
                .and_then(|l| l.as_i64())
                .unwrap_or(0);

            // Store in database
            sqlx::query(
                r#"
                INSERT INTO indexed_events (event_type, contract_id, topic, data, ledger_sequence)
                VALUES ($1, $2, $3, $4, $5)
                "#
            )
            .bind(event_type)
            .bind(contract_id)
            .bind(topic)
            .bind(data)
            .bind(ledger)
            .execute(&self.db_pool)
            .await?;

            log::info!(
                "Indexed event: {} from contract {} at ledger {}",
                event_type,
                contract_id,
                ledger
            );
        }

        Ok(())
    }

    /// Run the indexer loop
    async fn run(&mut self) -> Result<(), Box<dyn Error>> {
        log::info!("Starting indexer service...");
        log::info!("Last processed ledger: {}", self.last_processed_ledger);

        loop {
            match self.process_events().await {
                Ok(_) => {
                    log::debug!("Processed events up to ledger {}", self.last_processed_ledger);
                }
                Err(e) => {
                    log::error!("Error processing events: {}", e);
                }
            }

            // Wait before next poll
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();
    
    log::info!("🚀 Indexer Service starting...");
    
    let mut indexer = IndexerService::new().await?;
    
    log::info!("✅ Indexer initialized, starting event loop...");
    
    indexer.run().await?;

    Ok(())
}
