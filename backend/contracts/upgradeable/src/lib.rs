#![no_std]
// `Events::publish` and `update_current_contract_wasm` are deprecated in
// soroban-sdk 23+. Moving to `#[contractevent]` changes the on-chain topic/data
// layout that indexers decode (see the event docs on each function), so keep
// the existing calls until that migration is done for all contracts at once.
#![allow(deprecated)]

//! Shared upgrade and admin-transfer pattern for the canonical contracts
//! (Issue #1564).
//!
//! Before this crate, every contract had an `upgrade(admin, wasm_hash)`
//! entrypoint that swapped the code **immediately**, and admin rotation was
//! either impossible or a one-shot `set_admin`. A single leaked admin key could
//! therefore replace contract logic in one transaction with no warning to
//! users. This module replaces that with:
//!
//! * **Timelocked upgrades** — `propose_upgrade` records the new wasm hash and
//!   emits `(upgrade, proposed)`; `execute_upgrade` only succeeds once
//!   [`UPGRADE_TIMELOCK_SECS`] have elapsed. `cancel_upgrade` lets the admin
//!   withdraw a proposal. Users and indexers see every pending code change at
//!   least 48h before it can land.
//! * **Two-step admin transfer** — `propose_admin` nominates a successor and
//!   `accept_admin` must be signed by that successor, so the admin can never
//!   be handed to a mistyped or uncontrolled address.
//!
//! This is a plain library (not a `#[contract]`): contracts keep their own
//! admin storage and expose thin entrypoints that load the stored admin and
//! delegate here. It lives in its own crate rather than in `core` because
//! linking one contract crate into another collides on exported entrypoints.
//!
//! See `docs/contracts.md (Upgrading a live contract)` for the integrator-facing spec.

use soroban_sdk::{
    contracterror, contracttype, panic_with_error, symbol_short, Address, BytesN, Env,
};

/// Minimum delay between `propose_upgrade` and `execute_upgrade` (48 hours).
pub const UPGRADE_TIMELOCK_SECS: u64 = 48 * 60 * 60;

/// TTL bump for pending-state entries (~30 days of 5s ledgers).
const LEDGER_TTL: u32 = 30 * 24 * 3600 / 5;
const LEDGER_TTL_THRESHOLD: u32 = 4096;

/// Errors raised by the shared upgrade/admin helpers.
///
/// Codes start at 900 so they don't overlap any contract's own error enum;
/// they surface on-chain as `Error(Contract, #9xx)`.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum UpgradeError {
    /// Caller is not the stored admin.
    Unauthorized = 900,
    /// `execute_upgrade` / `cancel_upgrade` called with nothing pending.
    NoPendingUpgrade = 901,
    /// `execute_upgrade` called before `executable_at`.
    TimelockNotElapsed = 902,
    /// `accept_admin` / `cancel_admin_transfer` called with nothing pending.
    NoPendingAdmin = 903,
    /// `accept_admin` signed by an address other than the nominee.
    NotPendingAdmin = 904,
    /// `propose_admin` nominated the current admin.
    SameAdmin = 905,
}

/// Storage keys owned by this module. Variant names are prefixed so they can
/// never collide with a contract's own `DataKey` variants.
#[contracttype]
#[derive(Clone)]
pub enum UpgradeKey {
    UpgPendingUpgrade,
    UpgPendingAdmin,
}

/// A proposed code upgrade waiting out its timelock.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingUpgrade {
    pub wasm_hash: BytesN<32>,
    pub proposed_at: u64,
    pub executable_at: u64,
}

fn require_admin(env: &Env, caller: &Address, stored_admin: &Address) {
    caller.require_auth();
    if caller != stored_admin {
        panic_with_error!(env, UpgradeError::Unauthorized);
    }
}

// ── Upgrades ─────────────────────────────────────────────────────────────────

/// Record `wasm_hash` as the pending upgrade. Replaces any earlier proposal
/// (and restarts the timelock). Returns the timestamp after which
/// [`execute_upgrade`] will succeed.
///
/// Event: `(upgrade, proposed)` → `(wasm_hash, executable_at)`.
pub fn propose_upgrade(
    env: &Env,
    caller: &Address,
    stored_admin: &Address,
    wasm_hash: BytesN<32>,
) -> u64 {
    require_admin(env, caller, stored_admin);

    let now = env.ledger().timestamp();
    let executable_at = now.saturating_add(UPGRADE_TIMELOCK_SECS);
    let key = UpgradeKey::UpgPendingUpgrade;
    env.storage().persistent().set(
        &key,
        &PendingUpgrade {
            wasm_hash: wasm_hash.clone(),
            proposed_at: now,
            executable_at,
        },
    );
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL);

    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("proposed")),
        (wasm_hash, executable_at),
    );
    executable_at
}

