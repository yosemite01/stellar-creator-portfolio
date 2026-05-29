// contracts/vault/src/lib.rs
// Issue #520 — Multi-Vault Batch Withdrawal
//
// Exposes the VaultContract with a batch_withdraw entry point that
// delegates to the batch processor for atomic, gas-efficient execution.

#![no_std]

pub mod batch;

use batch::{process_batch, WithdrawalOutcome, WithdrawalRequest};
use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

/// Storage key for vault balances.
const BALANCE_KEY: &str = "bal";

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    /// Deposit funds into the caller's vault.
    pub fn deposit(env: Env, owner: Address, amount: i128) {
        owner.require_auth();
        assert!(amount > 0, "deposit amount must be positive");
        let current = Self::read_balance(&env, &owner);
        Self::write_balance(&env, &owner, current + amount);
    }

    /// Execute a batch of withdrawals atomically.
    ///
    /// All requests are validated and processed in a single invocation.
    /// If any request is invalid the entire batch is rejected — no partial
    /// state changes are committed.
    ///
    /// # Gas optimisation
    /// Batching avoids per-transaction overhead; N withdrawals cost
    /// significantly less than N individual contract calls.
    pub fn batch_withdraw(
        env: Env,
        requests: Vec<WithdrawalRequest>,
    ) -> Vec<WithdrawalOutcome> {
        process_batch(
            &env,
            requests,
            |e, addr| Self::read_balance(e, addr),
            |e, addr, bal| Self::write_balance(e, addr, bal),
        )
    }

    /// Return the current vault balance for `owner`.
    pub fn balance(env: Env, owner: Address) -> i128 {
        Self::read_balance(&env, &owner)
    }

    // ── Internal storage helpers ─────────────────────────────────────────────

    fn balance_key(owner: &Address) -> (soroban_sdk::Symbol, Address) {
        (soroban_sdk::symbol_short!("bal"), owner.clone())
    }

    fn read_balance(env: &Env, owner: &Address) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&Self::balance_key(owner))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, owner: &Address, amount: i128) {
        env.storage()
            .persistent()
            .set(&Self::balance_key(owner), &amount);
        // Bump TTL on every write (mirrors storage.rs policy).
        env.storage()
            .persistent()
            .extend_ttl(&Self::balance_key(owner), 100, 518_400);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use batch::WithdrawalRequest;
    use soroban_sdk::{testutils::Address as _, vec, Env};

    fn setup() -> (Env, soroban_sdk::Address, VaultContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, VaultContract);
        let client = VaultContractClient::new(&env, &id);
        (env, id, client)
    }

    #[test]
    fn deposit_and_balance() {
        let (env, _, client) = setup();
        let owner = Address::generate(&env);
        client.deposit(&owner, &1000);
        assert_eq!(client.balance(&owner), 1000);
    }

    #[test]
    fn batch_withdraw_deducts_all() {
        let (env, _, client) = setup();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let recipient = Address::generate(&env);

        client.deposit(&a, &500);
        client.deposit(&b, &300);

        let requests = vec![
            &env,
            WithdrawalRequest { owner: a.clone(), recipient: recipient.clone(), amount: 200 },
            WithdrawalRequest { owner: b.clone(), recipient: recipient.clone(), amount: 100 },
        ];

        let outcomes = client.batch_withdraw(&requests);
        assert_eq!(outcomes.len(), 2);
        assert_eq!(client.balance(&a), 300);
        assert_eq!(client.balance(&b), 200);
    }

    #[test]
    #[should_panic]
    fn batch_withdraw_rejects_insufficient_balance() {
        let (env, _, client) = setup();
        let owner = Address::generate(&env);
        let recipient = Address::generate(&env);
        client.deposit(&owner, &50);

        let requests = vec![
            &env,
            WithdrawalRequest { owner: owner.clone(), recipient, amount: 100 },
        ];
        client.batch_withdraw(&requests); // should panic
    }
}
