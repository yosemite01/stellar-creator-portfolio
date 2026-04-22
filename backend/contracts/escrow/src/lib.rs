#![no_std]

extern crate alloc;
use alloc::format;

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Symbol, token::Client as TokenClient,
};

/// Escrow Status
#[derive(Clone, Copy, PartialEq)]
#[contracttype]
pub enum EscrowStatus {
    Active = 0,
    Released = 1,
    Refunded = 2,
    Disputed = 3,
}

/// Release Condition
#[derive(Clone)]
#[contracttype]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

/// Escrow Account
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
    pub released_at: Option<u64>,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Deposit funds into escrow
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

        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&payer, &env.current_contract_address(), &amount);

        let escrow_counter_key = Symbol::new(&env, "escrow_counter");
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&escrow_counter_key)
            .unwrap_or(0);

        counter += 1;
        let escrow_id = counter;

        let escrow = EscrowAccount {
            id: escrow_id,
            payer,
            payee,
            amount,
            token,
            status: EscrowStatus::Active,
            release_condition,
            created_at: env.ledger().timestamp(),
            released_at: None,
        };

        let escrow_key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        env.storage().persistent().set(&escrow_key, &escrow);
        env.storage()
            .persistent()
            .set(&escrow_counter_key, &counter);

        escrow_id
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
        let escrow_key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        env.storage()
            .persistent()
            .get::<Symbol, EscrowAccount>(&escrow_key)
            .expect("Escrow not found")
    }

    /// Release funds from escrow to payee. `authorizer` must be the payer or payee and must sign.
    pub fn release_funds(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();

        let escrow_key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        let mut escrow = env
            .storage()
            .persistent()
            .get::<Symbol, EscrowAccount>(&escrow_key)
            .expect("Escrow not found");

        assert!(
            authorizer == escrow.payer || authorizer == escrow.payee,
            "Unauthorized"
        );

        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        assert!(
            Self::can_release(env.clone(), escrow_id),
            "Release condition not met"
        );

        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.payee, &escrow.amount);

        escrow.status = EscrowStatus::Released;
        escrow.released_at = Some(env.ledger().timestamp());

        env.storage().persistent().set(&escrow_key, &escrow);

        true
    }

    /// Refund escrow to payer. `authorizer` must be the payer and must sign.
    pub fn refund_escrow(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();

        let escrow_key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        let mut escrow = env
            .storage()
            .persistent()
            .get::<Symbol, EscrowAccount>(&escrow_key)
            .expect("Escrow not found");

        assert_eq!(authorizer, escrow.payer, "Only payer can refund");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);

        escrow.status = EscrowStatus::Refunded;

        env.storage().persistent().set(&escrow_key, &escrow);

        true
    }

    pub fn can_release(env: Env, escrow_id: u64) -> bool {
        let escrow = Self::get_escrow(env.clone(), escrow_id);

        match escrow.release_condition {
            ReleaseCondition::OnCompletion => true,
            ReleaseCondition::Timelock(deadline) => env.ledger().timestamp() >= deadline,
        }
    }

    pub fn get_active_escrows_count(env: Env) -> u64 {
        let escrow_counter_key = Symbol::new(&env, "escrow_counter");
        env.storage()
            .persistent()
            .get::<Symbol, u64>(&escrow_counter_key)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::{StellarAssetClient, TokenClient};
    use soroban_sdk::Env;

    fn setup_token_env(env: &Env, amount: i128) -> (Address, Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token = sac.address();
        let payer = Address::generate(env);
        let payee = Address::generate(env);
        let stellar = StellarAssetClient::new(env, &token);
        stellar.mint(&payer, &amount);
        (admin, token, payer, payee)
    }

    #[test]
    fn test_deposit_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let condition = ReleaseCondition::OnCompletion;

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &1000i128,
            &token,
            &condition,
        );

        assert_eq!(escrow_id, 1);

        let escrow = contract.get_escrow(&escrow_id);
        assert_eq!(escrow.payer, payer);
        assert_eq!(escrow.payee, payee);
        assert_eq!(escrow.amount, 1000i128);
        assert!(escrow.status == EscrowStatus::Active);
    }

    #[test]
    fn release_moves_balance_once_to_payee() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        let token_client = TokenClient::new(&env, &token);
        let escrow_balance_before = token_client.balance(&contract_id);
        assert_eq!(escrow_balance_before, 1000i128);

        contract.release_funds(&payee, &escrow_id);

        assert_eq!(token_client.balance(&payee), 1000i128);
        assert_eq!(token_client.balance(&contract_id), 0i128);
        let escrow = contract.get_escrow(&escrow_id);
        assert!(escrow.status == EscrowStatus::Released);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn double_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        contract.release_funds(&payer, &escrow_id);
        contract.release_funds(&payer, &escrow_id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn refund_after_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        contract.release_funds(&payee, &escrow_id);
        contract.refund_escrow(&payer, &escrow_id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn release_after_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        contract.refund_escrow(&payer, &escrow_id);
        contract.release_funds(&payee, &escrow_id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn double_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        contract.refund_escrow(&payer, &escrow_id);
        contract.refund_escrow(&payer, &escrow_id);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn release_rejects_non_party_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        let stranger = Address::generate(&env);
        contract.release_funds(&stranger, &escrow_id);
    }

    #[test]
    #[should_panic(expected = "Only payer can refund")]
    fn refund_rejects_payee_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        contract.refund_escrow(&payee, &escrow_id);
    }

    #[test]
    #[should_panic(expected = "Release condition not met")]
    fn release_before_timelock_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 500i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        env.ledger().set_timestamp(100);
        let deadline = 200u64;

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &500i128,
            &token,
            &ReleaseCondition::Timelock(deadline),
        );

        contract.release_funds(&payer, &escrow_id);
    }

    #[test]
    fn release_after_timelock_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup_token_env(&env, 500i128);
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);

        env.ledger().set_timestamp(100);
        let deadline = 200u64;

        let escrow_id = contract.deposit(
            &payer,
            &payee,
            &500i128,
            &token,
            &ReleaseCondition::Timelock(deadline),
        );

        env.ledger().set_timestamp(250);
        contract.release_funds(&payee, &escrow_id);

        let escrow = contract.get_escrow(&escrow_id);
        assert!(escrow.status == EscrowStatus::Released);
    }
}
