//! Stellar Soroban event indexer.
//!
//! Polls the Soroban RPC `getEvents` endpoint for contract events emitted by
//! the bounty, freelancer, and escrow contracts, then upserts the relevant
//! rows into PostgreSQL so the Next.js frontend always reflects on-chain state.
//!
//! Cursor persistence: the last processed ledger sequence is stored in the
//! `indexer_cursors` table so restarts resume from where they left off.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::Duration;
use stellar_discovery::{create_discovery, ServiceInfo};
use tracing::{error, info, warn};

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    database_url: String,
    rpc_url: String,
    bounty_contract_id: String,
    freelancer_contract_id: String,
    escrow_contract_id: String,
    /// How many ledgers to fetch per poll
    ledger_chunk: u32,
    /// Seconds between polls
    poll_interval_secs: u64,
}

impl Config {
    fn from_env() -> Result<Self> {
        Ok(Self {
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL not set")?,
            rpc_url: std::env::var("STELLAR_RPC_URL")
                .unwrap_or_else(|_| "https://soroban-testnet.stellar.org".into()),
            bounty_contract_id: std::env::var("BOUNTY_CONTRACT_ID").unwrap_or_default(),
            freelancer_contract_id: std::env::var("FREELANCER_CONTRACT_ID").unwrap_or_default(),
            escrow_contract_id: std::env::var("ESCROW_CONTRACT_ID").unwrap_or_default(),
            ledger_chunk: std::env::var("INDEXER_LEDGER_CHUNK")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100),
            poll_interval_secs: std::env::var("INDEXER_POLL_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(6),
        })
    }
}

// ── Soroban RPC types ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct GetEventsResult {
    events: Vec<SorobanEvent>,
    #[serde(rename = "latestLedger")]
    latest_ledger: u32,
}

#[derive(Debug, Deserialize, Clone)]
struct SorobanEvent {
    #[serde(rename = "contractId")]
    contract_id: String,
    id: String,
    #[serde(rename = "ledger")]
    ledger: u32,
    #[serde(rename = "ledgerClosedAt")]
    ledger_closed_at: String,
    #[serde(rename = "pagingToken")]
    paging_token: String,
    topic: Vec<String>,
    value: String,
}

#[derive(Debug, Serialize)]
struct GetEventsRequest<'a> {
    jsonrpc: &'a str,
    id: u32,
    method: &'a str,
    params: GetEventsParams<'a>,
}

#[derive(Debug, Serialize)]
struct GetEventsParams<'a> {
    #[serde(rename = "startLedger")]
    start_ledger: u32,
    filters: Vec<EventFilter<'a>>,
    pagination: Pagination,
}

#[derive(Debug, Serialize)]
struct EventFilter<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    #[serde(rename = "contractIds")]
    contract_ids: Vec<&'a str>,
}

#[derive(Debug, Serialize)]
struct Pagination {
    limit: u32,
}

// ── Cursor persistence ────────────────────────────────────────────────────────

async fn ensure_cursor_table(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS indexer_cursors (
            key         TEXT PRIMARY KEY,
            ledger_seq  BIGINT NOT NULL DEFAULT 0
        )",
    )
    .execute(pool)
    .await
    .context("Failed to create indexer_cursors table")?;
    Ok(())
}

async fn load_cursor(pool: &PgPool, key: &str) -> Result<u32> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT ledger_seq FROM indexer_cursors WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .context("Failed to load cursor")?;
    Ok(row.map(|(seq,)| seq as u32).unwrap_or(0))
}

async fn save_cursor(pool: &PgPool, key: &str, ledger: u32) -> Result<()> {
    sqlx::query(
        "INSERT INTO indexer_cursors (key, ledger_seq)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET ledger_seq = EXCLUDED.ledger_seq",
    )
    .bind(key)
    .bind(ledger as i64)
    .execute(pool)
    .await
    .context("Failed to save cursor")?;
    Ok(())
}

// ── Event fetching ────────────────────────────────────────────────────────────

