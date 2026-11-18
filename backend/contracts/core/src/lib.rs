#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

pub mod fee;

use fee::{assert_valid_fee_bps, compute_fee, compute_net, MAX_FEE_BPS};
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address, Env, Symbol};

const FEE_KEY: Symbol = symbol_short!("fee_bps");
const ADMIN_KEY: Symbol = symbol_short!("admin");
const GUARDIAN_KEY: Symbol = symbol_short!("guardian");

// ── Pause DataKey (#820) ──────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Paused,
    /// Fee increase waiting out `FEE_CHANGE_DELAY_SECS` (#1724).
    PendingFee,
}

/// Delay before a fee increase takes effect (#1724): 48 hours. Decreases are
/// applied immediately because they can only benefit users.
pub const FEE_CHANGE_DELAY_SECS: u64 = 48 * 3600;

/// A scheduled fee increase (#1724).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingFee {
    pub fee_bps: u32,
    pub effective_at: u64,
}

// ── Error codes (#820) ───────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CoreError {
    Paused = 1,
    NotGuardian = 2,
    NotGovernance = 3,
    AlreadyPaused = 4,
    NotPaused = 5,
    /// The effective fee exceeds the caller's `max_fee_bps` / `max_fee` (#1724).
    FeeExceedsMax = 6,
    /// No fee change is scheduled.
    NoPendingFee = 7,
    /// `apply_pending_fee` called before the timelock elapsed.
    FeeTimelockActive = 8,
}

// ── Internal helpers (#820) ──────────────────────────────────────────────────

fn is_guardian(env: &Env, caller: &Address) -> bool {
    env.storage()
        .persistent()
        .get::<Symbol, Address>(&GUARDIAN_KEY)
        .map(|g| g == *caller)
        .unwrap_or(false)
}

fn is_admin(env: &Env, caller: &Address) -> bool {
    env.storage()
        .persistent()
        .get::<Symbol, Address>(&ADMIN_KEY)
        .map(|a| a == *caller)
        .unwrap_or(false)
}

/// Panics with `CoreError::Paused` if the circuit breaker is active.
/// Read-only functions intentionally do **not** call this.
pub fn require_not_paused(env: &Env) {
    if env
        .storage()
        .persistent()
        .get::<DataKey, bool>(&DataKey::Paused)
        .unwrap_or(false)
    {
        panic_with_error!(env, CoreError::Paused);
    }
}

#[contract]
pub struct CoreContract;

#[contractimpl]
impl CoreContract {
    pub fn initialize(env: Env, admin: Address, initial_fee_bps: u32) {
        admin.require_auth();
        assert!(!env.storage().persistent().has(&ADMIN_KEY), "Already initialized");
        assert_valid_fee_bps(initial_fee_bps);
        env.storage().persistent().set(&ADMIN_KEY, &admin);
        env.storage().persistent().set(&FEE_KEY, &initial_fee_bps);
        // Unpause by default.
        env.storage().persistent().set(&DataKey::Paused, &false);
    }

    // ── Pause mechanism (#820) ────────────────────────────────────────────────

    /// Set the guardian address. Only the admin may do this.
    ///
    /// The guardian is a separate hot-wallet key that can pause the protocol
    /// instantly in an emergency, without waiting for a governance vote.
    pub fn set_guardian(env: Env, admin: Address, guardian: Address) {
        admin.require_auth();
        assert!(is_admin(&env, &admin), "Unauthorized");
        env.storage().persistent().set(&GUARDIAN_KEY, &guardian);
        env.events().publish(
            (symbol_short!("core"), symbol_short!("guardian")),
            guardian,
        );
    }

