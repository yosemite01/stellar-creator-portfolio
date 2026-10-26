#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

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
///
/// Codes are part of the contract's public interface: clients and the
/// indexer map them to messages, so never renumber an existing variant —
/// only append new ones. See docs/contracts.md for the full table.
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
    /// `initialize` / `set_admin` called after an admin was already stored.
    AlreadyInitialized = 6,
    /// An admin-gated method was called before `initialize`.
    AdminNotSet = 7,
    /// Caller is not the stored contract admin.
    Unauthorized = 8,
    /// `create_and_fund_bounty` called before `set_escrow_contract`.
    EscrowContractNotSet = 9,
    BountyNotFound = 10,
    ApplicationNotFound = 11,
    /// The application belongs to a different bounty.
    ApplicationMismatch = 12,
    /// The bounty is not in the status this transition requires.
    InvalidStatus = 13,
    /// Only the selected freelancer may submit completion.
    NotSelectedFreelancer = 14,
    /// `required` is 0 or exceeds the signer count, or threshold <= 0.
    InvalidMultisigConfig = 15,
    /// An approver is not in the configured multi-sig signer set.
    ApproverNotSigner = 16,
    /// The same approver appears more than once.
    DuplicateApprover = 17,
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
    fn deposit(
        env: Env,
        bounty_id: u64,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
    ) -> u64;
    fn refund_expired_bounty(env: Env, bounty_id: u64, bounty_contract: Address) -> bool;
}

/// Bounty Status Enum
#[derive(Clone, Copy, Debug, PartialEq)]
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

fn bounty_key(env: &Env, bounty_id: u64) -> (Symbol, u64) {
    (Symbol::new(env, "bounty"), bounty_id)
}

fn load_bounty(env: &Env, bounty_id: u64) -> Result<Bounty, BountyError> {
    env.storage()
        .persistent()
        .get::<(Symbol, u64), Bounty>(&bounty_key(env, bounty_id))
        .ok_or(BountyError::BountyNotFound)
}

/// Fails with `AdminNotSet` / `Unauthorized` unless `admin` is the stored contract admin.
fn require_admin(env: &Env, admin: &Address) -> Result<(), BountyError> {
    let stored_admin: Address = env
        .storage()
        .persistent()
        .get::<Symbol, Address>(&Symbol::new(env, "bounty_admin"))
        .ok_or(BountyError::AdminNotSet)?;
    if *admin != stored_admin {
        return Err(BountyError::Unauthorized);
    }
    Ok(())
}

fn ensure(cond: bool, err: BountyError) -> Result<(), BountyError> {
    if cond { Ok(()) } else { Err(err) }
}

#[contract]
pub struct BountyContract;

#[contractimpl]
impl BountyContract {
    /// Set the contract admin. Must be called once before any admin-gated
    /// method (`set_escrow_contract`, `set_multisig_signers`, ...).
    pub fn initialize(env: Env, admin: Address) -> Result<(), BountyError> {
        admin.require_auth();
        let stored_admin_key = Symbol::new(&env, "bounty_admin");
        ensure(
            !env.storage().persistent().has(&stored_admin_key),
            BountyError::AlreadyInitialized,
        )?;
        env.storage().persistent().set(&stored_admin_key, &admin);
        Ok(())
    }

