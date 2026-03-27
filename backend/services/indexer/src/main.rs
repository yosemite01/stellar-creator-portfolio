use backoff::{ExponentialBackoff, ExponentialBackoffBuilder};
use backoff::future::retry;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use tracing::{error, info, warn};

#[derive(Error, Debug)]
pub enum IndexerError {
    #[error("RPC call failed: {0}")]
    RpcError(String),
    
    #[error("Database error: {0}")]
    DatabaseError(String),
    
    #[error("Parsing error: {0}")]
    ParseError(String),
    
    #[error("Network error: {0}")]
    NetworkError(String),
    
    #[error("Permanent failure: {0}")]
    PermanentError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockEvent {
    pub block_number: u64,
    pub transaction_hash: String,
    pub event_type: String,
    pub contract_id: String,
    pub data: serde_json::Value,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeadLetterQueueItem {
    pub id: String,
    pub event: BlockEvent,
    pub error: String,
    pub retry_count: u32,
    pub first_failed_at: u64,
    pub last_failed_at: u64,
}

pub struct RetryConfig {
    pub max_retries: u32,
    pub initial_interval: Duration,
    pub max_interval: Duration,
    pub multiplier: f64,
    pub max_elapsed_time: Option<Duration>,
}

impl Default for RetryConfig {
    fn default() -> Self {
        RetryConfig {
            max_retries: 5,
            initial_interval: Duration::from_millis(500),
            max_interval: Duration::from_secs(60),
            multiplier: 2.0,
            max_elapsed_time: Some(Duration::from_secs(300)), // 5 minutes
        }
    }
}

impl RetryConfig {
    pub fn to_backoff(&self) -> ExponentialBackoff {
        ExponentialBackoffBuilder::new()
            .with_initial_interval(self.initial_interval)
            .with_max_interval(self.max_interval)
            .with_multiplier(self.multiplier)
            .with_max_elapsed_time(self.max_elapsed_time)
            .build()
    }
}

pub struct IndexerService {
    retry_config: RetryConfig,
    dead_letter_queue: Vec<DeadLetterQueueItem>,
}

impl IndexerService {
    pub fn new(retry_config: RetryConfig) -> Self {
        IndexerService {
            retry_config,
            dead_letter_queue: Vec::new(),
        }
    }
    
    /// Fetch events from RPC with retry logic
    pub async fn fetch_events_with_retry(
        &self,
        block_number: u64,
    ) -> Result<Vec<BlockEvent>, IndexerError> {
        let backoff = self.retry_config.to_backoff();
        
        let operation = || async {
            match self.fetch_events_from_rpc(block_number).await {
                Ok(events) => Ok(events),
                Err(e) => {
                    match &e {
                        IndexerError::PermanentError(_) => {
                            // Don't retry permanent errors
                            Err(backoff::Error::Permanent(e))
                        }
                        _ => {
                            warn!("Transient error fetching events for block {}: {}. Retrying...", 
                                  block_number, e);
                            Err(backoff::Error::Transient {
                                err: e,
                                retry_after: None,
                            })
                        }
                    }
                }
            }
        };
        
        retry(backoff, operation).await.map_err(|e| {
            error!("Failed to fetch events after retries: {:?}", e);
            IndexerError::RpcError(format!("Max retries exceeded: {:?}", e))
        })
    }
    
    /// Store events in database with retry logic
    pub async fn store_events_with_retry(
        &self,
        events: Vec<BlockEvent>,
    ) -> Result<(), IndexerError> {
        let backoff = self.retry_config.to_backoff();
        
        let operation = || async {
            match self.store_events_in_db(&events).await {
                Ok(_) => Ok(()),
                Err(e) => {
                    match &e {
                        IndexerError::PermanentError(_) => {
                            Err(backoff::Error::Permanent(e))
                        }
                        _ => {
                            warn!("Transient error storing events: {}. Retrying...", e);
                            Err(backoff::Error::Transient {
                                err: e,
                                retry_after: None,
                            })
                        }
                    }
                }
            }
        };
        
        retry(backoff, operation).await.map_err(|e| {
            error!("Failed to store events after retries: {:?}", e);
            IndexerError::DatabaseError(format!("Max retries exceeded: {:?}", e))
        })
    }
    
    /// Process a block with comprehensive retry logic
    pub async fn process_block_with_retry(
        &mut self,
        block_number: u64,
    ) -> Result<(), IndexerError> {
        info!("Processing block {} with retry logic", block_number);
        
        // Fetch events with retry
        let events = match self.fetch_events_with_retry(block_number).await {
            Ok(events) => events,
            Err(e) => {
                error!("Failed to fetch events for block {}: {}", block_number, e);
                return Err(e);
            }
        };
        
        if events.is_empty() {
            info!("No events in block {}", block_number);
            return Ok(());
        }
        
        info!("Fetched {} events from block {}", events.len(), block_number);
        
        // Store events with retry
        match self.store_events_with_retry(events.clone()).await {
            Ok(_) => {
                info!("Successfully stored {} events from block {}", events.len(), block_number);
                Ok(())
            }
            Err(e) => {
                error!("Failed to store events for block {}: {}", block_number, e);
                
                // Add to dead letter queue
                for event in events {
                    self.add_to_dead_letter_queue(event, e.to_string());
                }
                
                Err(e)
            }
        }
    }
    
    /// Add failed event to dead letter queue
    fn add_to_dead_letter_queue(&mut self, event: BlockEvent, error: String) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let dlq_item = DeadLetterQueueItem {
            id: format!("{}-{}", event.block_number, event.transaction_hash),
            event,
            error,
            retry_count: 0,
            first_failed_at: now,
            last_failed_at: now,
        };
        
        self.dead_letter_queue.push(dlq_item);
        warn!("Added event to dead letter queue. Queue size: {}", self.dead_letter_queue.len());
    }
    
    /// Process dead letter queue items
    pub async fn process_dead_letter_queue(&mut self) -> Result<usize, IndexerError> {
        if self.dead_letter_queue.is_empty() {
            return Ok(0);
        }
        
        info!("Processing {} items from dead letter queue", self.dead_letter_queue.len());
        
        let mut processed = 0;
        let mut failed_items = Vec::new();
        
        for mut item in self.dead_letter_queue.drain(..) {
            item.retry_count += 1;
            item.last_failed_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            
            match self.store_events_with_retry(vec![item.event.clone()]).await {
                Ok(_) => {
                    info!("Successfully processed DLQ item: {}", item.id);
                    processed += 1;
                }
                Err(e) => {
                    error!("Failed to process DLQ item {}: {}", item.id, e);
                    
                    if item.retry_count < self.retry_config.max_retries {
                        failed_items.push(item);
                    } else {
                        error!("DLQ item {} exceeded max retries, discarding", item.id);
                    }
                }
            }
        }
        
        self.dead_letter_queue = failed_items;
        Ok(processed)
    }
    
    /// Get dead letter queue statistics
    pub fn get_dlq_stats(&self) -> serde_json::Value {
        serde_json::json!({
            "total_items": self.dead_letter_queue.len(),
            "oldest_item": self.dead_letter_queue.first().map(|i| i.first_failed_at),
            "newest_item": self.dead_letter_queue.last().map(|i| i.first_failed_at),
        })
    }
    
    // Simulated RPC call (to be replaced with actual Stellar RPC client)
    async fn fetch_events_from_rpc(&self, block_number: u64) -> Result<Vec<BlockEvent>, IndexerError> {
        // Simulate network call
        tokio::time::sleep(Duration::from_millis(100)).await;
        
        // Simulate occasional failures for testing
        if block_number % 10 == 0 {
            return Err(IndexerError::NetworkError("Simulated network timeout".to_string()));
        }
        
        // Return mock events
        Ok(vec![
            BlockEvent {
                block_number,
                transaction_hash: format!("tx_{}", block_number),
                event_type: "BountyCreated".to_string(),
                contract_id: "CONTRACT123".to_string(),
                data: serde_json::json!({"bounty_id": block_number}),
                timestamp: block_number * 5,
            }
        ])
    }
    
    // Simulated database write (to be replaced with actual SQLx calls)
    async fn store_events_in_db(&self, events: &[BlockEvent]) -> Result<(), IndexerError> {
        // Simulate database write
        tokio::time::sleep(Duration::from_millis(50)).await;
        
        // Simulate occasional database errors
        if events.len() > 5 {
            return Err(IndexerError::DatabaseError("Connection pool exhausted".to_string()));
        }
        
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "info,stellar_indexer=debug".to_string()),
        )
        .init();

