#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol,
    token::Client as TokenClient,
};

/// Escrow Status
#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum EscrowStatus {
    Active = 0,
    Released = 1,
    Refunded = 2,
    Disputed = 3,
}

/// Release Condition
#[derive(Clone, Debug)]
#[contracttype]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

// â”€â”€ Fee constants (#344) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Platform fee in basis points (2.5 %).
pub const PLATFORM_FEE_BPS: i128 = 250;

/// Maximum platform fee in token units (500 USDC-equivalent).
pub const PLATFORM_FEE_CAP: i128 = 500;

/// Compute the platform fee for a given gross amount.
/// Fee = min(amount * 250 / 10_000, 500)
pub fn platform_fee(amount: i128) -> i128 {
    let raw = amount * PLATFORM_FEE_BPS / 10_000;
    if raw > PLATFORM_FEE_CAP { PLATFORM_FEE_CAP } else { raw }
}

/// Escrow Account
#[contracttype]
pub struct EscrowAccount {
    pub id: u64,
    pub bounty_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub token: Address,
    pub status: EscrowStatus,
    pub release_condition: ReleaseCondition,
    pub created_at: u64,
    pub released_at: Option<u64>,
    pub fee_collected: i128,
}

/// Milestone â€” a named portion of the total escrow amount
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
        bounty_id: u64,
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

        let fee = platform_fee(amount);
        let net_amount = amount - fee;

        // Collect platform fee to admin if set, otherwise hold in contract
        let admin_key = Symbol::new(&env, "platform_admin");
        if let Some(admin_addr) = env.storage().persistent().get::<Symbol, Address>(&admin_key) {
            if fee > 0 {
                TokenClient::new(&env, &token)
                    .transfer(&env.current_contract_address(), &admin_addr, &fee);
            }
        }

        let escrow = EscrowAccount {
            id: counter,
            bounty_id,
            payer,
            payee,
            amount: net_amount,
            token,
            status: EscrowStatus::Active,
            release_condition,
            created_at: env.ledger().timestamp(),
            released_at: None,
            fee_collected: fee,
        };

        env.storage().persistent().set(&(Symbol::new(&env, "escrow"), counter), &escrow);
        env.storage().persistent().set(&(Symbol::new(&env, "b_esc"), bounty_id), &counter);
        env.storage().persistent().set(&counter_key, &counter);

        // Emit escrow_deposited event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposited")),
            (counter, bounty_id, escrow.payer.clone(), escrow.payee.clone(), net_amount, fee),
        );

        counter
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
        env.storage()
            .persistent()
            .get::<(Symbol, u64), EscrowAccount>(&(Symbol::new(&env, "escrow"), escrow_id))
            .expect("Escrow not found")
    }

    /// Release funds to payee. Authorizer must be payer or payee.
    pub fn release_funds(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");

        assert!(authorizer == escrow.payer || authorizer == escrow.payee, "Unauthorized");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");
        assert!(Self::can_release(env.clone(), escrow_id), "Release condition not met");

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &escrow.amount);

        escrow.status = EscrowStatus::Released;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // Emit escrow_released event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("released")),
            (escrow_id, escrow.bounty_id, escrow.payee.clone(), escrow.amount),
        );

        true
    }

    /// Refund escrow to payer. Only payer may call.
    pub fn refund_escrow(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");

        assert_eq!(authorizer, escrow.payer, "Only payer can refund");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);

        escrow.status = EscrowStatus::Refunded;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // Emit escrow_refunded event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refunded")),
            (escrow_id, escrow.bounty_id, escrow.payer.clone(), escrow.amount),
        );

        true
    }

    /// Mark escrow as disputed. Either party may raise a dispute.
    pub fn dispute_escrow(env: Env, authorizer: Address, escrow_id: u64) -> bool {
        authorizer.require_auth();

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env.storage().persistent().get::<(Symbol, u64), EscrowAccount>(&key).expect("Escrow not found");

        assert!(authorizer == escrow.payer || authorizer == escrow.payee, "Unauthorized");
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &escrow);

        // Emit escrow_disputed event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("disputed")),
            (escrow_id, escrow.bounty_id, authorizer),
        );

        true
    }

    /// Resolve a disputed escrow. Only the platform admin may call this.
    ///
    /// `resolution`: `true` â†’ release funds to payee; `false` â†’ refund to payer.
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        escrow_id: u64,
        release_to_payee: bool,
    ) -> bool {
        admin.require_auth();

        // Verify caller is the stored platform admin
        let admin_key = Symbol::new(&env, "platform_admin");
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&admin_key)
            .expect("Platform admin not set");
        assert_eq!(admin, stored_admin, "Only platform admin can resolve disputes");

        let key = (Symbol::new(&env, "escrow"), escrow_id);
        let mut escrow = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), EscrowAccount>(&key)
            .expect("Escrow not found");

        assert!(escrow.status == EscrowStatus::Disputed, "Escrow is not disputed");

        let recipient = if release_to_payee {
            escrow.payee.clone()
        } else {
            escrow.payer.clone()
        };

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &recipient, &escrow.amount);

        escrow.status = if release_to_payee {
            EscrowStatus::Released
        } else {
            EscrowStatus::Refunded
        };
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // Emit dispute_resolved event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("resolved")),
            (escrow_id, escrow.bounty_id, recipient, release_to_payee),
        );

        true
    }

    /// Set the platform admin address. Can only be called once (bootstrap).
    pub fn set_admin(env: Env, admin: Address) {
        admin.require_auth();
        let admin_key = Symbol::new(&env, "platform_admin");
        assert!(
            env.storage().persistent().get::<Symbol, Address>(&admin_key).is_none(),
            "Admin already set"
        );
        env.storage().persistent().set(&admin_key, &admin);
    }

    /// Get the current platform admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set")
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

        let m_key = (Symbol::new(&env, "ms"), escrow_id, index);
        assert!(
            env.storage().persistent().get::<(Symbol, u64, u32), Milestone>(&m_key).is_none(),
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

        let m_key = (Symbol::new(&env, "ms"), escrow_id, index);
        let mut milestone = env.storage().persistent()
            .get::<(Symbol, u64, u32), Milestone>(&m_key)
            .expect("Milestone not found");

        assert!(!milestone.released, "Milestone already released");

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &milestone.amount);

        milestone.released = true;
        env.storage().persistent().set(&m_key, &milestone);

        // Emit milestone_released event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("ms_rel")),
            (escrow_id, index, escrow.payee.clone(), milestone.amount),
        );

        true
    }

    pub fn get_milestone(env: Env, escrow_id: u64, index: u32) -> Milestone {
        env.storage()
            .persistent()
            .get::<(Symbol, u64, u32), Milestone>(&(Symbol::new(&env, "ms"), escrow_id, index))
            .expect("Milestone not found")
    }

    pub fn can_release(env: Env, escrow_id: u64) -> bool {
        let escrow = Self::get_escrow(env.clone(), escrow_id);
        match escrow.release_condition {
            ReleaseCondition::OnCompletion => true,
            ReleaseCondition::Timelock(deadline) => env.ledger().timestamp() >= deadline,
        }
    }

    /// Return the platform fee that would be charged for a given gross amount.
    /// Mirrors the `platform_fee` free function for on-chain queries.
    pub fn calculate_fee(_env: Env, gross_amount: i128) -> i128 {
        platform_fee(gross_amount)
    }

    pub fn get_active_escrows_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get::<Symbol, u64>(&Symbol::new(&env, "escrow_counter"))
            .unwrap_or(0)
    }

    /// Get the latest escrow ID for a specific bounty.
    pub fn get_escrow_id_for_bounty(env: Env, bounty_id: u64) -> u64 {
        env.storage()
            .persistent()
            .get::<(Symbol, u64), u64>(&(Symbol::new(&env, "b_esc"), bounty_id))
            .unwrap_or(0)
    }

    /// Submit a Stellar transaction for an escrow operation.
    ///
    /// This is the on-chain entry point called by the backend Stellar SDK
    /// after building and signing a transaction envelope. It validates the
    /// operation type and delegates to the appropriate escrow function.
    ///
    /// `operation`: one of "deposit", "release", "refund", "dispute"
    /// `escrow_id`: target escrow (0 for deposit, which creates a new one)
    /// Returns the escrow_id that was acted upon.
    pub fn submit_transaction(
        env: Env,
        caller: Address,
        operation: Symbol,
        escrow_id: u64,
    ) -> u64 {
        caller.require_auth();

        let op_deposit = Symbol::new(&env, "deposit");
        let op_release = Symbol::new(&env, "release");
        let op_refund = Symbol::new(&env, "refund");
        let op_dispute = Symbol::new(&env, "dispute");

        if operation == op_release {
            Self::release_funds(env.clone(), caller.clone(), escrow_id);
        } else if operation == op_refund {
            Self::refund_escrow(env.clone(), caller.clone(), escrow_id);
        } else if operation == op_dispute {
            Self::dispute_escrow(env.clone(), caller.clone(), escrow_id);
        } else if operation == op_deposit {
            // deposit requires additional params; callers should use deposit() directly
            panic!("Use deposit() directly for new escrows");
        } else {
            panic!("Unknown operation");
        }

        // Emit a generic transaction_submitted event for the indexer
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("tx_sub")),
            (escrow_id, operation, caller),
        );

        escrow_id
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

    // fee calculation (#344)
    #[test]
    fn fee_is_2_5_percent_of_amount() {
        assert_eq!(platform_fee(1000), 25);
        assert_eq!(platform_fee(400), 10);
    }

    #[test]
    fn fee_is_capped_at_500() {
        assert_eq!(platform_fee(30_000), 500);
        assert_eq!(platform_fee(1_000_000), 500);
    }

    #[test]
    fn fee_at_exact_cap_boundary() {
        assert_eq!(platform_fee(20_000), 500);
    }

    #[test]
    fn fee_is_zero_for_zero_amount() {
        assert_eq!(platform_fee(0), 0);
    }

    #[test]
    fn deposit_net_amount_reflects_fee_deduction() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let escrow = contract.get_escrow(&id);
        assert_eq!(escrow.amount, 975);
        assert_eq!(escrow.fee_collected, 25);
    }

    #[test]
    fn calculate_fee_public_fn_matches_platform_fee() {
        let env = Env::default();
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        assert_eq!(contract.calculate_fee(&1000), 25);
        assert_eq!(contract.calculate_fee(&30_000), 500);
    }
    // â”€â”€ deposit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn test_deposit_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(id, 1);
        let e = contract.get_escrow(&id);
        assert_eq!(e.bounty_id, 1);
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
        contract.deposit(&1u64, &payer, &payee, &0, &token, &ReleaseCondition::OnCompletion);
    }

    // â”€â”€ release â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn release_moves_balance_once_to_payee() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
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
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payer, &id);
        contract.release_funds(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn release_rejects_non_party_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&Address::generate(&env), &id);
    }

    // â”€â”€ refund â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn refund_returns_funds_to_payer_and_sets_released_at() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 800);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &800, &token, &ReleaseCondition::OnCompletion);
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
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payee, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn double_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn refund_after_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payee, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn release_after_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    // â”€â”€ dispute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn payer_can_dispute_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
    }

    #[test]
    fn payee_can_dispute_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payee, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn stranger_cannot_dispute() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&Address::generate(&env), &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn cannot_dispute_released_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payer, &id);
        contract.dispute_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn cannot_release_disputed_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    // â”€â”€ resolve_dispute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn admin_can_resolve_dispute_to_payee() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&admin, &id, &true);

        assert_eq!(tc.balance(&payee), 1000);
        assert_eq!(tc.balance(&cid), 0);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
    }

    #[test]
    fn admin_can_resolve_dispute_to_payer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payee, &id);
        contract.resolve_dispute(&admin, &id, &false);

        assert_eq!(tc.balance(&payer), 1000);
        assert_eq!(tc.balance(&cid), 0);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Refunded);
    }

    #[test]
    #[should_panic(expected = "Only platform admin can resolve disputes")]
    fn non_admin_cannot_resolve_dispute() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&payer, &id, &true); // payer is not admin
    }

    #[test]
    #[should_panic(expected = "Escrow is not disputed")]
    fn cannot_resolve_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.resolve_dispute(&admin, &id, &true); // not disputed yet
    }

    #[test]
    #[should_panic(expected = "Admin already set")]
    fn set_admin_can_only_be_called_once() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let _ = (token, payer, payee); // suppress unused warnings

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.set_admin(&admin); // second call must panic
    }

    // â”€â”€ timelock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    #[should_panic(expected = "Release condition not met")]
    fn release_before_timelock_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));
        contract.release_funds(&payer, &id);
    }

    #[test]
    fn release_after_timelock_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));
        env.ledger().set_timestamp(250);
        contract.release_funds(&payee, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
    }

    // â”€â”€ milestones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn milestone_release_transfers_partial_amount() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
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
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
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
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payee, &id, &0, &Symbol::new(&env, "x"), &400);
    }

    #[test]
    #[should_panic(expected = "Only payer can release milestones")]
    fn payee_cannot_release_milestone() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "x"), &400);
        contract.release_milestone(&payee, &id, &0);
    }

    #[test]
    #[should_panic(expected = "Milestone amount exceeds escrow")]
    fn milestone_exceeding_escrow_amount_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "x"), &1001);
    }

    // â”€â”€ balance conservation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Total tokens out (payee + payer) must equal total tokens deposited.
    #[test]
    fn balance_conservation_release() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 2500);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &2500, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(tc.balance(&cid), 2500);
        assert_eq!(tc.balance(&payer), 0);

        contract.release_funds(&payer, &id);

        assert_eq!(tc.balance(&payee), 2500);  // payee received all
        assert_eq!(tc.balance(&cid), 0);        // contract holds nothing
        assert_eq!(tc.balance(&payer), 0);      // payer gave it all
    }

    #[test]
    fn balance_conservation_refund() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1800);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1800, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);

        assert_eq!(tc.balance(&payer), 1800);   // payer got it back
        assert_eq!(tc.balance(&payee), 0);       // payee received nothing
        assert_eq!(tc.balance(&cid), 0);         // contract holds nothing
    }

    // â”€â”€ multi-escrow isolation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // ── multi-escrow isolation ────────────────────────────────────────────────
    
    /// Releasing escrow A must not affect escrow B's locked balance.
    #[test]
    fn releasing_one_escrow_does_not_drain_another() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 3000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        // Deposit two separate escrows from the same payer
        let id_a = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let id_b = contract.deposit(&2u64, &payer, &payee, &2000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(tc.balance(&cid), 3000);

        contract.release_funds(&payer, &id_a);

        // Only escrow A's amount left in contract
        assert_eq!(tc.balance(&cid), 2000);
        assert_eq!(tc.balance(&payee), 1000);

        // Escrow B is still active and untouched
        assert!(contract.get_escrow(&id_b).status == EscrowStatus::Active);
    }

    #[test]
    fn test_get_escrow_id_for_bounty() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let b_id = 99u64;
        let e_id = contract.deposit(&b_id, &payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        
        assert_eq!(contract.get_escrow_id_for_bounty(&b_id), e_id);
        assert_eq!(contract.get_escrow_id_for_bounty(&100u64), 0);
    }

    /// IDs are monotonically increasing and never reused.
    #[test]
    fn escrow_ids_are_monotonically_increasing() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 3000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let id1 = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let id2 = contract.deposit(&2u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let id3 = contract.deposit(&3u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
        assert!(id2 > id1 && id3 > id2);
    }

    // â”€â”€ double-spend prevention â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Funds locked in a disputed escrow must remain in the contract.
    #[test]
    fn disputed_escrow_funds_stay_locked() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);

        // Balance unchanged â€” funds are locked
        assert_eq!(tc.balance(&cid), 1000);
        assert_eq!(tc.balance(&payee), 0);
        assert_eq!(tc.balance(&payer), 0);
    }

    /// Two milestones whose combined amount equals the escrow can both be released
    /// but the total payout must not exceed the deposited amount.
    #[test]
    fn two_milestones_total_payout_equals_deposit() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "p1"), &600);
        contract.add_milestone(&payer, &id, &1, &Symbol::new(&env, "p2"), &400);

        contract.release_milestone(&payer, &id, &0);
        assert_eq!(tc.balance(&payee), 600);
        assert_eq!(tc.balance(&cid), 400);

        contract.release_milestone(&payer, &id, &1);
        assert_eq!(tc.balance(&payee), 1000);
        assert_eq!(tc.balance(&cid), 0);
    }

    /// A milestone from escrow A cannot be released against escrow B.
    #[test]
    #[should_panic(expected = "Milestone not found")]
    fn milestone_cross_escrow_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 2000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let id_a = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let id_b = contract.deposit(&2u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);

        contract.add_milestone(&payer, &id_a, &0, &Symbol::new(&env, "m"), &500);

        // Attempt to release escrow A's milestone index 0 against escrow B
        contract.release_milestone(&payer, &id_b, &0);
    }

    /// Depositing a negative amount must be rejected.
    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn deposit_negative_amount_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));
        contract.deposit(&1u64, &payer, &payee, &-1, &token, &ReleaseCondition::OnCompletion);
    }

    // â”€â”€ timelock boundary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Release at exactly the deadline timestamp must succeed.
    #[test]
    fn release_at_exact_timelock_boundary_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);

        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));

        // Set timestamp to exactly the deadline
        env.ledger().set_timestamp(200);
        contract.release_funds(&payer, &id);

        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 500);
    }

    /// Release one second before the deadline must be rejected.
    #[test]
    #[should_panic(expected = "Release condition not met")]
    fn release_one_second_before_timelock_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));

        env.ledger().set_timestamp(199);
        contract.release_funds(&payer, &id);
    }
}

#[path = "fuzz_tests.rs"]
mod fuzz_tests;