async fn fetch_events(
    client: &reqwest::Client,
    rpc_url: &str,
    contract_ids: &[&str],
    start_ledger: u32,
    limit: u32,
) -> Result<GetEventsResult> {
    let body = GetEventsRequest {
        jsonrpc: "2.0",
        id: 1,
        method: "getEvents",
        params: GetEventsParams {
            start_ledger,
            filters: vec![EventFilter {
                kind: "contract",
                contract_ids: contract_ids.to_vec(),
            }],
            pagination: Pagination { limit },
        },
    };

    let resp: RpcResponse<GetEventsResult> = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .context("RPC request failed")?
        .json()
        .await
        .context("Failed to parse RPC response")?;

    if let Some(err) = resp.error {
        anyhow::bail!("RPC error: {}", err.message);
    }

    resp.result.context("Empty RPC result")
}

// ── Event processing ──────────────────────────────────────────────────────────

/// Extracts the first topic string (the event name) from the XDR-encoded topic vec.
/// Soroban topics are base64-encoded XDR ScVal symbols; we do a best-effort
/// string extraction without pulling in the full XDR library.
fn topic_name(topics: &[String]) -> String {
    topics.first().cloned().unwrap_or_default()
}

const BOUNTY_EVENT_SIGNATURES: &[&str] = &[
    "bounty_created",
    "bounty_applied",
    "bounty_selected",
    "bounty_completed",
    "bounty_cancelled",
];

const FREELANCER_EVENT_SIGNATURES: &[&str] = &["freelancer_registered", "freelancer_verified"];

const ESCROW_EVENT_SIGNATURES: &[&str] =
    &["escrow_deposited", "escrow_released", "escrow_refunded"];

fn allowed_event_signatures<'a>(
    cfg: &'a Config,
    contract_id: &str,
) -> Option<&'static [&'static str]> {
    if contract_id == cfg.bounty_contract_id {
        Some(BOUNTY_EVENT_SIGNATURES)
    } else if contract_id == cfg.freelancer_contract_id {
        Some(FREELANCER_EVENT_SIGNATURES)
    } else if contract_id == cfg.escrow_contract_id {
        Some(ESCROW_EVENT_SIGNATURES)
    } else {
        None
    }
}

fn is_relevant_event(event: &SorobanEvent, cfg: &Config) -> bool {
    let name = topic_name(&event.topic);
    allowed_event_signatures(cfg, &event.contract_id)
        .map(|signatures| signatures.contains(&name.as_str()))
        .unwrap_or(false)
}

async fn process_event(pool: &PgPool, event: &SorobanEvent, cfg: &Config) -> Result<()> {
    let name = topic_name(&event.topic);

    if !is_relevant_event(event, cfg) {
        info!(
            "Skipping irrelevant event {} for contract {} with topic {}",
            event.id, event.contract_id, name
        );
        return Ok(());
    }

    if event.contract_id == cfg.bounty_contract_id {
        handle_bounty_event(pool, event, &name).await?;
    } else if event.contract_id == cfg.freelancer_contract_id {
        handle_freelancer_event(pool, event, &name).await?;
    } else if event.contract_id == cfg.escrow_contract_id {
        handle_escrow_event(pool, event, &name).await?;
    }

    // Always persist the raw event for auditability / replay
    upsert_raw_event(pool, event).await?;

    Ok(())
}

