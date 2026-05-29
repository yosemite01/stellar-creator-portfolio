//! CQRS Read Model – Query side (#636).
//!
//! Read models are denormalised projections built by replaying `DomainEvent`s.
//! They are optimised for query patterns and are completely separate from the
//! write model. Eventual consistency is the contract: projections may lag
//! behind the event log by a small number of ledger confirmations.
//!
//! Projections are updated by the `EventProjector` which subscribes to the
//! event log (Kafka topic or in-process channel) and applies each event.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::cqrs_write::DomainEvent;

// ---------------------------------------------------------------------------
// Read model projections
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BountyView {
    pub bounty_id: String,
    pub creator_id: String,
    pub title: String,
    pub budget_usd: u64,
    pub deadline_ts: u64,
    pub status: String,
    pub selected_freelancer_id: Option<String>,
    pub application_count: u32,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreatorReputationView {
    pub creator_id: String,
    pub total_reviews: u32,
    pub average_rating: f64,
    pub completed_bounties: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EscrowView {
    pub escrow_id: String,
    pub bounty_id: String,
    pub payer_id: String,
    pub payee_id: String,
    pub amount_usd: u64,
    pub status: String,
    pub created_at: u64,
    pub settled_at: Option<u64>,
}

// ---------------------------------------------------------------------------
// In-memory projection store (replace with Prisma / sqlx in production)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct ReadStore {
    pub bounties: HashMap<String, BountyView>,
    pub reputations: HashMap<String, CreatorReputationView>,
    pub escrows: HashMap<String, EscrowView>,
}

// ---------------------------------------------------------------------------
// Event projector
// ---------------------------------------------------------------------------

/// Applies a single `DomainEvent` to the read store, updating the relevant
/// projection(s). This function is idempotent when called with the same event
/// sequence number (callers should track the last applied sequence).
pub fn project_event(store: &mut ReadStore, event: &DomainEvent) {
    match event {
        DomainEvent::BountyCreated {
            bounty_id, creator_id, title, budget_usd, deadline_ts, occurred_at,
        } => {
            store.bounties.insert(
                bounty_id.clone(),
                BountyView {
                    bounty_id: bounty_id.clone(),
                    creator_id: creator_id.clone(),
                    title: title.clone(),
                    budget_usd: *budget_usd,
                    deadline_ts: *deadline_ts,
                    status: "open".into(),
                    created_at: *occurred_at,
                    ..Default::default()
                },
            );
        }

        DomainEvent::BountyApplicationReceived { bounty_id, .. } => {
            if let Some(b) = store.bounties.get_mut(bounty_id) {
                b.application_count += 1;
            }
        }

        DomainEvent::FreelancerSelected { bounty_id, application_id, .. } => {
            if let Some(b) = store.bounties.get_mut(bounty_id) {
                b.status = "in_progress".into();
                b.selected_freelancer_id = Some(application_id.clone());
            }
        }

        DomainEvent::BountyCompleted { bounty_id, occurred_at } => {
            if let Some(b) = store.bounties.get_mut(bounty_id) {
                b.status = "completed".into();
                b.completed_at = Some(*occurred_at);
            }
        }

        DomainEvent::EscrowDeposited {
            escrow_id, bounty_id, payer_id, payee_id, amount_usd, occurred_at,
        } => {
            store.escrows.insert(
                escrow_id.clone(),
                EscrowView {
                    escrow_id: escrow_id.clone(),
                    bounty_id: bounty_id.clone(),
                    payer_id: payer_id.clone(),
                    payee_id: payee_id.clone(),
                    amount_usd: *amount_usd,
                    status: "active".into(),
                    created_at: *occurred_at,
                    settled_at: None,
                },
            );
        }

        DomainEvent::EscrowReleased { escrow_id, occurred_at, .. } => {
            if let Some(e) = store.escrows.get_mut(escrow_id) {
                e.status = "released".into();
                e.settled_at = Some(*occurred_at);
            }
        }

        DomainEvent::EscrowRefunded { escrow_id, occurred_at, .. } => {
            if let Some(e) = store.escrows.get_mut(escrow_id) {
                e.status = "refunded".into();
                e.settled_at = Some(*occurred_at);
            }
        }

        DomainEvent::ReviewSubmitted { creator_id, rating, .. } => {
            let rep = store
                .reputations
                .entry(creator_id.clone())
                .or_insert_with(|| CreatorReputationView {
                    creator_id: creator_id.clone(),
                    ..Default::default()
                });
            // Incremental average: new_avg = (old_avg * n + rating) / (n + 1)
            let n = rep.total_reviews as f64;
            rep.average_rating = (rep.average_rating * n + *rating as f64) / (n + 1.0);
            rep.total_reviews += 1;
        }

        // Variants handled elsewhere or not yet projected.
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

impl ReadStore {
    /// Return open bounties sorted by creation time (newest first).
    pub fn open_bounties(&self) -> Vec<&BountyView> {
        let mut result: Vec<&BountyView> = self
            .bounties
            .values()
            .filter(|b| b.status == "open")
            .collect();
        result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        result
    }

    /// Return the reputation view for a creator, if it exists.
    pub fn creator_reputation(&self, creator_id: &str) -> Option<&CreatorReputationView> {
        self.reputations.get(creator_id)
    }
}