    /// Pause all state-changing operations. Only the guardian may call this.
    ///
    /// Read-only functions (`get_fee`, `calculate_fee`, etc.) remain available
    /// so that UIs can still display contract state while the fix is deployed.
    /// Emits a `(core, paused)` event so the indexer can trigger a PagerDuty alert.
    pub fn pause(env: Env, guardian: Address) {
        guardian.require_auth();
        if !is_guardian(&env, &guardian) {
            panic_with_error!(&env, CoreError::NotGuardian);
        }
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, CoreError::AlreadyPaused);
        }
        env.storage().persistent().set(&DataKey::Paused, &true);
        env.events()
            .publish((symbol_short!("core"), symbol_short!("paused")), ());
    }

    /// Unpause the contract. Only the admin (governance multisig) may call this.
    ///
    /// Separating pause (guardian) from unpause (governance) means a single
    /// compromised guardian key cannot keep the protocol frozen indefinitely.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();
        assert!(is_admin(&env, &admin), "Unauthorized");
        if !env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic_with_error!(&env, CoreError::NotPaused);
        }
        env.storage().persistent().set(&DataKey::Paused, &false);
        env.events()
            .publish((symbol_short!("core"), symbol_short!("unpaused")), ());
    }

    /// Returns `true` if the contract is currently paused.
    /// Read-only — does not revert when paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    // ── Fee management ────────────────────────────────────────────────────────

    /// Update the platform fee. Only the admin may call this.
    /// Panics if `new_fee_bps > 1_000` — hard ceiling of 10% (#1104 / #517).
    /// Panics if the contract is paused (#820).
    ///
    /// #1724: a decrease (or no-op) applies immediately and emits
    /// `(core, fee_set)`. An increase is scheduled for
    /// `now + FEE_CHANGE_DELAY_SECS`, announced with `(core, fee_prop)`, and
    /// becomes effective automatically once the delay elapses. A new call
    /// replaces any pending change.
    pub fn set_fee(env: Env, caller: Address, new_fee_bps: u32) {
        require_not_paused(&env);
        caller.require_auth();
        let admin: Address = env.storage().persistent().get(&ADMIN_KEY).expect("Not initialized");
        assert!(caller == admin, "Unauthorized");
        assert_valid_fee_bps(new_fee_bps);
        let current = Self::get_fee(env.clone());
        let store = env.storage().persistent();
        // Fold any matured pending change into storage before replacing it.
        store.set(&FEE_KEY, &current);
        if new_fee_bps <= current {
            store.set(&FEE_KEY, &new_fee_bps);
            store.remove(&DataKey::PendingFee);
            env.events().publish(
                (symbol_short!("core"), symbol_short!("fee_set")),
                (new_fee_bps,),
            );
        } else {
            let effective_at = env.ledger().timestamp() + FEE_CHANGE_DELAY_SECS;
            store.set(&DataKey::PendingFee, &PendingFee { fee_bps: new_fee_bps, effective_at });
            env.events().publish(
                (symbol_short!("core"), symbol_short!("fee_prop")),
                (current, new_fee_bps, effective_at),
            );
        }
    }

    /// Persist a matured fee increase. Anyone may call this; it only writes
    /// what `get_fee` already reports. Emits `(core, fee_set)`.
    pub fn apply_pending_fee(env: Env) {
        let pending: PendingFee = env
            .storage()
            .persistent()
            .get(&DataKey::PendingFee)
            .unwrap_or_else(|| panic_with_error!(&env, CoreError::NoPendingFee));
        if env.ledger().timestamp() < pending.effective_at {
            panic_with_error!(&env, CoreError::FeeTimelockActive);
        }
        env.storage().persistent().set(&FEE_KEY, &pending.fee_bps);
        env.storage().persistent().remove(&DataKey::PendingFee);
        env.events().publish(
            (symbol_short!("core"), symbol_short!("fee_set")),
            (pending.fee_bps,),
        );
    }

    /// Withdraw a scheduled fee increase before it matures. Admin-only.
    /// Emits `(core, fee_cncl)`.
    pub fn cancel_pending_fee(env: Env, caller: Address) {
        caller.require_auth();
        assert!(is_admin(&env, &caller), "Unauthorized");
        match Self::get_pending_fee(env.clone()) {
            Some(p) => {
                env.storage().persistent().remove(&DataKey::PendingFee);
                env.events().publish(
                    (symbol_short!("core"), symbol_short!("fee_cncl")),
                    (p.fee_bps,),
                );
            }
            None => panic_with_error!(&env, CoreError::NoPendingFee),
        }
    }

    /// The fee increase still waiting out its timelock, if any.
    pub fn get_pending_fee(env: Env) -> Option<PendingFee> {
        env.storage()
            .persistent()
            .get::<DataKey, PendingFee>(&DataKey::PendingFee)
            .filter(|p| env.ledger().timestamp() < p.effective_at)
    }

    /// Fee for `amount`, reverting with `FeeExceedsMax` if the effective rate
    /// is above `max_fee_bps` or the fee is above `max_fee` (#1724).
    ///
    /// Integrators call this (or embed the same caps) in the user's
    /// transaction so a fee raised after the quote reverts rather than
    /// over-charging.
    pub fn calculate_fee_checked(env: Env, amount: i128, max_fee_bps: u32, max_fee: i128) -> i128 {
        let bps = Self::get_fee(env.clone());
        if bps > max_fee_bps {
            panic_with_error!(&env, CoreError::FeeExceedsMax);
        }
        let fee = compute_fee(amount, bps);
        if fee > max_fee {
            panic_with_error!(&env, CoreError::FeeExceedsMax);
        }
        fee
    }

    // ── Issue #1564: Timelocked upgrade + two-step admin transfer ─────────────
    //
    // Replaces the old instant `upgrade` entrypoint. Shared logic lives in
    // `stellar-upgradeable`; see docs/contracts.md (Upgrading a live contract).

    /// Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
    /// which `execute_upgrade` may be called (now + 48h). Emits
    /// `(upgrade, proposed)`.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> u64 {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&ADMIN_KEY)
            .expect("Not initialized");
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&ADMIN_KEY)
            .expect("Not initialized");
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&ADMIN_KEY)
            .expect("Not initialized");
        stellar_upgradeable::cancel_upgrade(&env, &admin, &stored_admin);
    }

    /// The upgrade currently waiting out its timelock, if any.
    pub fn get_pending_upgrade(env: Env) -> Option<stellar_upgradeable::PendingUpgrade> {
        stellar_upgradeable::pending_upgrade(&env)
    }

    /// Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&ADMIN_KEY)
            .expect("Not initialized");
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&ADMIN_KEY)
            .expect("Not initialized");
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &stored_admin);
        env.storage().persistent().set(&ADMIN_KEY, &accepted);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&ADMIN_KEY)
            .expect("Not initialized");
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }

    // ── Read-only (pause-exempt) ──────────────────────────────────────────────

    /// The fee effective now: the stored fee, or a pending increase whose
    /// timelock has elapsed (#1724).
    pub fn get_fee(env: Env) -> u32 {
        if let Some(p) = env.storage().persistent().get::<DataKey, PendingFee>(&DataKey::PendingFee) {
            if env.ledger().timestamp() >= p.effective_at {
                return p.fee_bps;
            }
        }
        env.storage().persistent().get(&FEE_KEY).unwrap_or(0)
    }

    pub fn max_fee_bps(_env: Env) -> u32 {
        MAX_FEE_BPS
    }

    pub fn calculate_fee(env: Env, amount: i128) -> i128 {
        compute_fee(amount, Self::get_fee(env))
    }

    pub fn calculate_net(env: Env, amount: i128) -> i128 {
        compute_net(amount, Self::get_fee(env))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Ledger}, Env};

    fn mature(env: &Env) {
        env.ledger().with_mut(|l| l.timestamp += FEE_CHANGE_DELAY_SECS);
    }

    fn deploy(env: &Env, fee_bps: u32) -> (CoreContractClient<'_>, Address) {
        let id = env.register(CoreContract, ());
        let client = CoreContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&admin, &fee_bps);
        (client, admin)
    }

    #[test]
    fn test_initialize_stores_fee() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env, 250);
        assert_eq!(client.get_fee(), 250);
        // Hard ceiling of 10% (#1104 / #517).
        assert_eq!(client.max_fee_bps(), 1_000);
    }

    #[test]
    #[should_panic(expected = "Already initialized")]
    fn test_double_initialize_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.initialize(&admin, &100);
    }

    #[test]
    #[should_panic(expected = "Fee exceeds maximum of 1000 basis points (10%)")]
    fn test_initialize_above_max_panics() {
        let env = Env::default();
        env.mock_all_auths();
        deploy(&env, 10_001);
    }

    #[test]
    fn test_set_fee_valid() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &500);
        // #1724: increases are timelocked.
        assert_eq!(client.get_fee(), 250);
        mature(&env);
        assert_eq!(client.get_fee(), 500);
    }

    #[test]
    fn test_set_fee_exact_max_allowed() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        // 1_000 bps == 10% — the new hard ceiling
        client.set_fee(&admin, &1_000);
        mature(&env);
        assert_eq!(client.get_fee(), 1_000);
    }

    #[test]
    #[should_panic(expected = "Fee exceeds maximum of 1000 basis points (10%)")]
    fn test_fee_limit_rejection_one_above_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &1_001);
    }

    #[test]
    #[should_panic(expected = "Fee exceeds maximum of 1000 basis points (10%)")]
    fn test_fee_limit_rejection_large_value() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &u32::MAX);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_set_fee_non_admin_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env, 250);
        client.set_fee(&Address::generate(&env), &100);
    }

    #[test]
    fn test_calculate_fee_and_net() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env, 250);
        assert_eq!(client.calculate_fee(&1_000), 25);
        assert_eq!(client.calculate_net(&1_000), 975);
    }

    #[test]
    fn test_calculate_fee_at_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        // 1_000 bps == 10% — the enforced ceiling
        client.set_fee(&admin, &1_000);
        mature(&env);
        assert_eq!(client.calculate_fee(&10_000), 1_000);
        assert_eq!(client.calculate_net(&10_000), 9_000);
    }

    // ── Pause mechanism tests (#820) ──────────────────────────────────────────

    fn deploy_with_guardian(env: &Env, fee_bps: u32) -> (CoreContractClient<'_>, Address, Address) {
        let (client, admin) = deploy(env, fee_bps);
        let guardian = Address::generate(env);
        client.set_guardian(&admin, &guardian);
        (client, admin, guardian)
    }

    #[test]
    fn test_not_paused_by_default() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env, 250);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_guardian_can_pause() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, guardian) = deploy_with_guardian(&env, 250);
        client.pause(&guardian);
        assert!(client.is_paused());
    }

    #[test]
    fn test_admin_can_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, guardian) = deploy_with_guardian(&env, 250);
        client.pause(&guardian);
        client.unpause(&admin);
        assert!(!client.is_paused());
    }

    #[test]
    fn test_read_only_works_while_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, guardian) = deploy_with_guardian(&env, 250);
        client.pause(&guardian);
        // Read-only calls must still succeed when paused.
        assert_eq!(client.get_fee(), 250);
        assert_eq!(client.calculate_fee(&1_000), 25);
        assert_eq!(client.calculate_net(&1_000), 975);
        assert!(client.is_paused());
    }

    #[test]
    #[should_panic]
    fn test_set_fee_blocked_when_paused() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, guardian) = deploy_with_guardian(&env, 250);
        client.pause(&guardian);
        client.set_fee(&admin, &500);
    }

    #[test]
    #[should_panic]
    fn test_non_guardian_cannot_pause() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = deploy_with_guardian(&env, 250);
        let stranger = Address::generate(&env);
        client.pause(&stranger);
    }

    #[test]
    #[should_panic]
    fn test_non_admin_cannot_unpause() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, guardian) = deploy_with_guardian(&env, 250);
        client.pause(&guardian);
        let stranger = Address::generate(&env);
        client.unpause(&stranger);
    }

    #[test]
    #[should_panic]
    fn test_double_pause_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, guardian) = deploy_with_guardian(&env, 250);
        client.pause(&guardian);
        client.pause(&guardian);
    }

    #[test]
    #[should_panic]
    fn test_unpause_when_not_paused_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, _) = deploy_with_guardian(&env, 250);
        client.unpause(&admin);
    }

    // ── #1724: fee caps + timelocked increases ────────────────────────────────

    #[test]
    fn test_fee_decrease_applies_immediately() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &100);
        assert_eq!(client.get_fee(), 100);
        assert!(client.get_pending_fee().is_none());
    }

    #[test]
    fn test_fee_increase_is_pending_until_delay() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &500);
        let p = client.get_pending_fee().unwrap();
        assert_eq!(p.fee_bps, 500);
        assert_eq!(p.effective_at, env.ledger().timestamp() + FEE_CHANGE_DELAY_SECS);
        mature(&env);
        client.apply_pending_fee();
        assert_eq!(client.get_fee(), 500);
        assert!(client.get_pending_fee().is_none());
    }

    #[test]
    fn test_checked_fee_at_quoted_rate_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env, 250);
        assert_eq!(client.calculate_fee_checked(&1_000, &250, &25), 25);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_fee_raised_after_quote_reverts() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        let quoted_bps = client.get_fee();
        let quoted_fee = client.calculate_fee(&1_000);
        client.set_fee(&admin, &500);
        mature(&env);
        client.calculate_fee_checked(&1_000, &quoted_bps, &quoted_fee);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_checked_fee_absolute_cap_enforced() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = deploy(&env, 250);
        client.calculate_fee_checked(&1_000, &1_000, &24);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_apply_pending_fee_before_delay_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &500);
        client.apply_pending_fee();
    }

    #[test]
    fn test_cancel_pending_fee() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &500);
        client.cancel_pending_fee(&admin);
        mature(&env);
        assert_eq!(client.get_fee(), 250);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_non_admin_cannot_cancel_pending_fee() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &500);
        client.cancel_pending_fee(&Address::generate(&env));
    }
}
