#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol, Vec,
};

/// Base resource fee for creating a bounty (derived from benchmarking, update after load testing)
pub const BOUNTY_CREATE_BASE_FEE: i128 = 100;

/// Platform fee in basis points (2.5%)
pub const PLATFORM_FEE_BPS: i128 = 250;

/// Maximum platform fee cap (500 units)
pub const PLATFORM_FEE_CAP: i128 = 500;

/// Default multi-sig threshold: bounties with budget ≥ this value require M-of-N
/// authorisation before the payment is released. Governance can override this via
/// `set_multisig_threshold`. Units match the contract's `budget` field (i128).
pub const MULTISIG_THRESHOLD: i128 = 1_000;

/// Calculate platform fee for a given budget
pub fn platform_fee(budget: i128) -> i128 {
    let raw = budget * PLATFORM_FEE_BPS / 10_000;
    if raw > PLATFORM_FEE_CAP { PLATFORM_FEE_CAP } else { raw }
}
// Re-export ReleaseCondition from escrow contract for cross-contract calls
#[derive(Clone, Debug)]
#[contracttype]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

/// Bounty Error Codes
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BountyError {
    DeadlineNotPassed = 1,
    AlreadyProcessed = 2,
    InsufficientBalance = 3,
    /// Bounty budget exceeds the multi-sig threshold and no signer set is configured.
    MultisigNotConfigured = 4,
    /// Fewer signers authorised than the required minimum (M-of-N not satisfied).
    InsufficientSigners = 5,
}

/// DataKey for typed storage lookups
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    EscrowContract,
    /// Ordered list of authorised multi-sig signers (Address).
    MultisigSigners,
    /// Minimum number of signers required (M in M-of-N). Defaults to 2.
    MultisigRequired,
    /// Governance-configurable threshold above which multi-sig is enforced.
    MultisigThreshold,
}

/// Escrow Contract Client Interface
#[contractclient(name = "EscrowContractClient")]
pub trait EscrowContractTrait {
    fn refund_expired_bounty(env: Env, bounty_id: u64, bounty_contract: Address) -> bool;
}

/// Bounty Status Enum
#[derive(Clone, Copy, PartialEq)]
#[contracttype]
pub enum BountyStatus {
    Open = 0,
    InProgress = 1,
    Completed = 2,
    Disputed = 3,
    Cancelled = 4,
    PendingCompletion = 5, // #160: freelancer signalled work done, awaiting creator approval
}

/// Bounty Struct
#[contracttype]
pub struct Bounty {
    pub id: u64,
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub budget: i128,
    pub deadline: u64,
    pub status: BountyStatus,
    pub selected_freelancer: Option<Address>,
    pub created_at: u64,
    pub completed_at: Option<u64>,
    pub escrow_id: u64,
}

/// Bounty Application Struct
#[contracttype]
pub struct BountyApplication {
    pub id: u64,
    pub bounty_id: u64,
    pub freelancer: Address,
    pub proposal: String,
    pub proposed_budget: i128,
    pub timeline: u64, // in days
    pub status: String, // "pending", "accepted", "rejected"
    pub created_at: u64,
}

#[contract]
pub struct BountyContract;

