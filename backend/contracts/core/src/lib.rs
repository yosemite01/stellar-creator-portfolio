#![no_std]

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
    pub fn set_fee(env: Env, caller: Address, new_fee_bps: u32) {
        require_not_paused(&env);
        caller.require_auth();
        let admin: Address = env.storage().persistent().get(&ADMIN_KEY).expect("Not initialized");
        assert!(caller == admin, "Unauthorized");
        assert_valid_fee_bps(new_fee_bps);
        env.storage().persistent().set(&FEE_KEY, &new_fee_bps);
        env.events().publish(
            (symbol_short!("core"), symbol_short!("fee_set")),
            (new_fee_bps,),
        );
    }

    // ── Read-only (pause-exempt) ──────────────────────────────────────────────

    pub fn get_fee(env: Env) -> u32 {
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
    use soroban_sdk::{testutils::Address as _, Env};

    fn deploy(env: &Env, fee_bps: u32) -> (CoreContractClient, Address) {
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
        assert_eq!(client.get_fee(), 500);
    }

    #[test]
    fn test_set_fee_exact_max_allowed() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        // 1_000 bps == 10% — the new hard ceiling
        client.set_fee(&admin, &1_000);
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
        assert_eq!(client.calculate_fee(&10_000), 1_000);
        assert_eq!(client.calculate_net(&10_000), 9_000);
    }

    // ── Pause mechanism tests (#820) ──────────────────────────────────────────

    fn deploy_with_guardian(env: &Env, fee_bps: u32) -> (CoreContractClient, Address, Address) {
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
}