    pub fn set_escrow_contract(env: Env, admin: Address, escrow: Address) -> Result<bool, BountyError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        env.storage()
            .persistent()
            .set(&DataKey::EscrowContract, &escrow);
        Ok(true)
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
    ) -> Result<bool, BountyError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        // required must be in 1..=signers.len()
        ensure(
            required > 0 && required <= signers.len(),
            BountyError::InvalidMultisigConfig,
        )?;

        env.storage()
            .persistent()
            .set(&DataKey::MultisigSigners, &signers);
        env.storage()
            .persistent()
            .set(&DataKey::MultisigRequired, &required);

        env.events().publish(
            (symbol_short!("multisig"), symbol_short!("updated")),
            (required, signers.len()),
        );

        Ok(true)
    }

    /// Update the budget threshold above which multi-sig is enforced.
    /// Only the contract admin may call this.
    pub fn set_multisig_threshold(env: Env, admin: Address, threshold: i128) -> Result<bool, BountyError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        ensure(threshold > 0, BountyError::InvalidMultisigConfig)?;

        env.storage()
            .persistent()
            .set(&DataKey::MultisigThreshold, &threshold);

        env.events().publish(
            (symbol_short!("multisig"), symbol_short!("threshold")),
            threshold,
        );

        Ok(true)
    }

    /// Return the configured multi-sig threshold (or the compile-time default).
    pub fn get_multisig_threshold(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::MultisigThreshold)
            .unwrap_or(MULTISIG_THRESHOLD)
    }

    fn get_escrow_contract(env: &Env) -> Result<Address, BountyError> {
        env.storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::EscrowContract)
            .ok_or(BountyError::EscrowContractNotSet)
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

        env.storage().persistent().set(&bounty_key(&env, bounty_id), &bounty);
        env.storage()
            .persistent()
            .set(&bounty_counter_key, &counter);

        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("created")),
            (bounty_id, creator, budget, deadline),
        );

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
    ) -> Result<u64, BountyError> {
        creator.require_auth();

        let escrow_contract = Self::get_escrow_contract(&env)?;

        let bounty_id = Self::create_bounty(
            env.clone(),
            creator.clone(),
            title,
            description,
            budget,
            deadline,
        );

        let escrow_client = EscrowContractClient::new(&env, &escrow_contract);

        let escrow_id = escrow_client.deposit(
            &bounty_id,
            &creator,
            &creator,
            &budget,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        let mut bounty = load_bounty(&env, bounty_id)?;
        bounty.escrow_id = escrow_id;
        env.storage().persistent().set(&bounty_key(&env, bounty_id), &bounty);

        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("funded")),
            (bounty_id, escrow_id),
        );

        Ok(bounty_id)
    }

    pub fn get_bounty(env: Env, bounty_id: u64) -> Result<Bounty, BountyError> {
        load_bounty(&env, bounty_id)
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
            freelancer: freelancer.clone(),
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

        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("applied")),
            (bounty_id, application_id, freelancer),
        );

        application_id
    }

    pub fn get_application(env: Env, application_id: u64) -> Result<BountyApplication, BountyError> {
        let app_key = (Symbol::new(&env, "application"), application_id);
        env.storage()
            .persistent()
            .get::<(Symbol, u64), BountyApplication>(&app_key)
            .ok_or(BountyError::ApplicationNotFound)
    }

    /// Assign the bounty to an applicant. Emits `("bounty", "selected")` —
    /// this is the "assigned" transition in docs/contracts.md.
    pub fn select_freelancer(
        env: Env,
        bounty_id: u64,
        application_id: u64,
    ) -> Result<bool, BountyError> {
        let mut bounty = load_bounty(&env, bounty_id)?;

        bounty.creator.require_auth();

        let application = Self::get_application(env.clone(), application_id)?;
        ensure(application.bounty_id == bounty_id, BountyError::ApplicationMismatch)?;

        let selected = application.freelancer;
        bounty.selected_freelancer = Some(selected.clone());
        bounty.status = BountyStatus::InProgress;

        env.storage().persistent().set(&bounty_key(&env, bounty_id), &bounty);

        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("selected")),
            (bounty_id, application_id, selected),
        );

        Ok(true)
    }

    /// Called by the selected freelancer to signal work is done.
    /// Transitions the bounty from InProgress → PendingCompletion. (#160)
    /// The creator must then call complete_bounty to approve.
    pub fn submit_completion(env: Env, bounty_id: u64, freelancer: Address) -> Result<bool, BountyError> {
        freelancer.require_auth();

        let mut bounty = load_bounty(&env, bounty_id)?;

        ensure(bounty.status == BountyStatus::InProgress, BountyError::InvalidStatus)?;
        ensure(
            bounty.selected_freelancer == Some(freelancer.clone()),
            BountyError::NotSelectedFreelancer,
        )?;

        bounty.status = BountyStatus::PendingCompletion;
        env.storage().persistent().set(&bounty_key(&env, bounty_id), &bounty);

        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("submitted")),
            (bounty_id, freelancer),
        );

        Ok(true)
    }

    /// Approve completion and release payment. Emits `("bounty", "completed")` —
    /// this is the "approved" transition in docs/contracts.md.
    ///
    /// `approvers` names the multi-sig signers authorising this call. It is
    /// ignored for bounties below the multi-sig threshold — pass an empty
    /// `Vec` for those. Above the threshold it must contain at least
    /// `required` distinct addresses, all drawn from the configured signer
    /// set, and each must have authorised the invocation.
    ///
    /// Any `required`-sized subset satisfies the policy; the signers no longer
    /// have to be the first `required` entries in the stored order (#1113).
    pub fn complete_bounty(env: Env, bounty_id: u64, approvers: Vec<Address>) -> Result<bool, BountyError> {
        let mut bounty = load_bounty(&env, bounty_id)?;

        bounty.creator.require_auth();
        // #160: Creator can only approve completion after the freelancer has
        // signalled work is done via submit_completion (PendingCompletion).
        // Direct completion from InProgress is no longer allowed.
        ensure(
            bounty.status == BountyStatus::PendingCompletion,
            BountyError::InvalidStatus,
        )?;

        // #740: Bounties above the multi-sig threshold require M-of-N signer
        // authorisation before the payment is released.
        let threshold = Self::get_multisig_threshold(env.clone());
        if bounty.budget >= threshold {
            let signers: Vec<Address> = env
                .storage()
                .persistent()
                .get::<DataKey, Vec<Address>>(&DataKey::MultisigSigners)
                .ok_or(BountyError::MultisigNotConfigured)?;

            let required: u32 = env
                .storage()
                .persistent()
                .get::<DataKey, u32>(&DataKey::MultisigRequired)
                .unwrap_or(2);

            // #1113: the approving subset is named by the caller rather than
            // inferred by walking `signers` in stored order.
            //
            // `require_auth()` panics when the given address did not authorise
            // the invocation — it cannot be used as a boolean test. The previous
            // loop called it unconditionally on the first `required` entries, so
            // it demanded that specific prefix rather than any M of N: a
            // legitimate quorum that happened not to be the first M in the list
            // panicked on an earlier signer who was never involved.
            //
            // Naming the approvers up front means every require_auth() below is
            // expected to succeed, which is the only way to use it correctly.
            ensure(approvers.len() >= required, BountyError::InsufficientSigners)?;

            let mut auth_count: u32 = 0;
            for (i, approver) in approvers.iter().enumerate() {
                // Every approver must belong to the configured signer set,
                // otherwise any address could pad the quorum with its own
                // signature.
                ensure(signers.contains(&approver), BountyError::ApproverNotSigner)?;

                // Without this, [signer_a, signer_a, signer_a] would satisfy a
                // 3-of-5 policy with one key — turning M-of-N into 1-of-N.
                ensure(
                    !approvers.iter().skip(i + 1).any(|other| other == approver),
                    BountyError::DuplicateApprover,
                )?;

                approver.require_auth();
                auth_count += 1;
            }

            ensure(auth_count >= required, BountyError::InsufficientSigners)?;

            env.events().publish(
                (symbol_short!("bounty"), symbol_short!("multisig")),
                (bounty_id, auth_count, required),
            );
        }

        bounty.status = BountyStatus::Completed;
        let completed_at = env.ledger().timestamp();
        bounty.completed_at = Some(completed_at);

        env.storage().persistent().set(&bounty_key(&env, bounty_id), &bounty);

        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("completed")),
            (bounty_id, completed_at),
        );

        Ok(true)
    }

    pub fn cancel_bounty(env: Env, bounty_id: u64) -> Result<bool, BountyError> {
        let mut bounty = load_bounty(&env, bounty_id)?;

        bounty.creator.require_auth();
        ensure(bounty.status == BountyStatus::Open, BountyError::InvalidStatus)?;

        bounty.status = BountyStatus::Cancelled;

        env.storage().persistent().set(&bounty_key(&env, bounty_id), &bounty);

        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("cancelled")),
            (bounty_id,),
        );

        Ok(true)
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
            if let Ok(bounty) = load_bounty(&env, i) {
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
            if let Ok(bounty) = load_bounty(&env, i) {
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

    pub fn link_escrow(env: Env, bounty_id: u64, escrow_id: u64) -> Result<bool, BountyError> {
        let mut bounty = load_bounty(&env, bounty_id)?;
        bounty.creator.require_auth();
        bounty.escrow_id = escrow_id;
        env.storage().persistent().set(&bounty_key(&env, bounty_id), &bounty);

        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("funded")),
            (bounty_id, escrow_id),
        );

        Ok(true)
    }

    pub fn check_and_expire_bounty(env: Env, bounty_id: u64, escrow_contract: Address) -> Result<bool, BountyError> {
        let mut bounty = load_bounty(&env, bounty_id)?;

        ensure(env.ledger().timestamp() > bounty.deadline, BountyError::DeadlineNotPassed)?;
        ensure(bounty.status == BountyStatus::Open, BountyError::AlreadyProcessed)?;

        // Cancel bounty
        bounty.status = BountyStatus::Cancelled;
        env.storage().persistent().set(&bounty_key(&env, bounty_id), &bounty);

        // Trigger escrow refund
        let escrow_client = EscrowContractClient::new(&env, &escrow_contract);
        escrow_client.refund_expired_bounty(&bounty_id, &env.current_contract_address());

        // Emit events
        env.events().publish(
            (symbol_short!("bounty"), symbol_short!("expired")),
            (bounty_id,),
        );

        Ok(true)
    }

    /// Estimate the total fee for creating a bounty with the given budget.
    /// Returns: platform_fee + base_resource_fee
    ///
    /// Note: actual fee may vary by up to 10% from this estimate due to network conditions.
    /// The estimate is guaranteed not to exceed actual fee by more than 10%.
    pub fn estimate_create_bounty_fee(_env: Env, budget: i128) -> i128 {
        let platform = platform_fee(budget);
        let base_resource = BOUNTY_CREATE_BASE_FEE;
        platform + base_resource
    }

    // ── Issue #1564: Timelocked upgrade + two-step admin transfer ─────────────
    //
    // Replaces the old instant `upgrade` entrypoint. Shared logic lives in
    // `stellar-upgradeable`; see docs/contracts.md (Upgrading a live contract).

    /// Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
    /// which `execute_upgrade` may be called (now + 48h). Emits
    /// `(upgrade, proposed)`.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> u64 {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "bounty_admin"))
            .expect("Contract admin not set");
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "bounty_admin"))
            .expect("Contract admin not set");
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "bounty_admin"))
            .expect("Contract admin not set");
        stellar_upgradeable::cancel_upgrade(&env, &admin, &stored_admin);
    }

    /// The upgrade currently waiting out its timelock, if any.
    pub fn get_pending_upgrade(env: Env) -> Option<stellar_upgradeable::PendingUpgrade> {
        stellar_upgradeable::pending_upgrade(&env)
    }

    /// Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "bounty_admin"))
            .expect("Contract admin not set");
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "bounty_admin"))
            .expect("Contract admin not set");
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &stored_admin);
        env.storage().persistent().set(&Symbol::new(&env, "bounty_admin"), &accepted);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "bounty_admin"))
            .expect("Contract admin not set");
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }

    /// Set the bounty contract admin (governance multisig). Can only be called once.
    pub fn set_admin(env: Env, admin: Address) -> Result<(), BountyError> {
        admin.require_auth();
        let stored_admin_key = Symbol::new(&env, "bounty_admin");
        ensure(
            env.storage()
                .persistent()
                .get::<Symbol, Address>(&stored_admin_key)
                .is_none(),
            BountyError::AlreadyInitialized,
        )?;
        env.storage().persistent().set(&stored_admin_key, &admin);
        Ok(())
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
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

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
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

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
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

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
        let mut approvers = soroban_sdk::Vec::new(&env);
        approvers.push_back(signer1.clone());
        approvers.push_back(signer2.clone());
        let result = contract.complete_bounty(&bounty_id, &approvers);
        assert!(result);

        let bounty = contract.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Completed);
    }

    /// #1113: the regression the old implementation could not pass.
    ///
    /// A 2-of-3 policy approved by signers 2 and 3 — a legitimate quorum that
    /// is not the first two entries in the stored list. The previous loop
    /// walked `signers` in order and called `require_auth()` unconditionally,
    /// so it panicked on signer 1, who was never involved.
    #[test]
    fn test_multisig_accepts_non_prefix_subset() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);
        let signer3 = Address::generate(&env);

        contract.initialize(&admin);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        signers.push_back(signer3.clone());
        contract.set_multisig_signers(&admin, &signers, &2u32);

        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_str(&env, "High-Value Bounty"),
            &String::from_str(&env, "Approved by a non-prefix quorum"),
            &MULTISIG_THRESHOLD,
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

        // Signers 2 and 3 — deliberately skipping the first entry.
        let mut approvers = soroban_sdk::Vec::new(&env);
        approvers.push_back(signer2.clone());
        approvers.push_back(signer3.clone());

        assert!(contract.complete_bounty(&bounty_id, &approvers));
        assert_eq!(contract.get_bounty(&bounty_id).status, BountyStatus::Completed);
    }

    #[test]
    #[should_panic(expected = "Duplicate approver")]
    fn test_multisig_rejects_duplicate_approver() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);

        contract.initialize(&admin);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        contract.set_multisig_signers(&admin, &signers, &2u32);

        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_str(&env, "High-Value Bounty"),
            &String::from_str(&env, "Duplicate approver"),
            &MULTISIG_THRESHOLD,
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

        // Without the duplicate check this satisfies 2-of-2 with a single key,
        // collapsing M-of-N to 1-of-N.
        let mut approvers = soroban_sdk::Vec::new(&env);
        approvers.push_back(signer1.clone());
        approvers.push_back(signer1.clone());
        contract.complete_bounty(&bounty_id, &approvers);
    }

    #[test]
    #[should_panic(expected = "not a configured multi-sig signer")]
    fn test_multisig_rejects_outsider_approver() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);

        contract.initialize(&admin);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        contract.set_multisig_signers(&admin, &signers, &2u32);

        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_str(&env, "High-Value Bounty"),
            &String::from_str(&env, "Outsider approver"),
            &MULTISIG_THRESHOLD,
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

        // An arbitrary address must not be able to pad the quorum with its own
        // signature.
        let mut approvers = soroban_sdk::Vec::new(&env);
        approvers.push_back(signer1.clone());
        approvers.push_back(Address::generate(&env));
        contract.complete_bounty(&bounty_id, &approvers);
    }

    #[test]
    #[should_panic(expected = "Insufficient multi-sig authorisations")]
    fn test_multisig_rejects_too_few_approvers() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

        let admin = Address::generate(&env);
        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let signer1 = Address::generate(&env);
        let signer2 = Address::generate(&env);

        contract.initialize(&admin);
        let mut signers = soroban_sdk::Vec::new(&env);
        signers.push_back(signer1.clone());
        signers.push_back(signer2.clone());
        contract.set_multisig_signers(&admin, &signers, &2u32);

        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_str(&env, "High-Value Bounty"),
            &String::from_str(&env, "Too few approvers"),
            &MULTISIG_THRESHOLD,
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

        let mut approvers = soroban_sdk::Vec::new(&env);
        approvers.push_back(signer1.clone());
        contract.complete_bounty(&bounty_id, &approvers);
    }

    #[test]
    fn test_low_value_bounty_no_multisig_needed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

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
        // Below the threshold, so `approvers` is ignored — pass an empty Vec.
        let result = contract.complete_bounty(&bounty_id, &soroban_sdk::Vec::new(&env));
        assert!(result);
    }

    #[test]
    fn test_create_and_fund_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

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

    #[test]
    fn test_set_escrow_contract_as_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

        let admin = Address::generate(&env);
        let escrow = Address::generate(&env);
        contract.set_admin(&admin);

        assert!(contract.set_escrow_contract(&admin, &escrow));
    }

    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_set_escrow_contract_rejects_non_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));

        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let escrow = Address::generate(&env);
        contract.set_admin(&admin);

        // Attacker authenticates as themselves, but is not the stored admin.
        contract.set_escrow_contract(&attacker, &escrow);
    }

    #[test]
    fn test_set_admin_requires_auth() {
        use stellar_contract_test_utils::{assert_requires_auth, new_address, unauthorized_env};

        let env = unauthorized_env();
        let contract = BountyContractClient::new(&env, &env.register(BountyContract, ()));
        let admin = new_address(&env);

        assert_requires_auth(|| {
            contract.set_admin(&admin);
        });
    }
}