/// Swap in the pending wasm once its timelock has elapsed.
///
/// Event: `(contract, upgraded)` → `wasm_hash` (same shape as the old
/// instant `upgrade` entrypoint, so existing indexer mappings keep working).
pub fn execute_upgrade(env: &Env, caller: &Address, stored_admin: &Address) {
    require_admin(env, caller, stored_admin);

    let key = UpgradeKey::UpgPendingUpgrade;
    let pending: PendingUpgrade = match env.storage().persistent().get(&key) {
        Some(p) => p,
        None => panic_with_error!(env, UpgradeError::NoPendingUpgrade),
    };
    if env.ledger().timestamp() < pending.executable_at {
        panic_with_error!(env, UpgradeError::TimelockNotElapsed);
    }

    env.storage().persistent().remove(&key);
    env.deployer()
        .update_current_contract_wasm(pending.wasm_hash.clone());

    env.events().publish(
        (symbol_short!("contract"), symbol_short!("upgraded")),
        pending.wasm_hash,
    );
}

/// Withdraw the pending upgrade.
///
/// Event: `(upgrade, cancelled)` → `wasm_hash`.
pub fn cancel_upgrade(env: &Env, caller: &Address, stored_admin: &Address) {
    require_admin(env, caller, stored_admin);

    let key = UpgradeKey::UpgPendingUpgrade;
    let pending: PendingUpgrade = match env.storage().persistent().get(&key) {
        Some(p) => p,
        None => panic_with_error!(env, UpgradeError::NoPendingUpgrade),
    };
    env.storage().persistent().remove(&key);

    env.events().publish(
        (symbol_short!("upgrade"), symbol_short!("cancelled")),
        pending.wasm_hash,
    );
}

/// The upgrade currently waiting out its timelock, if any.
pub fn pending_upgrade(env: &Env) -> Option<PendingUpgrade> {
    env.storage().persistent().get(&UpgradeKey::UpgPendingUpgrade)
}

// ── Two-step admin transfer ──────────────────────────────────────────────────

/// Nominate `new_admin`. Takes effect only when `new_admin` calls
/// [`accept_admin`]. Replaces any earlier nomination.
///
/// Event: `(admin, proposed)` → `(current_admin, new_admin)`.
pub fn propose_admin(env: &Env, caller: &Address, stored_admin: &Address, new_admin: &Address) {
    require_admin(env, caller, stored_admin);
    if new_admin == stored_admin {
        panic_with_error!(env, UpgradeError::SameAdmin);
    }

    let key = UpgradeKey::UpgPendingAdmin;
    env.storage().persistent().set(&key, new_admin);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL);

    env.events().publish(
        (symbol_short!("admin"), symbol_short!("proposed")),
        (stored_admin.clone(), new_admin.clone()),
    );
}

/// Complete a transfer. Must be signed by the nominee. Returns the new admin;
/// the calling contract is responsible for writing it to its own admin slot.
///
/// Event: `(admin, accepted)` → `(previous_admin, new_admin)`.
pub fn accept_admin(env: &Env, new_admin: &Address, stored_admin: &Address) -> Address {
    new_admin.require_auth();

    let key = UpgradeKey::UpgPendingAdmin;
    let pending: Address = match env.storage().persistent().get(&key) {
        Some(a) => a,
        None => panic_with_error!(env, UpgradeError::NoPendingAdmin),
    };
    if pending != *new_admin {
        panic_with_error!(env, UpgradeError::NotPendingAdmin);
    }
    env.storage().persistent().remove(&key);

    env.events().publish(
        (symbol_short!("admin"), symbol_short!("accepted")),
        (stored_admin.clone(), new_admin.clone()),
    );
    pending
}

/// Withdraw a pending nomination.
///
/// Event: `(admin, cancelled)` → `nominee`.
pub fn cancel_admin_transfer(env: &Env, caller: &Address, stored_admin: &Address) {
    require_admin(env, caller, stored_admin);

    let key = UpgradeKey::UpgPendingAdmin;
    let pending: Address = match env.storage().persistent().get(&key) {
        Some(a) => a,
        None => panic_with_error!(env, UpgradeError::NoPendingAdmin),
    };
    env.storage().persistent().remove(&key);

    env.events().publish(
        (symbol_short!("admin"), symbol_short!("cancelled")),
        pending,
    );
}

/// The nominated-but-not-yet-accepted admin, if any.
pub fn pending_admin(env: &Env) -> Option<Address> {
    env.storage().persistent().get(&UpgradeKey::UpgPendingAdmin)
}
