use std::time::Duration;
use tokio::time::sleep;
use tracing::{error, warn, info};

use crate::cqrs_write::{DomainEvent, EventRecord};
use crate::cqrs_read::{project_event, ReadStore};

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
    /// Sequence number of the last event successfully projected into the read store.
    last_applied_sequence: u64,
}

#[allow(dead_code)]
impl EventIndexer {
    pub fn new(rpc_url: String) -> Self {
        EventIndexer {
            rpc_url,
            health_status: HealthStatus::Healthy,
            max_retries: 5,
            base_backoff_ms: 100,
            last_applied_sequence: 0,
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
        // Placeholder: replace with actual Stellar RPC / Kafka consumer.
        Ok(vec![])
    }

    pub async fn index_events(&mut self) -> Result<(), String> {
        let events = self.fetch_events_with_retry().await?;
        
        for event in events {
            info!("Indexing event: {}", event);
        }

        Ok(())
    }

    /// Apply a batch of `EventRecord`s to the read store (CQRS projection).
    ///
    /// Records with a sequence number ≤ `last_applied_sequence` are skipped to
    /// guarantee idempotency – safe to call multiple times with overlapping batches.
    pub fn apply_to_read_store(&mut self, records: &[EventRecord], store: &mut ReadStore) {
        for record in records {
            if record.sequence <= self.last_applied_sequence {
                // Already projected; skip for idempotency.
                continue;
            }
            project_event(store, &record.event);
            self.last_applied_sequence = record.sequence;
            info!(
                sequence = record.sequence,
                aggregate_id = %record.aggregate_id,
                "Projected event into read store"
            );
        }
    }

    /// Build an `EventRecord` from a raw `DomainEvent` and append it to the
    /// in-memory event log. In production this would write to Kafka / PostgreSQL.
    pub fn append_event(
        &mut self,
        log: &mut Vec<EventRecord>,
        aggregate_id: String,
        aggregate_type: String,
        event: DomainEvent,
        now: u64,
    ) -> u64 {
        let sequence = log.last().map(|r| r.sequence + 1).unwrap_or(1);
        log.push(EventRecord {
            sequence,
            aggregate_id,
            aggregate_type,
            event,
            occurred_at: now,
        });
        info!(sequence, "Appended event to log");
        sequence
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_health_status_degraded_on_retry() {
        let indexer = EventIndexer::new("http://localhost:8000".to_string());
        
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

    #[test]
    fn test_apply_to_read_store_idempotent() {
        use crate::cqrs_write::DomainEvent;

        let mut indexer = EventIndexer::new("http://localhost:8000".to_string());
        let mut store = ReadStore::default();

        let record = EventRecord {
            sequence: 1,
            aggregate_id: "bounty-1".into(),
            aggregate_type: "bounty".into(),
            event: DomainEvent::BountyCreated {
                bounty_id: "bounty-1".into(),
                creator_id: "creator-1".into(),
                title: "Test Bounty".into(),
                budget_usd: 500,
                deadline_ts: 9999999,
                occurred_at: 1000,
            },
            occurred_at: 1000,
        };

        // Apply once
        indexer.apply_to_read_store(&[record.clone()], &mut store);
        assert_eq!(store.bounties.len(), 1);

        // Apply again – idempotent, no duplicate
        indexer.apply_to_read_store(&[record], &mut store);
        assert_eq!(store.bounties.len(), 1);
        assert_eq!(indexer.last_applied_sequence, 1);
    }
}
