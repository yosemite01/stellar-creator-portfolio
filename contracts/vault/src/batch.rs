// contracts/vault/src/batch.rs
// Issue #520 — Multi-Vault Batch Withdrawal
//
// Vectorised batch processor for vault withdrawals.
// Gas optimisation: a single contract invocation handles N withdrawals,
// avoiding per-withdrawal transaction overhead and network congestion.
//
// Atomicity guarantee: if any single withdrawal fails the entire batch
// is rejected via panic!, preserving consistent vault state.

#![no_std]
use soroban_sdk::{contracttype, panic_with_error, Address, Env, Vec};

/// A single withdrawal request within a batch.
#[contracttype]
#[derive(Clone)]
pub struct WithdrawalRequest {
    /// Vault owner authorising this withdrawal.
    pub owner: Address,
    /// Destination address to receive funds.
    pub recipient: Address,
    /// Token amount to withdraw (in stroops / base units).
    pub amount: i128,
}

/// Outcome for a single processed withdrawal.
#[contracttype]
#[derive(Clone)]
pub struct WithdrawalOutcome {
    pub owner: Address,
    pub amount: i128,
    pub success: bool,
}

/// Error codes for batch failures.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum BatchError {
    EmptyBatch = 1,
    ZeroAmount = 2,
    InsufficientBalance = 3,
}

impl soroban_sdk::contracterror::ContractError for BatchError {
    fn from_val(v: u32) -> Option<Self> {
        match v {
            1 => Some(Self::EmptyBatch),
            2 => Some(Self::ZeroAmount),
            3 => Some(Self::InsufficientBalance),
            _ => None,
        }
    }
}

/// Process a batch of withdrawal requests atomically.
///
/// # Gas optimisation
/// All balance reads and writes are performed in a single loop pass.
/// Auth is required once per owner via `require_auth()` — Soroban
/// deduplicates auth checks for the same address within one invocation.
///
/// # Atomicity
/// Any validation failure panics immediately, rolling back all state
/// changes made so far in this invocation.
pub fn process_batch(
    env: &Env,
    requests: Vec<WithdrawalRequest>,
    get_balance: impl Fn(&Env, &Address) -> i128,
    set_balance: impl Fn(&Env, &Address, i128),
) -> Vec<WithdrawalOutcome> {
    if requests.is_empty() {
        panic_with_error!(env, BatchError::EmptyBatch);
    }

    let mut outcomes: Vec<WithdrawalOutcome> = Vec::new(env);

    for req in requests.iter() {
        // Require each owner to have authorised this invocation.
        req.owner.require_auth();

        if req.amount <= 0 {
            panic_with_error!(env, BatchError::ZeroAmount);
        }

        let current = get_balance(env, &req.owner);
        if current < req.amount {
            panic_with_error!(env, BatchError::InsufficientBalance);
        }

        // Debit vault balance.
        set_balance(env, &req.owner, current - req.amount);

        // Emit withdrawal event for indexer.
        env.events().publish(
            (soroban_sdk::symbol_short!("withdraw"), req.owner.clone()),
            (req.recipient.clone(), req.amount),
        );

        outcomes.push_back(WithdrawalOutcome {
            owner: req.owner.clone(),
            amount: req.amount,
            success: true,
        });
    }

    outcomes
}
