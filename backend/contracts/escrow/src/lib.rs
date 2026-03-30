#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token::Client as TokenClient, Address, Env,
};

#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum EscrowStatus {
    Active = 0,
    Released = 1,
    Refunded = 2,
    Disputed = 3,
}

#[derive(Clone)]
#[contracttype]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

#[contracttype]
pub struct EscrowAccount {
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub token: Address,
    pub status: EscrowStatus,
    pub release_condition: ReleaseCondition,
    pub created_at: u64,
}

#[contracttype]
pub enum DataKey {
    EscrowCounter,
    Escrow(u64),
}

// =============================================================================
// SECURITY INVARIANTS (for formal verification / audit reference)
// =============================================================================
// INV-1: An escrow's amount is always > 0 (enforced at deposit).
// INV-2: An escrow transitions: Active → Released | Refunded only.
//        Once Released or Refunded, status never changes again.
// INV-3: Only payer or payee may call release_funds.
// INV-4: Only payer may call refund_escrow (auth enforced via require_auth).
// INV-5: Timelock release only succeeds when ledger.timestamp >= deadline.
// INV-6: Total token balance held by contract equals sum of all Active escrow amounts.
// =============================================================================

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Creates and funds a new escrow account.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `payer`: Payer address (must authenticate and have sufficient balance).
    /// - `payee`: Recipient address.
    /// - `amount`: Amount to escrow (must be positive).
    /// - `token`: Token contract address for the escrow.
    /// - `release_condition`: Condition for fund release (`OnCompletion` or `Timelock`).
    ///
    /// # Returns
    /// - `u64`: Unique escrow ID.
    ///
    /// # Errors
    /// - Panics if payer fails authentication.
    /// - Panics if amount <= 0.
    /// - Token transfer will fail if insufficient balance/approval.
    ///
    /// # State Changes
    /// - Transfers tokens from payer to contract.
    /// - Increments escrow counter.
    /// - Stores EscrowAccount with `Active` status.
    pub fn deposit(
        env: Env,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
    ) -> u64 {
        payer.require_auth();
        assert!(amount > 0, "Amount must be positive");

        if let ReleaseCondition::Timelock(deadline) = release_condition.clone() {
            assert!(
                deadline > env.ledger().timestamp(),
                "Timelock deadline must be in the future"
            );
        }

        // #179: Validate token implements the token interface by calling balance().
        // This will trap if `token` is not a valid SEP-41 token contract,
        // preventing funds from being locked with an unrecoverable address.
        let token_client = TokenClient::new(&env, &token);
        let _ = token_client.balance(&payer); // panics if token is invalid
        token_client.transfer(&payer, &env.current_contract_address(), &amount);

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0);
        counter += 1;

        let escrow = EscrowAccount {
            id: counter,
            payer,
            payee,
            amount,
            token,
            status: EscrowStatus::Active,
            release_condition,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(counter), &escrow);
        env.storage()
            .instance()
            .set(&DataKey::EscrowCounter, &counter);

        counter
    }

    /// Retrieves escrow account details by ID.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Unique escrow ID.
    ///
    /// # Returns
    /// - `EscrowAccount`: Full escrow details.
    ///
    /// # Errors
    /// - Panics with "Escrow not found" if ID doesn't exist.
    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found")
    }

    /// Releases escrowed funds to payee if conditions met.
    /// Can be called by payer or payee.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    /// - `caller`: Caller address (must be payer or payee, authenticates).
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if escrow not found or not active.
    /// - Panics if caller unauthorized (not payer/payee).
    /// - Panics if release condition not satisfied.
    /// - Token transfer fails if issues.
    ///
    /// # State Changes
    /// - Transfers full amount to payee.
    /// - Updates status to `Released`.
    pub fn release_funds(env: Env, escrow_id: u64, caller: Address) -> bool {
        caller.require_auth();

        let mut escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        assert!(
            caller == escrow.payer || caller == escrow.payee,
            "Unauthorized"
        );
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");
        assert!(
            Self::can_release(env.clone(), escrow_id),
            "Release condition not met"
        );

        let token_client = TokenClient::new(&env, &escrow.token);

        // Query governance contract for platform fee (basis points, e.g. 500 = 5%)
        let fee_bps: u32 = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Governance)
            .map(|governance| {
                env.invoke_contract(
                    &governance,
                    &symbol_short!("get_fee"),
                    soroban_sdk::Vec::new(&env),
                )
            })
            .unwrap_or(0);

        let fee_amount = if fee_bps > 0 {
            (escrow.amount * fee_bps as i128) / 10_000
        } else {
            0
        };
        let payee_amount = escrow.amount - fee_amount;

        if fee_amount > 0 {
            let governance: Address = env
                .storage()
                .persistent()
                .get(&DataKey::Governance)
                .expect("Governance not set");
            token_client.transfer(&env.current_contract_address(), &governance, &fee_amount);
        }
        token_client.transfer(&env.current_contract_address(), &escrow.payee, &payee_amount);

        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        true
    }

    /// Refunds escrow to payer (payer only).
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if escrow not found or not active.
    /// - Panics if payer fails authentication.
    ///
    /// # State Changes
    /// - Transfers full amount back to payer.
    /// - Updates status to `Refunded`.
    pub fn refund_escrow(env: Env, escrow_id: u64) -> bool {
        let mut escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        escrow.payer.require_auth();
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.payer,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        true
    }

    /// Checks if escrow release conditions are met.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    ///
    /// # Returns
    /// - `bool`: `true` if releasable.
    ///
    /// # Errors
    /// - Panics if escrow not found.
    ///
    /// # Logic
    /// - `OnCompletion`: Always true.
    /// - `Timelock(deadline)`: True if current timestamp >= deadline.
    pub fn can_release(env: Env, escrow_id: u64) -> bool {
        let escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        match escrow.release_condition {
            ReleaseCondition::OnCompletion => true,
            ReleaseCondition::Timelock(deadline) => env.ledger().timestamp() >= deadline,
        }
    }

    /// Gets total number of escrows created.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    ///
    /// # Returns
    /// - `u64`: Escrow count.
    pub fn get_escrow_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, Env};

    fn setup_token(env: &Env, admin: &Address) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_admin = token::StellarAssetClient::new(env, &token_id.address());
        token_admin.mint(admin, &1_000_000);
        token_id.address()
    }

    #[test]
    fn test_escrow_count_starts_at_zero() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        assert_eq!(client.get_escrow_count(), 0);
    }

    #[test]
    fn test_deposit_increments_counter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(id, 1);
        assert_eq!(client.get_escrow_count(), 1);

        let id2 = client.deposit(&payer, &payee, &200, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(id2, 2);
        assert_eq!(client.get_escrow_count(), 2);
    }

    #[test]
    fn test_deposit_stores_correct_data() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let escrow = client.get_escrow(&id);

        assert_eq!(escrow.payer, payer);
        assert_eq!(escrow.payee, payee);
        assert_eq!(escrow.amount, 1000);
        assert_eq!(escrow.status, EscrowStatus::Active);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_deposit_zero_amount_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        client.deposit(&payer, &payee, &0, &token, &ReleaseCondition::OnCompletion);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_deposit_negative_amount_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        client.deposit(&payer, &payee, &-1, &token, &ReleaseCondition::OnCompletion);
    }

    #[test]
    #[should_panic(expected = "Escrow not found")]
    fn test_get_escrow_not_found_panics() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        client.get_escrow(&999);
    }

    #[test]
    fn test_release_funds_on_completion() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        let result = client.release_funds(&id, &payer);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }

    #[test]
    fn test_release_funds_by_payee() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &300, &token, &ReleaseCondition::OnCompletion);
        let result = client.release_funds(&id, &payee);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_release_funds_unauthorized_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let random = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        client.release_funds(&id, &random);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn test_release_funds_already_released_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        client.release_funds(&id, &payer);
        // Second release should panic
        client.release_funds(&id, &payer);
    }

    #[test]
    fn test_timelock_release_after_deadline() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let deadline = 1000u64;
        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::Timelock(deadline));

        // Before deadline: cannot release
        assert!(!client.can_release(&id));

        // After deadline: can release
        env.ledger().set_timestamp(deadline);
        assert!(client.can_release(&id));

        let result = client.release_funds(&id, &payer);
        assert!(result);
    }

    #[test]
    #[should_panic(expected = "Timelock deadline must be in the future")]
    fn test_deposit_timelock_equal_current_timestamp_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        client.deposit(
            &payer,
            &payee,
            &500,
            &token,
            &ReleaseCondition::Timelock(env.ledger().timestamp()),
        );
    }

    #[test]
    #[should_panic(expected = "Timelock deadline must be in the future")]
    fn test_deposit_timelock_in_past_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        env.ledger().set_timestamp(1000);

        client.deposit(
            &payer,
            &payee,
            &500,
            &token,
            &ReleaseCondition::Timelock(999),
        );
    }

    #[test]
    #[should_panic(expected = "Release condition not met")]
    fn test_timelock_release_before_deadline_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::Timelock(9999));
        // Timestamp is 0 by default, deadline is 9999 — should panic
        client.release_funds(&id, &payer);
    }

    #[test]
    fn test_refund_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        let result = client.refund_escrow(&id);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn test_refund_already_refunded_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        client.refund_escrow(&id);
        // Second refund should panic
        client.refund_escrow(&id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn test_refund_after_release_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        client.release_funds(&id, &payer);
        // Refund after release should panic
        client.refund_escrow(&id);
    }

    #[test]
    fn test_on_completion_can_release_always_true() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &100, &token, &ReleaseCondition::OnCompletion);
        assert!(client.can_release(&id));
    }
}
