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

/// Milestone — a named portion of the total escrow amount
#[contracttype]
pub struct Milestone {
    pub escrow_id: u64,
    pub index: u32,
    pub description: Symbol,
    pub amount: i128,
    pub released: bool,
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

        let counter_key = Symbol::new(&env, "escrow_counter");
        let mut counter: u64 = env.storage().persistent().get::<Symbol, u64>(&counter_key).unwrap_or(0);
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
            released_at: None,
        };

        env.storage().persistent().set(&Symbol::new(&env, &format!("escrow_{}", counter)), &escrow);
        env.storage().persistent().set(&counter_key, &counter);
        counter
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
        env.storage()
            .persistent()
            .get::<Symbol, EscrowAccount>(&Symbol::new(&env, &format!("escrow_{}", escrow_id)))
            .expect("Escrow not found")
    }

    /// Release funds to payee. Authorizer must be payer or payee.
    pub fn release_funds(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();

        let key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        let mut escrow = env.storage().persistent().get::<Symbol, EscrowAccount>(&key).expect("Escrow not found");

        assert!(authorizer == escrow.payer || authorizer == escrow.payee, "Unauthorized");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");
        assert!(Self::can_release(env.clone(), escrow_id), "Release condition not met");

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &escrow.amount);

        escrow.status = EscrowStatus::Released;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);
        true
    }

    /// Refund escrow to payer. Only payer may call.
    pub fn refund_escrow(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();

        let key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        let mut escrow = env.storage().persistent().get::<Symbol, EscrowAccount>(&key).expect("Escrow not found");

        assert_eq!(authorizer, escrow.payer, "Only payer can refund");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);

        escrow.status = EscrowStatus::Refunded;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);
        true
    }

    /// Mark escrow as disputed. Either party may raise a dispute.
    pub fn dispute_escrow(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();

        let key = Symbol::new(&env, &format!("escrow_{}", escrow_id));
        let mut escrow = env.storage().persistent().get::<Symbol, EscrowAccount>(&key).expect("Escrow not found");

        assert!(authorizer == escrow.payer || authorizer == escrow.payee, "Unauthorized");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &escrow);
        true
    }

    /// Add a milestone to an active escrow. Sum of milestone amounts must not exceed escrow amount.
    pub fn add_milestone(
        env: Env,
        authorizer: Address,
        escrow_id: u64,
        index: u32,
        description: Symbol,
        amount: i128,
    ) {
        authorizer.require_auth();

        let escrow = Self::get_escrow(env.clone(), escrow_id);
        assert_eq!(authorizer, escrow.payer, "Only payer can add milestones");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");
        assert!(amount > 0, "Milestone amount must be positive");
        assert!(amount <= escrow.amount, "Milestone amount exceeds escrow");

        let m_key = Symbol::new(&env, &format!("ms_{}_{}", escrow_id, index));
        assert!(
            env.storage().persistent().get::<Symbol, Milestone>(&m_key).is_none(),
            "Milestone already exists"
        );

        let milestone = Milestone { escrow_id, index, description, amount, released: false };
        env.storage().persistent().set(&m_key, &milestone);
    }

    /// Release a single milestone payment to payee. Authorizer must be payer.
    pub fn release_milestone(env: Env, authorizer: Address, escrow_id: u64, index: u32) -> bool {
        authorizer.require_auth();

        let escrow = Self::get_escrow(env.clone(), escrow_id);
        assert_eq!(authorizer, escrow.payer, "Only payer can release milestones");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        let m_key = Symbol::new(&env, &format!("ms_{}_{}", escrow_id, index));
        let mut milestone = env.storage().persistent()
            .get::<Symbol, Milestone>(&m_key)
            .expect("Milestone not found");

        assert!(!milestone.released, "Milestone already released");

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &milestone.amount);

        milestone.released = true;
        env.storage().persistent().set(&m_key, &milestone);
        true
    }

    pub fn get_milestone(env: Env, escrow_id: u64, index: u32) -> Milestone {
        env.storage()
            .persistent()
            .get::<Symbol, Milestone>(&Symbol::new(&env, &format!("ms_{}_{}", escrow_id, index)))
            .expect("Milestone not found")
    }

    pub fn can_release(env: Env, escrow_id: u64) -> bool {
        let escrow = Self::get_escrow(env.clone(), escrow_id);
        match escrow.release_condition {
            ReleaseCondition::OnCompletion => true,
            ReleaseCondition::Timelock(deadline) => env.ledger().timestamp() >= deadline,
        }
    }

    pub fn get_active_escrows_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get::<Symbol, u64>(&Symbol::new(&env, "escrow_counter"))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::{StellarAssetClient, TokenClient};
    use soroban_sdk::Env;

    fn setup(env: &Env, amount: i128) -> (Address, Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token = sac.address();
        let payer = Address::generate(env);
        let payee = Address::generate(env);
        StellarAssetClient::new(env, &token).mint(&payer, &amount);
        (admin, token, payer, payee)
    }

    // ── deposit ───────────────────────────────────────────────────────────────

    #[test]
    fn test_deposit_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(id, 1);
        let e = contract.get_escrow(&id);
        assert_eq!(e.payer, payer);
        assert_eq!(e.amount, 1000);
        assert!(e.status == EscrowStatus::Active);
        assert!(e.released_at.is_none());
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn deposit_zero_amount_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 0);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        contract.deposit(&payer, &payee, &0, &token, &ReleaseCondition::OnCompletion);
    }

    // ── release ───────────────────────────────────────────────────────────────

    #[test]
    fn release_moves_balance_once_to_payee() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(TokenClient::new(&env, &token).balance(&cid), 1000);

        contract.release_funds(&payee, &id);

        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 1000);
        assert_eq!(TokenClient::new(&env, &token).balance(&cid), 0);
        let e = contract.get_escrow(&id);
        assert!(e.status == EscrowStatus::Released);
        assert!(e.released_at.is_some());
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn double_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payer, &id);
        contract.release_funds(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn release_rejects_non_party_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&Address::generate(&env), &id);
    }

    // ── refund ────────────────────────────────────────────────────────────────

    #[test]
    fn refund_returns_funds_to_payer_and_sets_released_at() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 800);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&payer, &payee, &800, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);

        assert_eq!(TokenClient::new(&env, &token).balance(&payer), 800);
        let e = contract.get_escrow(&id);
        assert!(e.status == EscrowStatus::Refunded);
        assert!(e.released_at.is_some());
    }

    #[test]
    #[should_panic(expected = "Only payer can refund")]
    fn refund_rejects_payee_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payee, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn double_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn refund_after_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payee, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn release_after_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    // ── dispute ───────────────────────────────────────────────────────────────

    #[test]
    fn payer_can_dispute_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
    }

    #[test]
    fn payee_can_dispute_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payee, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn stranger_cannot_dispute() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&Address::generate(&env), &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn cannot_dispute_released_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payer, &id);
        contract.dispute_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn cannot_release_disputed_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    // ── timelock ──────────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Release condition not met")]
    fn release_before_timelock_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));
        contract.release_funds(&payer, &id);
    }

    #[test]
    fn release_after_timelock_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));
        env.ledger().set_timestamp(250);
        contract.release_funds(&payee, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
    }

    // ── milestones ────────────────────────────────────────────────────────────

    #[test]
    fn milestone_release_transfers_partial_amount() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let desc = Symbol::new(&env, "phase1");
        contract.add_milestone(&payer, &id, &0, &desc, &400);
        contract.release_milestone(&payer, &id, &0);

        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 400);
        assert!(contract.get_milestone(&id, &0).released);
    }

    #[test]
    #[should_panic(expected = "Milestone already released")]
    fn double_milestone_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let desc = Symbol::new(&env, "phase1");
        contract.add_milestone(&payer, &id, &0, &desc, &400);
        contract.release_milestone(&payer, &id, &0);
        contract.release_milestone(&payer, &id, &0);
    }

    #[test]
    #[should_panic(expected = "Only payer can add milestones")]
    fn payee_cannot_add_milestone() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payee, &id, &0, &Symbol::new(&env, "x"), &400);
    }

    #[test]
    #[should_panic(expected = "Only payer can release milestones")]
    fn payee_cannot_release_milestone() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "x"), &400);
        contract.release_milestone(&payee, &id, &0);
    }

    #[test]
    #[should_panic(expected = "Milestone amount exceeds escrow")]
    fn milestone_exceeding_escrow_amount_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "x"), &1001);
    }
}
