//! CQRS Write Model – Command side (#636).
//!
//! All state mutations flow through typed `Command` variants. Each command
//! produces one or more `DomainEvent`s that are appended to the event log.
//! The write model never reads from the read-optimised projection tables.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    CreateBounty {
        bounty_id: String,
        creator_id: String,
        title: String,
        budget_usd: u64,
        deadline_ts: u64,
    },
    ApplyForBounty {
        application_id: String,
        bounty_id: String,
        freelancer_id: String,
        proposed_budget_usd: u64,
    },
    SelectFreelancer {
        bounty_id: String,
        application_id: String,
    },
    CompleteBounty {
        bounty_id: String,
    },
    DepositEscrow {
        escrow_id: String,
        bounty_id: String,
        payer_id: String,
        payee_id: String,
        amount_usd: u64,
    },
    ReleaseEscrow {
        escrow_id: String,
        authorizer_id: String,
    },
    RefundEscrow {
        escrow_id: String,
        authorizer_id: String,
    },
    SubmitReview {
        review_id: String,
        bounty_id: String,
        creator_id: String,
        rating: u8,
        zk_proof: String,
        zk_nullifier: String,
    },
}

// ---------------------------------------------------------------------------
// Domain events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", rename_all = "snake_case")]
pub enum DomainEvent {
    BountyCreated {
        bounty_id: String,
        creator_id: String,
        title: String,
        budget_usd: u64,
        deadline_ts: u64,
        occurred_at: u64,
    },
    BountyApplicationReceived {
        application_id: String,
        bounty_id: String,
        freelancer_id: String,
        proposed_budget_usd: u64,
        occurred_at: u64,
    },
    FreelancerSelected {
        bounty_id: String,
        application_id: String,
        occurred_at: u64,
    },
    BountyCompleted {
        bounty_id: String,
        occurred_at: u64,
    },
    EscrowDeposited {
        escrow_id: String,
        bounty_id: String,
        payer_id: String,
        payee_id: String,
        amount_usd: u64,
        occurred_at: u64,
    },
    EscrowReleased {
        escrow_id: String,
        authorizer_id: String,
        occurred_at: u64,
    },
    EscrowRefunded {
        escrow_id: String,
        authorizer_id: String,
        occurred_at: u64,
    },
    ReviewSubmitted {
        review_id: String,
        bounty_id: String,
        creator_id: String,
        rating: u8,
        zk_nullifier: String,
        occurred_at: u64,
    },
}

// ---------------------------------------------------------------------------
// Event log entry (persisted to the append-only store)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventRecord {
    /// Monotonically increasing sequence number.
    pub sequence: u64,
    /// Aggregate identifier (e.g. bounty_id, escrow_id).
    pub aggregate_id: String,
    /// Aggregate type for routing to the correct projector.
    pub aggregate_type: String,
    /// The serialised domain event.
    pub event: DomainEvent,
    /// Wall-clock timestamp (Unix seconds).
    pub occurred_at: u64,
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/// Validates a command and converts it into the corresponding domain event(s).
///
/// In a full implementation this would load aggregate state from the event log,
/// apply business rules, and return the new events to be appended. Here we
/// produce one event per command for clarity.
pub fn handle_command(cmd: Command, now: u64) -> Result<Vec<DomainEvent>, &'static str> {
    let events = match cmd {
        Command::CreateBounty { bounty_id, creator_id, title, budget_usd, deadline_ts } => {
            vec![DomainEvent::BountyCreated {
                bounty_id,
                creator_id,
                title,
                budget_usd,
                deadline_ts,
                occurred_at: now,
            }]
        }
        Command::ApplyForBounty { application_id, bounty_id, freelancer_id, proposed_budget_usd } => {
            vec![DomainEvent::BountyApplicationReceived {
                application_id,
                bounty_id,
                freelancer_id,
                proposed_budget_usd,
                occurred_at: now,
            }]
        }
        Command::SelectFreelancer { bounty_id, application_id } => {
            vec![DomainEvent::FreelancerSelected { bounty_id, application_id, occurred_at: now }]
        }
        Command::CompleteBounty { bounty_id } => {
            vec![DomainEvent::BountyCompleted { bounty_id, occurred_at: now }]
        }
        Command::DepositEscrow { escrow_id, bounty_id, payer_id, payee_id, amount_usd } => {
            vec![DomainEvent::EscrowDeposited {
                escrow_id,
                bounty_id,
                payer_id,
                payee_id,
                amount_usd,
                occurred_at: now,
            }]
        }
        Command::ReleaseEscrow { escrow_id, authorizer_id } => {
            vec![DomainEvent::EscrowReleased { escrow_id, authorizer_id, occurred_at: now }]
        }
        Command::RefundEscrow { escrow_id, authorizer_id } => {
            vec![DomainEvent::EscrowRefunded { escrow_id, authorizer_id, occurred_at: now }]
        }
        Command::SubmitReview { review_id, bounty_id, creator_id, rating, zk_proof: _, zk_nullifier } => {
            if rating == 0 || rating > 5 {
                return Err("Rating must be between 1 and 5");
            }
            vec![DomainEvent::ReviewSubmitted {
                review_id,
                bounty_id,
                creator_id,
                rating,
                zk_nullifier,
                occurred_at: now,
            }]
        }
    };

    Ok(events)
}