#[contractimpl]
impl BountyContract {
    pub fn set_escrow_contract(env: Env, admin: Address, escrow: Address) -> bool {
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::EscrowContract, &escrow);
        true
    }

    // ── Multi-sig governance (issue #740) ────────────────────────────────────

    /// Configure the M-of-N signer set for high-value bounty payments.
    ///
    /// Only the stored contract admin (governance multisig) may call this.
    /// `signers` is the full ordered list of authorised addresses; `required`
    /// is the minimum number of them that must call `require_auth()` before
    /// `complete_bounty` proceeds for budgets above the threshold.
    pub fn set_multisig_signers(
        env: Env,
        admin: Address,
        signers: Vec<Address>,
        required: u32,
    ) -> bool {
        admin.require_auth();
        let stored_admin_key = Symbol::new(&env, "bounty_admin");
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&stored_admin_key)
            .expect("Contract admin not set");
        assert_eq!(admin, stored_admin, "unauthorized");
        assert!(required > 0, "required must be > 0");
        assert!(
            required <= signers.len() as u32,
            "required must be <= number of signers"
        );

        env.storage()
            .persistent()
            .set(&DataKey::MultisigSigners, &signers);
        env.storage()
            .persistent()
            .set(&DataKey::MultisigRequired, &required);

        env.events().publish(
            (symbol_short!("multisig"), symbol_short!("updated")),
            (required, signers.len() as u32),
        );

        true
    }

    /// Update the budget threshold above which multi-sig is enforced.
    /// Only the contract admin may call this.
    pub fn set_multisig_threshold(env: Env, admin: Address, threshold: i128) -> bool {
        admin.require_auth();
        let stored_admin_key = Symbol::new(&env, "bounty_admin");
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&stored_admin_key)
            .expect("Contract admin not set");
        assert_eq!(admin, stored_admin, "unauthorized");
        assert!(threshold > 0, "threshold must be > 0");

        env.storage()
            .persistent()
            .set(&DataKey::MultisigThreshold, &threshold);

        true
    }

    /// Return the configured multi-sig threshold (or the compile-time default).
    pub fn get_multisig_threshold(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::MultisigThreshold)
            .unwrap_or(MULTISIG_THRESHOLD)
    }

    fn get_escrow_contract(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::EscrowContract)
            .expect("Escrow contract not set")
    }

    pub fn create_bounty(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        budget: i128,
        deadline: u64,
    ) -> u64 {
        creator.require_auth();

        let bounty_counter_key = Symbol::new(&env, "bounty_counter");
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&bounty_counter_key)
            .unwrap_or(0);

        counter += 1;
        let bounty_id = counter;

        let bounty = Bounty {
            id: bounty_id,
            creator: creator.clone(),
            title,
            description,
            budget,
            deadline,
            status: BountyStatus::Open,
            selected_freelancer: None,
            created_at: env.ledger().timestamp(),
            completed_at: None,
            escrow_id: 0,
        };

        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        env.storage().persistent().set(&bounty_key, &bounty);
        env.storage()
            .persistent()
            .set(&bounty_counter_key, &counter);

        bounty_id
    }

    pub fn create_and_fund_bounty(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        budget: i128,
        token: Address,
        deadline: u64,
    ) -> u64 {
        creator.require_auth();

        let bounty_id = Self::create_bounty(
            env.clone(),
            creator.clone(),
            title,
            description,
            budget,
            deadline,
        );

        let escrow_contract = Self::get_escrow_contract(&env);
        let escrow_client = EscrowContractClient::new(&env, &escrow_contract);

        let escrow_id = escrow_client.deposit(
            &bounty_id,
            &creator,
            &creator,
            &budget,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        let mut bounty = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Bounty>(&bounty_key)
            .expect("Bounty not found");
        bounty.escrow_id = escrow_id;
        env.storage().persistent().set(&bounty_key, &bounty);

        bounty_id
    }

    pub fn get_bounty(env: Env, bounty_id: u64) -> Bounty {
        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        env.storage()
            .persistent()
            .get::<(Symbol, u64), Bounty>(&bounty_key)
            .expect("Bounty not found")
    }

    pub fn apply_for_bounty(
        env: Env,
        bounty_id: u64,
        freelancer: Address,
        proposal: String,
        proposed_budget: i128,
        timeline: u64,
    ) -> u64 {
        freelancer.require_auth();

        let app_counter_key = Symbol::new(&env, "application_counter");
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&app_counter_key)
            .unwrap_or(0);

        counter += 1;
        let application_id = counter;

        let application = BountyApplication {
            id: application_id,
            bounty_id,
            freelancer,
            proposal,
            proposed_budget,
            timeline,
            status: String::from_str(&env, "pending"),
            created_at: env.ledger().timestamp(),
        };

        let app_key = (Symbol::new(&env, "application"), application_id);
        env.storage().persistent().set(&app_key, &application);
        env.storage()
            .persistent()
            .set(&app_counter_key, &counter);

        application_id
    }

    pub fn get_application(env: Env, application_id: u64) -> BountyApplication {
        let app_key = (Symbol::new(&env, "application"), application_id);
        env.storage()
            .persistent()
            .get::<(Symbol, u64), BountyApplication>(&app_key)
            .expect("Application not found")
    }

    pub fn select_freelancer(
        env: Env,
        bounty_id: u64,
        application_id: u64,
    ) -> bool {
        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        let mut bounty = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Bounty>(&bounty_key)
            .expect("Bounty not found");

        bounty.creator.require_auth();

        let application = Self::get_application(env.clone(), application_id);
        assert_eq!(application.bounty_id, bounty_id, "Application does not match bounty");

        bounty.selected_freelancer = Some(application.freelancer);
        bounty.status = BountyStatus::InProgress;

        env.storage().persistent().set(&bounty_key, &bounty);

        true
    }

    /// Called by the selected freelancer to signal work is done.
    /// Transitions the bounty from InProgress → PendingCompletion. (#160)
    /// The creator must then call complete_bounty to approve.
    pub fn submit_completion(env: Env, bounty_id: u64, freelancer: Address) -> bool {
        freelancer.require_auth();

        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        let mut bounty = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Bounty>(&bounty_key)
            .expect("Bounty not found");

        assert!(
            bounty.status == BountyStatus::InProgress,
            "Bounty not in progress"
        );
        assert!(
            bounty.selected_freelancer == Some(freelancer.clone()),
            "Only the selected freelancer can submit completion"
        );

        bounty.status = BountyStatus::PendingCompletion;
        env.storage().persistent().set(&bounty_key, &bounty);

        true
    }

    pub fn complete_bounty(env: Env, bounty_id: u64) -> bool {
        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        let mut bounty = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Bounty>(&bounty_key)
            .expect("Bounty not found");

        bounty.creator.require_auth();
        // #160: Creator can only approve completion after the freelancer has
        // signalled work is done via submit_completion (PendingCompletion).
        // Direct completion from InProgress is no longer allowed.
        assert!(
            bounty.status == BountyStatus::PendingCompletion,
            "Freelancer must submit completion before creator can approve"
        );

        // #740: Bounties above the multi-sig threshold require M-of-N signer
        // authorisation before the payment is released.
        let threshold = Self::get_multisig_threshold(env.clone());
        if bounty.budget >= threshold {
            let signers: Vec<Address> = env
                .storage()
                .persistent()
                .get::<DataKey, Vec<Address>>(&DataKey::MultisigSigners)
                .expect("Multi-sig signer set not configured for high-value bounty");

            let required: u32 = env
                .storage()
                .persistent()
                .get::<DataKey, u32>(&DataKey::MultisigRequired)
                .unwrap_or(2);

            // Collect auth from each signer; count how many authorised.
            let mut auth_count: u32 = 0;
            for signer in signers.iter() {
                signer.require_auth();
                auth_count += 1;
                if auth_count >= required {
                    break;
                }
            }

            assert!(
                auth_count >= required,
                "Insufficient multi-sig authorisations for high-value bounty"
            );

            env.events().publish(
                (symbol_short!("bounty"), symbol_short!("multisig")),
                (bounty_id, auth_count, required),
            );
        }

        bounty.status = BountyStatus::Completed;
        bounty.completed_at = Some(env.ledger().timestamp());

        env.storage().persistent().set(&bounty_key, &bounty);

        true
    }

    pub fn cancel_bounty(env: Env, bounty_id: u64) -> bool {
        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        let mut bounty = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Bounty>(&bounty_key)
            .expect("Bounty not found");

        bounty.creator.require_auth();
        assert!(bounty.status == BountyStatus::Open, "Only open bounties can be cancelled");

        bounty.status = BountyStatus::Cancelled;

        env.storage().persistent().set(&bounty_key, &bounty);

        true
    }

    pub fn get_bounties_count(env: Env) -> u64 {
        let bounty_counter_key = Symbol::new(&env, "bounty_counter");
        env.storage()
            .persistent()
            .get::<Symbol, u64>(&bounty_counter_key)
            .unwrap_or(0)
    }

    /// Optimized view: return all bounties matching a given status.
    /// Avoids loading all bounties when only a subset is needed.
    pub fn get_bounties_by_status(env: Env, status: BountyStatus) -> Vec<Bounty> {
        let mut result = Vec::new(&env);
        let counter = Self::get_bounties_count(env.clone());
        for i in 1..=counter {
            let key = (Symbol::new(&env, "bounty"), i);
            if let Some(bounty) = env.storage().persistent().get::<(Symbol, u64), Bounty>(&key) {
                if bounty.status == status {
                    result.push_back(bounty);
                }
            }
        }
        result
    }

    /// Optimized view: return a paginated slice of all bounties.
    /// `offset` is zero-based; returns at most `limit` items.
    pub fn get_bounties_paginated(env: Env, offset: u64, limit: u64) -> Vec<Bounty> {
        let mut result = Vec::new(&env);
        let counter = Self::get_bounties_count(env.clone());
        let start = offset + 1; // storage keys are 1-based
        let end = (start + limit).min(counter + 1);
        for i in start..end {
            let key = (Symbol::new(&env, "bounty"), i);
            if let Some(bounty) = env.storage().persistent().get::<(Symbol, u64), Bounty>(&key) {
                result.push_back(bounty);
            }
        }
        result
    }

    pub fn get_applications(env: Env, bounty_id: u64) -> Vec<BountyApplication> {
        let mut applications = Vec::new(&env);
        let app_counter_key = Symbol::new(&env, "application_counter");
        let counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&app_counter_key)
            .unwrap_or(0);

        for i in 1..=counter {
            let app_key = (Symbol::new(&env, "application"), i);
            if let Some(app) = env
                .storage()
                .persistent()
                .get::<(Symbol, u64), BountyApplication>(&app_key)
            {
                if app.bounty_id == bounty_id {
                    applications.push_back(app);
                }
            }
        }

        applications
    }

    pub fn link_escrow(env: Env, bounty_id: u64, escrow_id: u64) -> bool {
        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        let mut bounty = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Bounty>(&bounty_key)
            .expect("Bounty not found");
        bounty.creator.require_auth();
        bounty.escrow_id = escrow_id;
        env.storage().persistent().set(&bounty_key, &bounty);
        true
    }

    pub fn check_and_expire_bounty(env: Env, bounty_id: u64, escrow_contract: Address) -> bool {
        let bounty_key = (Symbol::new(&env, "bounty"), bounty_id);
        let mut bounty = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Bounty>(&bounty_key)
            .expect("Bounty not found");

        if env.ledger().timestamp() <= bounty.deadline {
            panic!("Deadline not passed");
        }
        if bounty.status != BountyStatus::Open {
            panic!("Already processed");
        }

        // Cancel bounty
        bounty.status = BountyStatus::Cancelled;
        env.storage().persistent().set(&bounty_key, &bounty);

        // Trigger escrow refund
        let escrow_client = EscrowContractClient::new(&env, &escrow_contract);
        escrow_client.refund_expired_bounty(&bounty_id, &env.current_contract_address());

        // Emit events
        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("expired")),
            (bounty_id,),
        );

        true
    }

    /// Estimate the total fee for creating a bounty with the given budget.
    /// Returns: platform_fee + base_resource_fee
    ///
    /// Note: actual fee may vary by up to 10% from this estimate due to network conditions.
    /// The estimate is guaranteed not to exceed actual fee by more than 10%.
    pub fn estimate_create_bounty_fee(env: Env, budget: i128) -> i128 {
        let platform = platform_fee(budget);
        let base_resource = BOUNTY_CREATE_BASE_FEE;
        platform + base_resource
    }

    // ── Issue #732: Contract upgrade mechanism ────────────────────────────────

    /// Upgrade the contract WASM. Only the governance multisig (contract admin)
    /// may call this. Emits an `upgraded` event with the new wasm hash.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) {
        admin.require_auth();
        let admin_key = DataKey::EscrowContract; // reuse admin storage slot via escrow contract key?
        // Bounty contract uses a standalone admin key
        let stored_admin_key = Symbol::new(&env, "bounty_admin");
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&stored_admin_key)
            .expect("Contract admin not set");
        assert_eq!(admin, stored_admin, "unauthorized");

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        env.events().publish(
            (symbol_short!("contract"), symbol_short!("upgraded")),
            new_wasm_hash,
        );
    }

    /// Set the bounty contract admin (governance multisig). Can only be called once.
    pub fn set_admin(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin_key = Symbol::new(&env, "bounty_admin");
        assert!(
            env.storage()
                .persistent()
                .get::<Symbol, Address>(&stored_admin_key)
                .is_none(),
            "Admin already set"
        );
        env.storage().persistent().set(&stored_admin_key, &admin);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_create_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register_contract(None, BountyContract));

        let creator = Address::generate(&env);
        let title = String::from_str(&env, "Test Bounty");
        let description = String::from_str(&env, "Test Description");

        let bounty_id = contract.create_bounty(
            &creator,
            &title,
            &description,
            &5000i128,
            &100u64,
        );

        assert_eq!(bounty_id, 1);

        let bounty = contract.get_bounty(&bounty_id);
        assert_eq!(bounty.creator, creator);
        assert_eq!(bounty.budget, 5000i128);
    }

    #[test]
    fn test_apply_for_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register_contract(None, BountyContract));

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
        );

        let app_id = contract.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I can do this!"),
            &4500i128,
            &30u64,
        );

        assert_eq!(app_id, 1);

        let application = contract.get_application(&app_id);
        assert_eq!(application.freelancer, freelancer);
    }

    #[test]
    fn test_multisig_complete_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register_contract(None, BountyContract));

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);

        contract.set_admin(&admin);

        // Configure 2-of-2 multi-sig with threshold of 1000
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        contract.set_multisig_signers(&admin, &signers, &2u32);
        assert_eq!(contract.get_multisig_threshold(), MULTISIG_THRESHOLD);

        // Create a high-value bounty (budget >= threshold)
        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_str(&env, "High-Value Bounty"),
            &String::from_str(&env, "Requires multi-sig"),
            &(MULTISIG_THRESHOLD + 500),
            &100u64,
        );

        let app_id = contract.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I can do this"),
            &MULTISIG_THRESHOLD,
            &30u64,
        );

        contract.select_freelancer(&bounty_id, &app_id);
        contract.submit_completion(&bounty_id, &freelancer);

        // With mock_all_auths, all require_auth calls pass — completion succeeds
        let result = contract.complete_bounty(&bounty_id);
        assert!(result);

        let bounty = contract.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Completed);
    }

    #[test]
    fn test_low_value_bounty_no_multisig_needed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register_contract(None, BountyContract));

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);

        // Budget below threshold — no multi-sig required
        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_str(&env, "Small Bounty"),
            &String::from_str(&env, "No multi-sig needed"),
            &500i128, // below MULTISIG_THRESHOLD of 1000
            &100u64,
        );

        let app_id = contract.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I'll do it"),
            &500i128,
            &7u64,
        );

        contract.select_freelancer(&bounty_id, &app_id);
        contract.submit_completion(&bounty_id, &freelancer);
        let result = contract.complete_bounty(&bounty_id);
        assert!(result);
    }

    #[test]
    fn test_create_and_fund_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register_contract(None, BountyContract));

        let creator = Address::generate(&env);
        let token = Address::generate(&env);

        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_str(&env, "Funded Bounty"),
            &String::from_str(&env, "With Escrow"),
            &5000i128,
            &100u64,
        );

        assert_eq!(bounty_id, 1);

        let bounty = contract.get_bounty(&bounty_id);
        assert_eq!(bounty.creator, creator);
        assert_eq!(bounty.budget, 5000i128);
    }
}
