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

// ── Shared conformance tests (Issue #1719) ───────────────────────────────────

/// Generates the standard upgrade-timelock conformance tests for a contract
/// that exposes the shared `propose_upgrade` / `execute_upgrade` /
/// `cancel_upgrade` / `get_pending_upgrade` entrypoints.
///
/// Every canonical contract invokes this once so "execute before the delay
/// fails" is proven per contract, not just for the library:
///
/// ```ignore
/// stellar_upgradeable::upgrade_timelock_tests!(
///     upgrade_conformance, MyContract, MyContractClient,
///     |env, id, admin| { MyContractClient::new(&env, &id).initialize(&admin); }
/// );
/// ```
///
/// The init block receives the `Env`, the registered contract id and the
/// admin address, and must leave the contract with `admin` as its upgrade
/// authority.
#[macro_export]
macro_rules! upgrade_timelock_tests {
    ($mod_name:ident, $contract:expr, $client:ident, |$env:ident, $id:ident, $admin:ident| $init:block) => {
        $crate::upgrade_timelock_tests!(@inner $mod_name, $client, $env, $id, $admin,
            $env.register($contract, ()), $init);
    };
    // For contracts whose `__constructor(admin)` sets the upgrade authority.
    ($mod_name:ident, $contract:expr, $client:ident, constructor_admin) => {
        $crate::upgrade_timelock_tests!(@inner $mod_name, $client, env, id, admin,
            env.register($contract, (admin.clone(),)), {});
    };
    (@inner $mod_name:ident, $client:ident, $env:ident, $id:ident, $admin:ident, $register:expr, $init:block) => {
        #[cfg(test)]
        mod $mod_name {
            #[allow(unused_imports)]
            use super::*;
            use soroban_sdk::testutils::{Address as _, Ledger as _};

            fn hash(env: &soroban_sdk::Env) -> soroban_sdk::BytesN<32> {
                soroban_sdk::BytesN::from_array(env, &[7u8; 32])
            }

            fn setup() -> (soroban_sdk::Env, soroban_sdk::Address, soroban_sdk::Address) {
                let $env = soroban_sdk::Env::default();
                $env.mock_all_auths();
                $env.ledger().set_timestamp(1_000_000);
                let $admin = soroban_sdk::Address::generate(&$env);
                let $id = $register;
                $init
                ($env, $id, $admin)
            }

            fn contract_error(code: u32) -> soroban_sdk::Error {
                soroban_sdk::Error::from_contract_error(code)
            }

            #[test]
            fn propose_enforces_minimum_delay() {
                let (env, id, admin) = setup();
                let client = $client::new(&env, &id);
                let at = client.propose_upgrade(&admin, &hash(&env));
                assert_eq!(at, 1_000_000 + $crate::UPGRADE_TIMELOCK_SECS);
                let pending = client.get_pending_upgrade().unwrap();
                assert_eq!(pending.executable_at, at);
                assert_eq!(pending.wasm_hash, hash(&env));
            }

            #[test]
            fn execute_before_delay_fails() {
                let (env, id, admin) = setup();
                let client = $client::new(&env, &id);
                let at = client.propose_upgrade(&admin, &hash(&env));

                // Immediately after proposing.
                let err = client.try_execute_upgrade(&admin).err().unwrap().unwrap();
                assert_eq!(err, contract_error($crate::UpgradeError::TimelockNotElapsed as u32));

                // One second before the timelock ends.
                env.ledger().set_timestamp(at - 1);
                let err = client.try_execute_upgrade(&admin).err().unwrap().unwrap();
                assert_eq!(err, contract_error($crate::UpgradeError::TimelockNotElapsed as u32));

                // Proposal is still pending after the failed attempts.
                assert!(client.get_pending_upgrade().is_some());
            }

            #[test]
            fn execute_without_proposal_fails() {
                let (env, id, admin) = setup();
                let client = $client::new(&env, &id);
                let err = client.try_execute_upgrade(&admin).err().unwrap().unwrap();
                assert_eq!(err, contract_error($crate::UpgradeError::NoPendingUpgrade as u32));
            }

            #[test]
            fn non_admin_cannot_propose_or_execute() {
                let (env, id, admin) = setup();
                let client = $client::new(&env, &id);
                let attacker = soroban_sdk::Address::generate(&env);
                let err = client
                    .try_propose_upgrade(&attacker, &hash(&env))
                    .err()
                    .unwrap()
                    .unwrap();
                assert_eq!(err, contract_error($crate::UpgradeError::Unauthorized as u32));

                let at = client.propose_upgrade(&admin, &hash(&env));
                env.ledger().set_timestamp(at);
                let err = client.try_execute_upgrade(&attacker).err().unwrap().unwrap();
                assert_eq!(err, contract_error($crate::UpgradeError::Unauthorized as u32));
            }

            #[test]
            fn cancel_clears_pending_and_blocks_execute() {
                let (env, id, admin) = setup();
                let client = $client::new(&env, &id);
                let at = client.propose_upgrade(&admin, &hash(&env));
                client.cancel_upgrade(&admin);
                assert!(client.get_pending_upgrade().is_none());
                env.ledger().set_timestamp(at);
                let err = client.try_execute_upgrade(&admin).err().unwrap().unwrap();
                assert_eq!(err, contract_error($crate::UpgradeError::NoPendingUpgrade as u32));
            }
        }
    };
}