async fn handle_bounty_event(pool: &PgPool, event: &SorobanEvent, name: &str) -> Result<()> {
    // Topic conventions match what the Soroban contract would emit via env.events().publish()
    // e.g. topic: ["bounty_created"], value: { id, creator, title, budget, deadline }
    //      topic: ["bounty_applied"],  value: { bounty_id, application_id, freelancer }
    //      topic: ["bounty_selected"], value: { bounty_id, freelancer }
    //      topic: ["bounty_completed"],value: { bounty_id }
    //      topic: ["bounty_cancelled"],value: { bounty_id }
    let value: serde_json::Value =
        serde_json::from_str(&event.value).unwrap_or(serde_json::Value::Null);

    match name {
        "bounty_created" => {
            let id = value["id"].as_i64().unwrap_or(0);
            let title = value["title"].as_str().unwrap_or("").to_string();
            let budget = value["budget"].as_i64().unwrap_or(0);
            sqlx::query(
                "INSERT INTO chain_bounties (chain_id, title, budget, status, ledger, event_id)
                 VALUES ($1, $2, $3, 'OPEN', $4, $5)
                 ON CONFLICT (chain_id) DO NOTHING",
            )
            .bind(id)
            .bind(&title)
            .bind(budget)
            .bind(event.ledger as i64)
            .bind(&event.id)
            .execute(pool)
            .await?;
            info!("Indexed bounty created: id={id} title={title}");
        }
        "bounty_applied" => {
            let bounty_id = value["bounty_id"].as_i64().unwrap_or(0);
            let app_id = value["application_id"].as_i64().unwrap_or(0);
            let freelancer = value["freelancer"].as_str().unwrap_or("").to_string();
            sqlx::query(
                "INSERT INTO chain_applications (chain_id, bounty_chain_id, freelancer, status, ledger, event_id)
                 VALUES ($1, $2, $3, 'PENDING', $4, $5)
                 ON CONFLICT (chain_id) DO NOTHING",
            )
            .bind(app_id)
            .bind(bounty_id)
            .bind(&freelancer)
            .bind(event.ledger as i64)
            .bind(&event.id)
            .execute(pool)
            .await?;
            info!("Indexed application: bounty={bounty_id} app={app_id}");
        }
        "bounty_selected" => {
            let bounty_id = value["bounty_id"].as_i64().unwrap_or(0);
            sqlx::query("UPDATE chain_bounties SET status = 'IN_PROGRESS' WHERE chain_id = $1")
                .bind(bounty_id)
                .execute(pool)
                .await?;
            info!("Bounty {bounty_id} moved to IN_PROGRESS");
        }
        "bounty_completed" => {
            let bounty_id = value["bounty_id"].as_i64().unwrap_or(0);
            sqlx::query("UPDATE chain_bounties SET status = 'COMPLETED' WHERE chain_id = $1")
                .bind(bounty_id)
                .execute(pool)
                .await?;
            info!("Bounty {bounty_id} completed");
        }
        "bounty_cancelled" => {
            let bounty_id = value["bounty_id"].as_i64().unwrap_or(0);
            sqlx::query("UPDATE chain_bounties SET status = 'CANCELLED' WHERE chain_id = $1")
                .bind(bounty_id)
                .execute(pool)
                .await?;
            info!("Bounty {bounty_id} cancelled");
        }
        _ => {
            warn!("Unknown bounty event topic: {name}");
        }
    }
    Ok(())
}

async fn handle_freelancer_event(pool: &PgPool, event: &SorobanEvent, name: &str) -> Result<()> {
    let value: serde_json::Value =
        serde_json::from_str(&event.value).unwrap_or(serde_json::Value::Null);

    match name {
        "freelancer_registered" => {
            let address = value["address"].as_str().unwrap_or("").to_string();
            let discipline = value["discipline"].as_str().unwrap_or("").to_string();
            sqlx::query(
                "INSERT INTO chain_freelancers (address, discipline, verified, ledger, event_id)
                 VALUES ($1, $2, false, $3, $4)
                 ON CONFLICT (address) DO NOTHING",
            )
            .bind(&address)
            .bind(&discipline)
            .bind(event.ledger as i64)
            .bind(&event.id)
            .execute(pool)
            .await?;
            info!("Indexed freelancer registered: {address}");
        }
        "freelancer_verified" => {
            let address = value["address"].as_str().unwrap_or("").to_string();
            sqlx::query("UPDATE chain_freelancers SET verified = true WHERE address = $1")
                .bind(&address)
                .execute(pool)
                .await?;
            info!("Freelancer {address} verified");
        }
        _ => {
            warn!("Unknown freelancer event topic: {name}");
        }
    }
    Ok(())
}

async fn handle_escrow_event(pool: &PgPool, event: &SorobanEvent, name: &str) -> Result<()> {
    let value: serde_json::Value =
        serde_json::from_str(&event.value).unwrap_or(serde_json::Value::Null);

    match name {
        "escrow_deposited" => {
            let id = value["id"].as_i64().unwrap_or(0);
            let amount = value["amount"].as_i64().unwrap_or(0);
            let payer = value["payer"].as_str().unwrap_or("").to_string();
            let payee = value["payee"].as_str().unwrap_or("").to_string();
            sqlx::query(
                "INSERT INTO chain_escrows (chain_id, payer, payee, amount, status, ledger, event_id)
                 VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6)
                 ON CONFLICT (chain_id) DO NOTHING",
            )
            .bind(id)
            .bind(&payer)
            .bind(&payee)
            .bind(amount)
            .bind(event.ledger as i64)
            .bind(&event.id)
            .execute(pool)
            .await?;
            info!("Indexed escrow deposit: id={id} amount={amount}");
        }
        "escrow_released" => {
            let id = value["id"].as_i64().unwrap_or(0);
            sqlx::query("UPDATE chain_escrows SET status = 'RELEASED' WHERE chain_id = $1")
                .bind(id)
                .execute(pool)
                .await?;
            info!("Escrow {id} released");
        }
        "escrow_refunded" => {
            let id = value["id"].as_i64().unwrap_or(0);
            sqlx::query("UPDATE chain_escrows SET status = 'REFUNDED' WHERE chain_id = $1")
                .bind(id)
                .execute(pool)
                .await?;
            info!("Escrow {id} refunded");
        }
        _ => {
            warn!("Unknown escrow event topic: {name}");
        }
    }
    Ok(())
}

