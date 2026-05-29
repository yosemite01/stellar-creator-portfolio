#![no_std]

pub mod fee;

use fee::{assert_valid_fee_bps, compute_fee, compute_net, MAX_FEE_BPS};
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol};

const FEE_KEY: Symbol = symbol_short!("fee_bps");
const ADMIN_KEY: Symbol = symbol_short!("admin");

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
    }

    /// Update the platform fee. Only the admin may call this.
    /// Panics if `new_fee_bps > 10_000` (#517 basis-point limit guard).
    pub fn set_fee(env: Env, caller: Address, new_fee_bps: u32) {
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
        assert_eq!(client.max_fee_bps(), 10_000);
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
    #[should_panic(expected = "Fee exceeds maximum of 10000 basis points")]
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
        client.set_fee(&admin, &10_000);
        assert_eq!(client.get_fee(), 10_000);
    }

    #[test]
    #[should_panic(expected = "Fee exceeds maximum of 10000 basis points")]
    fn test_fee_limit_rejection_one_above_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &10_001);
    }

    #[test]
    #[should_panic(expected = "Fee exceeds maximum of 10000 basis points")]
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
    fn test_calculate_fee_100_percent() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = deploy(&env, 250);
        client.set_fee(&admin, &10_000);
        assert_eq!(client.calculate_fee(&1_000), 1_000);
        assert_eq!(client.calculate_net(&1_000), 0);
    }
}
