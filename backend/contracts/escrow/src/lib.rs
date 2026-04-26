#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token::Client as TokenClient, Address, Env,
};

#[derive(Clone, Copy, Debug, PartialEq)]
#[contracttype]
pub enum EscrowStatus {
    Active = 0,
    Released = 1,
    Refunded = 2,
    Disputed = 3,
}

#[derive(Clone, Debug)]
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

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
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

        let mut counter: u64 = env
            .storage()
            .persistent()
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
            .persistent()
            .set(&DataKey::EscrowCounter, &counter);

        counter
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found")
    }

    pub fn release(env: Env, escrow_id: u64) -> bool {
        let mut escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        escrow.payer.require_auth();
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");
        assert!(
            Self::can_release(env.clone(), escrow_id),
            "Release condition not met"
        );

        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.payee,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        true
    }

    pub fn release_funds(env: Env, escrow_id: u64, caller: Address) -> bool {
        let escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        assert!(caller == escrow.payer, "Unauthorized");
        Self::release(env, escrow_id)
    }

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

    pub fn get_escrow_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    fn setup_escrow_with_token(
        env: &Env,
        amount: i128,
    ) -> (EscrowContractClient<'_>, Address, Address, Address, Address) {
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let payer = Address::generate(env);
        let payee = Address::generate(env);
        let token_admin = Address::generate(env);
        let token = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();

        StellarAssetClient::new(env, &token).mint(&payer, &amount);

        (client, contract_id, payer, payee, token)
    }

    #[test]
    fn test_escrow_count_starts_at_zero() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        assert_eq!(client.get_escrow_count(), 0);
    }

    #[test]
    fn test_release_transfers_funds_to_payee_and_marks_released() {
        let env = Env::default();
        let amount = 1_000i128;
        let (client, contract_id, payer, payee, token) = setup_escrow_with_token(&env, amount);

        let escrow_id = client.deposit(
            &payer,
            &payee,
            &amount,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        assert!(client.release(&escrow_id));

        let token_client = TokenClient::new(&env, &token);
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        assert_eq!(token_client.balance(&payee), amount);
        assert_eq!(token_client.balance(&contract_id), 0);
    }

    #[test]
    fn test_release_respects_timelock() {
        let env = Env::default();
        let amount = 1_000i128;
        let release_at = 1_000u64;
        let (client, _, payer, payee, token) = setup_escrow_with_token(&env, amount);

        env.ledger().with_mut(|ledger| {
            ledger.timestamp = release_at - 1;
        });

        let escrow_id = client.deposit(
            &payer,
            &payee,
            &amount,
            &token,
            &ReleaseCondition::Timelock(release_at),
        );

        assert!(!client.can_release(&escrow_id));

        env.ledger().with_mut(|ledger| {
            ledger.timestamp = release_at;
        });

        assert!(client.can_release(&escrow_id));
        assert!(client.release(&escrow_id));
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn test_release_cannot_run_twice() {
        let env = Env::default();
        let amount = 1_000i128;
        let (client, _, payer, payee, token) = setup_escrow_with_token(&env, amount);

        let escrow_id = client.deposit(
            &payer,
            &payee,
            &amount,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        assert!(client.release(&escrow_id));
        client.release(&escrow_id);
    }
}
