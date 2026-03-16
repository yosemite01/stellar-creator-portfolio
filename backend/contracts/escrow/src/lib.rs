#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, String, Symbol, token::Client as TokenClient,
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
    OnCompletion = 0,
    Timelock(u64) = 1,
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
pub trait EscrowContractTrait {
    /// Deposit funds into escrow
    fn deposit(
        env: Env,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
    ) -> u64;

    /// Get escrow account details
    fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount;

    /// Release funds from escrow to payee
    fn release_funds(env: Env, escrow_id: u64) -> bool;

    /// Refund escrow to payer
    fn refund_escrow(env: Env, escrow_id: u64) -> bool;

    /// Check if funds can be released based on condition
    fn can_release(env: Env, escrow_id: u64) -> bool;

    /// Get total active escrows
    fn get_active_escrows_count(env: Env) -> u64;
}

#[contractimpl]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContractTrait for EscrowContract {
    fn deposit(
        env: Env,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
    ) -> u64 {
        payer.require_auth();
        
        assert!(amount > 0, "Amount must be positive");

        // Transfer tokens from payer to contract
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&payer, &env.current_contract_address(), &amount);

        // Get escrow counter
        let escrow_counter_key = Symbol::new(&env, "escrow_counter");
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&escrow_counter_key)
            .unwrap_or(0);

        counter += 1;
        let escrow_id = counter;

        // Create escrow account
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

        // Store escrow
        let escrow_key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        env.storage().persistent().set(&escrow_key, &escrow);
        env.storage()
            .persistent()
            .set(&escrow_counter_key, &counter);

        escrow_id
    }

    fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
        let escrow_key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        env.storage()
            .persistent()
            .get::<Symbol, EscrowAccount>(&escrow_key)
            .expect("Escrow not found")
    }

    fn release_funds(env: Env, escrow_id: u64) -> bool {
        let escrow_key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        let mut escrow = env
            .storage()
            .persistent()
            .get::<Symbol, EscrowAccount>(&escrow_key)
            .expect("Escrow not found");

        // Only payer or payee can release
        assert!(
            (env.invoker() == escrow.payer || env.invoker() == escrow.payee),
            "Unauthorized"
        );

        assert_eq!(escrow.status, EscrowStatus::Active, "Escrow not active");

        // Check if release condition is met
        assert!(Self::can_release(env.clone(), escrow_id), "Release condition not met");

        // Transfer funds to payee
        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.payee, &escrow.amount);

        // Update escrow status
        escrow.status = EscrowStatus::Released;
        escrow.released_at = Some(env.ledger().timestamp());

        env.storage().persistent().set(&escrow_key, &escrow);

        true
    }

    fn refund_escrow(env: Env, escrow_id: u64) -> bool {
        let escrow_key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        let mut escrow = env
            .storage()
            .persistent()
            .get::<Symbol, EscrowAccount>(&escrow_key)
            .expect("Escrow not found");

        // Only payer can initiate refund
        assert_eq!(env.invoker(), escrow.payer, "Only payer can refund");
        assert_eq!(escrow.status, EscrowStatus::Active, "Escrow not active");

        // Transfer funds back to payer
        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);

        // Update escrow status
        escrow.status = EscrowStatus::Refunded;

        env.storage().persistent().set(&escrow_key, &escrow);

        true
    }

    fn can_release(env: Env, escrow_id: u64) -> bool {
        let escrow = Self::get_escrow(env.clone(), escrow_id);

        match escrow.release_condition {
            ReleaseCondition::OnCompletion => {
                // In a real scenario, this would check bounty completion status
                // For now, always return true
                true
            }
            ReleaseCondition::Timelock(deadline) => {
                env.ledger().timestamp() >= deadline
            }
        }
    }

    fn get_active_escrows_count(env: Env) -> u64 {
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
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_deposit_escrow() {
        let env = Env::default();
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let payer = Address::random(&env);
        let payee = Address::random(&env);
        let token = Address::random(&env);

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
    }
}
