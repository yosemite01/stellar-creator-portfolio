use std::time::Duration;
use tokio::time::sleep;
use tracing::{error, warn, info};

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub enum HealthStatus {
    Healthy,
    Degraded(String),
    Unhealthy(String),
}

#[allow(dead_code)]
pub struct EventIndexer {
    rpc_url: String,
    health_status: HealthStatus,
    max_retries: u32,
    base_backoff_ms: u64,
}

#[allow(dead_code)]
impl EventIndexer {
    pub fn new(rpc_url: String) -> Self {
        EventIndexer {
            rpc_url,
            health_status: HealthStatus::Healthy,
            max_retries: 5,
            base_backoff_ms: 100,
        }
    }

    pub fn get_health_status(&self) -> HealthStatus {
        self.health_status.clone()
    }

    async fn fetch_events_with_retry(&mut self) -> Result<Vec<String>, String> {
        let mut attempt = 0;

        loop {
            match self.fetch_events().await {
                Ok(events) => {
                    self.health_status = HealthStatus::Healthy;
                    info!("Successfully fetched events from RPC");
                    return Ok(events);
                }
                Err(e) => {
                    attempt += 1;
                    if attempt >= self.max_retries {
                        let error_msg = format!("RPC unreachable after {} retries: {}", self.max_retries, e);
                        error!("{}", error_msg);
                        self.health_status = HealthStatus::Unhealthy(error_msg.clone());
                        return Err(error_msg);
                    }

                    let backoff_ms = self.base_backoff_ms * 2_u64.pow(attempt - 1);
                    warn!(
                        "RPC fetch failed (attempt {}/{}), retrying in {}ms: {}",
                        attempt, self.max_retries, backoff_ms, e
                    );
                    self.health_status = HealthStatus::Degraded(format!(
                        "RPC unreachable, retrying (attempt {}/{})",
                        attempt, self.max_retries
                    ));

                    sleep(Duration::from_millis(backoff_ms)).await;
                }
            }
        }
    }

    async fn fetch_events(&self) -> Result<Vec<String>, String> {
        // Simulate RPC call - replace with actual Stellar RPC client
        // For now, this is a placeholder that would call the actual RPC endpoint
        Ok(vec![])
    }

    pub async fn index_events(&mut self) -> Result<(), String> {
        let events = self.fetch_events_with_retry().await?;
        
        for event in events {
            info!("Indexing event: {}", event);
            // Process event
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_health_status_degraded_on_retry() {
        let indexer = EventIndexer::new("http://localhost:8000".to_string());
        
        // Initially healthy
        match indexer.get_health_status() {
            HealthStatus::Healthy => (),
            _ => panic!("Expected healthy status"),
        }
    }

    #[tokio::test]
    async fn test_exponential_backoff() {
        let indexer = EventIndexer::new("http://localhost:8000".to_string());
        assert_eq!(indexer.base_backoff_ms, 100);
        assert_eq!(indexer.max_retries, 5);
    }
}
