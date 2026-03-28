use anyhow::{Context, Result};

pub struct Config {
    pub database_url: String,
    pub rpc_url: String,
    pub bounty_contract_id: String,
    pub freelancer_contract_id: String,
    pub escrow_contract_id: String,
    /// How many ledgers to fetch per poll
    pub ledger_chunk: u32,
    /// Seconds between polls
    pub poll_interval_secs: u64,
}

impl Config {
    pub fn from_env() -> Result<Self> {
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