async fn upsert_raw_event(pool: &PgPool, event: &SorobanEvent) -> Result<()> {
    sqlx::query(
        "INSERT INTO chain_events (event_id, contract_id, ledger, ledger_closed_at, paging_token, topic, value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (event_id) DO NOTHING",
    )
    .bind(&event.id)
    .bind(&event.contract_id)
    .bind(event.ledger as i64)
    .bind(&event.ledger_closed_at)
    .bind(&event.paging_token)
    .bind(serde_json::to_string(&event.topic).unwrap_or_default())
    .bind(&event.value)
    .execute(pool)
    .await
    .context("Failed to upsert raw event")?;
    Ok(())
}

// ── Schema bootstrap ──────────────────────────────────────────────────────────

async fn ensure_schema(pool: &PgPool) -> Result<()> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS chain_events (
            event_id          TEXT PRIMARY KEY,
            contract_id       TEXT NOT NULL,
            ledger            BIGINT NOT NULL,
            ledger_closed_at  TEXT NOT NULL,
            paging_token      TEXT NOT NULL,
            topic             TEXT NOT NULL,
            value             TEXT NOT NULL,
            indexed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_chain_events_contract ON chain_events (contract_id);
        CREATE INDEX IF NOT EXISTS idx_chain_events_ledger   ON chain_events (ledger);

        CREATE TABLE IF NOT EXISTS chain_bounties (
            chain_id   BIGINT PRIMARY KEY,
            title      TEXT NOT NULL,
            budget     BIGINT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'OPEN',
            ledger     BIGINT NOT NULL,
            event_id   TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chain_applications (
            chain_id        BIGINT PRIMARY KEY,
            bounty_chain_id BIGINT NOT NULL,
            freelancer      TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'PENDING',
            ledger          BIGINT NOT NULL,
            event_id        TEXT NOT NULL,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chain_freelancers (
            address    TEXT PRIMARY KEY,
            discipline TEXT NOT NULL,
            verified   BOOLEAN NOT NULL DEFAULT FALSE,
            ledger     BIGINT NOT NULL,
            event_id   TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chain_escrows (
            chain_id   BIGINT PRIMARY KEY,
            payer      TEXT NOT NULL,
            payee      TEXT NOT NULL,
            amount     BIGINT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'ACTIVE',
            ledger     BIGINT NOT NULL,
            event_id   TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );",
    )
    .execute(pool)
    .await
    .context("Failed to bootstrap indexer schema")?;
    Ok(())
}

// ── Main loop ─────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,stellar_indexer=debug".into()),
        )
        .init();

    let cfg = Config::from_env()?;

    info!("Connecting to database…");
    let pool = PgPool::connect(&cfg.database_url)
        .await
        .context("Failed to connect to PostgreSQL")?;

    ensure_cursor_table(&pool).await?;
    ensure_schema(&pool).await?;

    // ── Service Discovery ────────────────────────────────────────────────
    let discovery = create_discovery()
        .await
        .context("Failed to initialise service discovery")?;

    let indexer_port: u16 = std::env::var("INDEXER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(9000);
    let indexer_host = std::env::var("INDEXER_HOST")
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    let service_info = ServiceInfo::new("stellar-indexer", &indexer_host, indexer_port)
        .with_tags(vec!["daemon".to_string()]);

    if let Err(e) = discovery.register(service_info).await {
        warn!("Service discovery registration failed (non-fatal): {e}");
    }

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    // Collect non-empty contract IDs
    let contract_ids: Vec<String> = [
        &cfg.bounty_contract_id,
        &cfg.freelancer_contract_id,
        &cfg.escrow_contract_id,
    ]
    .iter()
    .filter(|id| !id.is_empty())
    .map(|id| id.to_string())
    .collect();

    if contract_ids.is_empty() {
        warn!(
            "No contract IDs configured — indexer will poll but skip processing. \
               Set BOUNTY_CONTRACT_ID / FREELANCER_CONTRACT_ID / ESCROW_CONTRACT_ID."
        );
    }

    let mut cursor = load_cursor(&pool, "main").await?;
    info!("Starting indexer from ledger {cursor}");

    loop {
        let ids_ref: Vec<&str> = contract_ids.iter().map(String::as_str).collect();

        match fetch_events(&http, &cfg.rpc_url, &ids_ref, cursor, cfg.ledger_chunk).await {
            Ok(result) => {
                let latest = result.latest_ledger;
                let count = result.events.len();

                if count > 0 {
                    info!("Fetched {count} events (ledgers {cursor}..{latest})");
                }

                for event in &result.events {
                    if let Err(e) = process_event(&pool, event, &cfg).await {
                        error!("Failed to process event {}: {e:#}", event.id);
                    }
                }

                // Advance cursor past the chunk we just processed
                let next = if count > 0 {
                    result.events.last().map(|e| e.ledger + 1).unwrap_or(latest)
                } else {
                    latest
                };

                if next > cursor {
                    save_cursor(&pool, "main", next).await?;
                    cursor = next;
                }
            }
            Err(e) => {
                error!("RPC poll failed: {e:#}");
            }
        }

        tokio::time::sleep(Duration::from_secs(cfg.poll_interval_secs)).await;
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> Config {
        Config {
            database_url: "postgres://test".to_string(),
            rpc_url: "https://soroban-testnet.stellar.org".to_string(),
            bounty_contract_id: "bounty-contract".to_string(),
            freelancer_contract_id: "freelancer-contract".to_string(),
            escrow_contract_id: "escrow-contract".to_string(),
            ledger_chunk: 100,
            poll_interval_secs: 6,
        }
    }

    #[test]
    fn topic_name_returns_first_element() {
        let topics = vec!["bounty_created".to_string(), "extra".to_string()];
        assert_eq!(topic_name(&topics), "bounty_created");
    }

    #[test]
    fn topic_name_empty_returns_empty_string() {
        assert_eq!(topic_name(&[]), "");
    }

    #[test]
    fn config_defaults_are_sensible() {
        // Ensure defaults don't panic when env vars are absent
        std::env::set_var("DATABASE_URL", "postgres://test");
        let cfg = Config::from_env().unwrap();
        assert_eq!(cfg.poll_interval_secs, 6);
        assert_eq!(cfg.ledger_chunk, 100);
        assert!(cfg.rpc_url.contains("stellar.org"));
    }

    #[test]
    fn relevant_event_matches_known_contract_and_signature() {
        let cfg = test_config();
        let event = SorobanEvent {
            contract_id: cfg.bounty_contract_id.clone(),
            id: "evt-1".to_string(),
            ledger: 1,
            ledger_closed_at: "2026-03-27T00:00:00Z".to_string(),
            paging_token: "1".to_string(),
            topic: vec!["bounty_created".to_string()],
            value: "{}".to_string(),
        };

        assert!(is_relevant_event(&event, &cfg));
    }

    #[test]
    fn relevant_event_rejects_unknown_signature_for_known_contract() {
        let cfg = test_config();
        let event = SorobanEvent {
            contract_id: cfg.bounty_contract_id.clone(),
            id: "evt-2".to_string(),
            ledger: 1,
            ledger_closed_at: "2026-03-27T00:00:00Z".to_string(),
            paging_token: "1".to_string(),
            topic: vec!["unrelated_event".to_string()],
            value: "{}".to_string(),
        };

        assert!(!is_relevant_event(&event, &cfg));
    }

    #[test]
    fn relevant_event_rejects_unknown_contract() {
        let cfg = test_config();
        let event = SorobanEvent {
            contract_id: "other-contract".to_string(),
            id: "evt-3".to_string(),
            ledger: 1,
            ledger_closed_at: "2026-03-27T00:00:00Z".to_string(),
            paging_token: "1".to_string(),
            topic: vec!["bounty_created".to_string()],
            value: "{}".to_string(),
        };

        assert!(!is_relevant_event(&event, &cfg));
    }
}