    info!("🔍 Stellar Indexer Service Starting...");
    info!("Features: Exponential backoff retry, Dead letter queue");
    
    let retry_config = RetryConfig {
        max_retries: 5,
        initial_interval: Duration::from_millis(500),
        max_interval: Duration::from_secs(30),
        multiplier: 2.0,
        max_elapsed_time: Some(Duration::from_secs(300)),
    };
    
    let mut indexer = IndexerService::new(retry_config);
    
    info!("Starting block processing...");
    
    // Process blocks 1-20 as example
    for block_number in 1..=20 {
        match indexer.process_block_with_retry(block_number).await {
            Ok(_) => info!("✓ Block {} processed successfully", block_number),
            Err(e) => error!("✗ Block {} failed: {}", block_number, e),
        }
        
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    
    // Process dead letter queue
    info!("Processing dead letter queue...");
    match indexer.process_dead_letter_queue().await {
        Ok(processed) => info!("Processed {} items from DLQ", processed),
        Err(e) => error!("DLQ processing failed: {}", e),
    }
    
    info!("DLQ Stats: {}", indexer.get_dlq_stats());
    info!("Indexer service completed");
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_retry_config_default() {
        let config = RetryConfig::default();
        assert_eq!(config.max_retries, 5);
        assert_eq!(config.initial_interval, Duration::from_millis(500));
    }

    #[tokio::test]
    async fn test_indexer_creation() {
        let config = RetryConfig::default();
        let indexer = IndexerService::new(config);
        assert_eq!(indexer.dead_letter_queue.len(), 0);
    }

    #[tokio::test]
    async fn test_dlq_stats_empty() {
        let config = RetryConfig::default();
        let indexer = IndexerService::new(config);
        let stats = indexer.get_dlq_stats();
        assert_eq!(stats["total_items"], 0);
    }

    #[test]
    fn test_block_event_serialization() {
        let event = BlockEvent {
            block_number: 123,
            transaction_hash: "tx_123".to_string(),
            event_type: "Test".to_string(),
            contract_id: "CONTRACT".to_string(),
            data: serde_json::json!({"test": "data"}),
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("tx_123"));
    }
}
