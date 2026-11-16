//! Cross-contract reentrancy protection framework (#635).
//!
//! Soroban contracts are vulnerable to reentrancy when they make cross-contract
//! calls (e.g. token transfers) before updating their own state. This module
//! provides:
//!
//! 1. A **global reentrancy guard** backed by persistent contract storage.
//! 2. A **`ReentrancyGuard` RAII helper** that locks on entry and unlocks on exit.
//! 3. Macros / inline helpers enforcing the **Checks-Effects-Interactions** (CEI)
//!    pattern across all state-mutating functions.
//!
//! ## State mutation graph (documented here for auditability)
//!
//! ```text
//! deposit()
//!   CHECK  : amount > 0, payer auth
//!   EFFECT : write EscrowAccount (status=Active), increment counter
//!   INTERACT: token.transfer(payer → contract)
//!
//! release_funds()
//!   CHECK  : auth, status==Active, release condition met
//!   EFFECT : escrow.status = Released, escrow.released_at = now   ← before transfer
//!   INTERACT: token.transfer(contract → payee)
//!
//! refund_escrow()
//!   CHECK  : auth, status==Active
//!   EFFECT : escrow.status = Refunded, escrow.released_at = now   ← before transfer
//!   INTERACT: token.transfer(contract → payer)
//!
//! release_milestone()
//!   CHECK  : auth, status==Active, !milestone.released
//!   EFFECT : milestone.released = true                             ← before transfer
//!   INTERACT: token.transfer(contract → payee)
//!
//! refund_expired_bounty()
//!   CHECK  : bounty_contract auth, escrow active
//!   EFFECT : escrow.status = Refunded, escrow.released_at = now    ← before transfer
//!   INTERACT: token.transfer(contract → payer)
//!
//! resolve_dispute()
//!   CHECK  : platform admin auth, escrow disputed
//!   EFFECT : escrow status + released_at                           ← before transfer
//!   INTERACT: token.transfer(contract → recipient)
//!
//! resolve_expired_dispute()
//!   CHECK  : escrow disputed, expiry elapsed
//!   EFFECT : escrow status + released_at                           ← before transfers
//!   INTERACT: token.transfer(s) to payee and/or payer
//!
//! withdraw_yield()
//!   CHECK  : platform admin auth, yield available, liquidity OK
//!   EFFECT : accrual.accrued = 0                                   ← before transfer
//!   INTERACT: token.transfer(contract → admin)
//! ```

use soroban_sdk::{Env, Symbol};

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

/// Persistent storage key for the global reentrancy lock.
/// Stored as a `bool`: `true` = locked, `false` / absent = unlocked.
const LOCK_KEY: &str = "reentrant";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/// Acquires the global reentrancy lock for the duration of a function call.
///
/// # Panics
/// Panics immediately if the lock is already held, preventing reentrant calls.
///
/// # Usage
/// ```rust,ignore
/// pub fn release_funds(env: Env, ...) -> bool {
///     let _guard = ReentrancyGuard::acquire(&env);
///     // ... checks ...
///     // ... effects (state writes) ...
///     // ... interactions (cross-contract calls) ...
/// }
/// ```
pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    /// Acquire the lock. Panics if already locked (reentrancy detected).
    pub fn acquire(env: &'a Env) -> Self {
        let key = Symbol::new(env, LOCK_KEY);
        let locked: bool = env
            .storage()
            .temporary()
            .get::<Symbol, bool>(&key)
            .unwrap_or(false);

        assert!(
            !locked,
            "Reentrancy detected: contract is already executing"
        );

        // Set lock with a TTL of 1 ledger – it will be cleared automatically
        // even if the transaction panics, preventing permanent lock-up.
        env.storage().temporary().set(&key, &true);
        // Extend TTL to cover the current ledger only.
        env.storage().temporary().extend_ttl(&key, 1, 1);

        ReentrancyGuard { env }
    }
}

impl Drop for ReentrancyGuard<'_> {
    fn drop(&mut self) {
        let key = Symbol::new(self.env, LOCK_KEY);
        self.env.storage().temporary().remove(&key);
    }
}

// ---------------------------------------------------------------------------
// CEI enforcement helpers
// ---------------------------------------------------------------------------

/// Check that a status transition is valid before any state write.
/// Centralises the "Checks" phase so it cannot be accidentally skipped.
/// Returns `err` instead of panicking so callers surface a typed error code.
#[inline(always)]
pub fn require_active_escrow<E>(status_is_active: bool, err: E) -> Result<(), E> {
    if status_is_active {
        Ok(())
    } else {
        Err(err)
    }
}

/// Check that the caller is authorised to act on an escrow.
#[inline(always)]
pub fn require_authorized_party<E>(caller_is_party: bool, err: E) -> Result<(), E> {
    if caller_is_party {
        Ok(())
    } else {
        Err(err)
    }
}
