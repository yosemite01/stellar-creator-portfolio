//! # Insurance Pool Contract (#831, #1711)
//!
//! Accumulates 0.1 % of every platform fee plus policy premiums into a
//! token-denominated pool that pays out claims for **verified** losses.
//!
//! ## Design
//!
//! ```text
//! escrow::release_funds()
//!   └─ calls insurance::contribute_to_pool(fee * 0.001, token)
//!
//! holder            → insurance::buy_policy(escrow_id, token, coverage)   (pays premium)
//! escrow dispute    → escrow::resolve_dispute / resolve_expired_dispute   (records outcome)
//! holder            → insurance::submit_claim(policy_id, amount, evidence)
//!                       └─ cross-contract escrow::get_dispute_outcome(escrow_id)
//! N-of-M assessors  → insurance::approve_claim(claim_id)   (after 3-day window)
//!                       └─ on threshold: reserve min(amount, free balance)
//! admin / claimant  → insurance::execute_payout(claim_id)  (pays the reserved amount)
//! ```
//!
//! ## Storage layout
//!
//! | Key                       | Value          | TTL        |
//! |---------------------------|----------------|------------|
//! | `PoolBalance(token)`      | `i128`         | persistent |
//! | `Reserved(token)`         | `i128`         | persistent |
//! | `Claim(id)`               | `Claim`        | persistent |
//! | `ClaimCounter`            | `u64`          | persistent |
//! | `Policy(id)`              | `Policy`       | persistent |
//! | `PolicyCounter`           | `u64`          | persistent |
//! | `ClaimApprovals(id)`      | `Vec<Address>` | persistent |
//! | `Assessors` / `Threshold` | `Vec<Address>` / `u32` | persistent |
//! | `EscrowContract`          | `Address`      | persistent |
//! | `PremiumBps`              | `u32`          | persistent |
//! | `Admin`                   | `Address`      | persistent |
//!
//! ## Invariants
//!
//! * **Solvency**: `Reserved(token) <= PoolBalance(token)` at all times.
//!   Approval reserves funds; it never reserves more than the free balance
//!   (`pool - reserved`). If the free balance is smaller than the claim, the
//!   claim is approved for the free balance only (pro-rated); if it is zero
//!   approval fails with `InsufficientPoolBalance`.
//! * **Verified losses only**: a claim must reference a policy bought before
//!   the escrow was disputed, and the escrow contract must report a resolved
//!   dispute in which the holder lost at least the claimed amount.
//! * **Per-policy cap**: `claim.amount <= policy.coverage`, one claim per policy.
//! * **Multi-assessor**: `Threshold` distinct assessors must approve. With no
//!   assessors configured the admin is the sole assessor (threshold 1).
//! * Every state change emits an event.

#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    vec, Address, Env, IntoVal, String, Symbol, Val, Vec,
};

// ── Constants ────────────────────────────────────────────────────────────────

/// Insurance levy: 0.1 % = 10 bps of the platform fee collected per escrow.
pub const INSURANCE_BPS: i128 = 10;

/// Governance voting window for claims: 3 days in seconds.
pub const CLAIM_VOTING_PERIOD_SECS: u64 = 3 * 24 * 60 * 60;

/// Default policy premium: 2 % of coverage (200 bps).
pub const DEFAULT_PREMIUM_BPS: u32 = 200;

/// Upper bound on the configurable premium (50 %).
pub const MAX_PREMIUM_BPS: u32 = 5_000;

/// Upper bound on assessor-set size, keeps approval checks cheap.
pub const MAX_ASSESSORS: u32 = 20;

// ── Storage keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// Current balance of the pool for a specific token.
    PoolBalance(Address),
    /// A claim record by numeric ID.
    Claim(u64),
    /// Monotonic counter for claim IDs.
    ClaimCounter,
    /// Contract administrator (set by governance multisig).
    Admin,
    /// Amount approved but not yet paid out, per token (#1711).
    Reserved(Address),
    /// Policy by ID (#1711).
    Policy(u64),
    PolicyCounter,
    /// Assessors who have approved a claim so far (#1711).
    ClaimApprovals(u64),
    /// Assessor set and approval threshold (#1711).
    Assessors,
    Threshold,
    /// Escrow contract queried for dispute outcomes (#1711).
    EscrowContract,
    /// Premium rate charged on policy coverage, in bps (#1711).
    PremiumBps,
}

// ── Error codes ──────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum InsuranceError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ClaimNotFound = 4,
    ClaimNotApproved = 5,
    ClaimAlreadyExecuted = 6,
    InsufficientPoolBalance = 7,
    InvalidAmount = 8,
    VotingPeriodNotEnded = 9,
    ClaimAlreadyApproved = 10,
    // ── #1711 ──
    PolicyNotFound = 11,
    PolicyAlreadyClaimed = 12,
    ExceedsCoverage = 13,
    /// The escrow has no resolved dispute (claim not linked to a verified loss).
    NoVerifiedDispute = 14,
    /// Claimant was not a party to the escrow, or token mismatch.
    NotEscrowParty = 15,
    /// The claimed amount exceeds what the holder lost in the dispute.
    ExceedsLoss = 16,
    /// Policy was bought after the dispute was raised.
    PolicyAfterDispute = 17,
    EscrowNotConfigured = 18,
    AlreadyVoted = 19,
    InvalidAssessorConfig = 20,
    InvalidPremium = 21,
}

// ── Claim lifecycle ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ClaimStatus {
    /// Waiting for assessor approvals.
    Pending,
    /// Threshold reached, funds reserved — ready for `execute_payout`.
    Approved,
    /// Fully paid out.
    Executed,
    /// Rejected by governance.
    Rejected,
}

/// Coverage bought by an escrow party against losing a dispute (#1711).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub id: u64,
    pub holder: Address,
    pub escrow_id: u64,
    pub token: Address,
    /// Maximum payout for this policy.
    pub coverage: i128,
    /// Premium paid into the pool at purchase.
    pub premium: i128,
    pub purchased_at: u64,
    /// Set while a claim is open or paid; cleared if the claim is rejected.
    pub claimed: bool,
}

/// Mirror of the escrow contract's `DisputeOutcome` (field names must match:
/// Soroban structs are encoded as maps keyed by field name).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct DisputeOutcome {
    pub escrow_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub token: Address,
    pub amount: i128,
    pub payer_amount: i128,
    pub payee_amount: i128,
    pub disputed_at: u64,
    pub resolved_at: u64,
}

/// A single insurance claim submitted by a policy holder.
#[contracttype]
pub struct Claim {
    pub id: u64,
    pub claimant: Address,
    /// Token the payout should be denominated in.
    pub token: Address,
    /// Amount requested (capped by coverage and verified loss).
    pub amount: i128,
    /// Arbitrary evidence string supplied by the claimant.
    pub evidence: String,
    pub status: ClaimStatus,
    /// Ledger timestamp when the claim was submitted.
    pub submitted_at: u64,
    /// Earliest ledger timestamp at which assessors may approve.
    /// Set to `submitted_at + CLAIM_VOTING_PERIOD_SECS`.
    pub voting_deadline: u64,
    /// Policy this claim is made against (#1711).
    pub policy_id: u64,
    /// Escrow whose dispute outcome verifies the loss (#1711).
    pub escrow_id: u64,
    /// Amount reserved on approval; may be below `amount` if the pool was
    /// short (pro-rated). Zero until approved (#1711).
    pub approved_amount: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct InsuranceContract;

#[contractimpl]
impl InsuranceContract {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initialize the insurance pool contract. Must be called exactly once.
    ///
    /// `admin` is the governance multisig. It configures the escrow link,
    /// assessors and premium, and rejects claims.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().persistent().has(&DataKey::Admin) {
            panic_with_error!(&env, InsuranceError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::ClaimCounter, &0u64);
    }

    // ── Configuration (#1711) ────────────────────────────────────────────────

    /// Set the escrow contract used to verify dispute outcomes. Admin-only.
    /// Emits `(ins, escrow)`.
    pub fn set_escrow_contract(env: Env, admin: Address, escrow: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage().persistent().set(&DataKey::EscrowContract, &escrow);
        env.events()
            .publish((symbol_short!("ins"), symbol_short!("escrow")), escrow);
    }

    /// Replace the assessor set and approval threshold. Admin-only.
    /// `threshold` must be in `1..=assessors.len()`; assessors must be unique.
    /// Emits `(ins, assessrs)`.
    pub fn set_assessors(env: Env, admin: Address, assessors: Vec<Address>, threshold: u32) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        let n = assessors.len();
        if n == 0 || n > MAX_ASSESSORS || threshold == 0 || threshold > n {
            panic_with_error!(&env, InsuranceError::InvalidAssessorConfig);
        }
        for i in 0..n {
            for j in (i + 1)..n {
                if assessors.get_unchecked(i) == assessors.get_unchecked(j) {
                    panic_with_error!(&env, InsuranceError::InvalidAssessorConfig);
                }
            }
        }
        env.storage().persistent().set(&DataKey::Assessors, &assessors);
        env.storage().persistent().set(&DataKey::Threshold, &threshold);
        env.events().publish(
            (symbol_short!("ins"), symbol_short!("assessrs")),
            (n, threshold),
        );
    }

    /// Set the premium rate charged on coverage (bps). Admin-only.
    /// Emits `(ins, premium)`.
    pub fn set_premium_bps(env: Env, admin: Address, premium_bps: u32) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        if premium_bps == 0 || premium_bps > MAX_PREMIUM_BPS {
            panic_with_error!(&env, InsuranceError::InvalidPremium);
        }
        env.storage().persistent().set(&DataKey::PremiumBps, &premium_bps);
        env.events()
            .publish((symbol_short!("ins"), symbol_short!("premium")), premium_bps);
    }

    pub fn get_premium_bps(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PremiumBps)
            .unwrap_or(DEFAULT_PREMIUM_BPS)
    }

    /// Current assessor set and threshold. Falls back to `([admin], 1)`.
    pub fn get_assessors(env: Env) -> (Vec<Address>, u32) {
        Self::require_initialized(&env);
        Self::assessor_config(&env)
    }

    // ── Pool management ───────────────────────────────────────────────────────

    /// Deposit tokens into the insurance pool.
    ///
    /// Called by the escrow contract on every fee collection.  The caller
    /// is responsible for computing the levy amount before calling this
    /// function (i.e. `amount = fee * INSURANCE_BPS / 10_000`).
    pub fn contribute_to_pool(env: Env, from: Address, amount: i128, token: Address) {
        from.require_auth();
        Self::require_initialized(&env);

        if amount <= 0 {
            panic_with_error!(&env, InsuranceError::InvalidAmount);
        }

        // Pull tokens into this contract.
        token::Client::new(&env, &token).transfer(&from, env.current_contract_address(), &amount);
        Self::credit_pool(&env, &token, amount);

        env.events().publish(
            (symbol_short!("ins"), symbol_short!("contrib")),
            (from, token, amount),
        );
    }

    /// Return the current pool balance for a given token (including reserved).
    pub fn get_pool_balance(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::PoolBalance(token))
            .unwrap_or(0)
    }

    /// Amount approved but not yet paid out for `token` (#1711).
    pub fn get_reserved(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::Reserved(token))
            .unwrap_or(0)
    }

    /// Pool balance not committed to approved claims (#1711).
    pub fn get_available_balance(env: Env, token: Address) -> i128 {
        Self::get_pool_balance(env.clone(), token.clone()) - Self::get_reserved(env, token)
    }

    // ── Policies (#1711) ──────────────────────────────────────────────────────

    /// Buy coverage for an escrow. The premium (`coverage * premium_bps /
    /// 10_000`, at least 1 unit) is transferred into the pool. Party and
    /// token are verified at claim time against the escrow's dispute outcome,
    /// and only policies bought *before* the dispute was raised can claim.
    /// Emits `(ins, policy)`.
    pub fn buy_policy(env: Env, holder: Address, escrow_id: u64, token: Address, coverage: i128) -> u64 {
        holder.require_auth();
        Self::require_initialized(&env);
        if coverage <= 0 {
            panic_with_error!(&env, InsuranceError::InvalidAmount);
        }
        let bps = Self::get_premium_bps(env.clone()) as i128;
        let mut premium = coverage
            .checked_mul(bps)
            .unwrap_or_else(|| panic_with_error!(&env, InsuranceError::InvalidAmount))
            / 10_000;
        if premium == 0 {
            premium = 1;
        }
        token::Client::new(&env, &token).transfer(&holder, env.current_contract_address(), &premium);
        Self::credit_pool(&env, &token, premium);

        let id: u64 = env.storage().persistent().get(&DataKey::PolicyCounter).unwrap_or(0);
        let policy = Policy {
            id,
            holder: holder.clone(),
            escrow_id,
            token: token.clone(),
            coverage,
            premium,
            purchased_at: env.ledger().timestamp(),
            claimed: false,
        };
        env.storage().persistent().set(&DataKey::Policy(id), &policy);
        env.storage().persistent().set(&DataKey::PolicyCounter, &(id + 1));
        env.events().publish(
            (symbol_short!("ins"), symbol_short!("policy")),
            (id, holder, escrow_id, token, coverage, premium),
        );
        id
    }

    pub fn get_policy(env: Env, policy_id: u64) -> Policy {
        Self::load_policy(&env, policy_id)
    }

    // ── Claims ────────────────────────────────────────────────────────────────

    /// Submit a claim against a policy.
    ///
    /// The escrow contract is queried for the policy's escrow dispute
    /// outcome. The claim is rejected unless:
    /// * the dispute is resolved (`NoVerifiedDispute`),
    /// * the claimant is the policy holder and a party to the escrow, and the
    ///   token matches (`NotEscrowParty`),
    /// * the policy predates the dispute (`PolicyAfterDispute`),
    /// * `amount <= coverage` (`ExceedsCoverage`) and `amount <=` the
    ///   holder's loss in the outcome (`ExceedsLoss`).
    ///
    /// Returns the new claim ID. Emits `(ins, claim)`.
    pub fn submit_claim(
        env: Env,
        claimant: Address,
        policy_id: u64,
        amount: i128,
        evidence: String,
    ) -> u64 {
        claimant.require_auth();
        Self::require_initialized(&env);

        if amount <= 0 {
            panic_with_error!(&env, InsuranceError::InvalidAmount);
        }

        let mut policy = Self::load_policy(&env, policy_id);
        if policy.holder != claimant {
            panic_with_error!(&env, InsuranceError::Unauthorized);
        }
        if policy.claimed {
            panic_with_error!(&env, InsuranceError::PolicyAlreadyClaimed);
        }
        if amount > policy.coverage {
            panic_with_error!(&env, InsuranceError::ExceedsCoverage);
        }

        let outcome = Self::fetch_dispute_outcome(&env, policy.escrow_id);
        if outcome.token != policy.token {
            panic_with_error!(&env, InsuranceError::NotEscrowParty);
        }
        let loss = if claimant == outcome.payer {
            outcome.amount - outcome.payer_amount
        } else if claimant == outcome.payee {
            outcome.amount - outcome.payee_amount
        } else {
            panic_with_error!(&env, InsuranceError::NotEscrowParty)
        };
        if policy.purchased_at >= outcome.disputed_at {
            panic_with_error!(&env, InsuranceError::PolicyAfterDispute);
        }
        if amount > loss {
            panic_with_error!(&env, InsuranceError::ExceedsLoss);
        }

        policy.claimed = true;
        env.storage().persistent().set(&DataKey::Policy(policy_id), &policy);

        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ClaimCounter)
            .unwrap_or(0);

        let submitted_at = env.ledger().timestamp();
        let claim = Claim {
            id,
            claimant: claimant.clone(),
            token: policy.token.clone(),
            amount,
            evidence,
            status: ClaimStatus::Pending,
            submitted_at,
            voting_deadline: submitted_at + CLAIM_VOTING_PERIOD_SECS,
            policy_id,
            escrow_id: policy.escrow_id,
            approved_amount: 0,
        };
        env.storage().persistent().set(&DataKey::Claim(id), &claim);
        env.storage()
            .persistent()
            .set(&DataKey::ClaimCounter, &(id + 1));

        env.events().publish(
            (symbol_short!("ins"), symbol_short!("claim")),
            (id, claimant, policy.token, amount, policy_id, policy.escrow_id),
        );
        id
    }

    /// Record an assessor's approval of a pending claim.
    ///
    /// The voting deadline must have elapsed. Each assessor may vote once.
    /// When the threshold is reached the claim moves to `Approved` and
    /// `min(amount, available)` is reserved from the pool (pro-rated if the
    /// pool is short; `InsufficientPoolBalance` if nothing is free).
    ///
    /// Emits `(ins, vote)` per approval and `(ins, approved)` on threshold.
    pub fn approve_claim(env: Env, assessor: Address, claim_id: u64) {
        assessor.require_auth();
        Self::require_initialized(&env);
        let (assessors, threshold) = Self::assessor_config(&env);
        if !assessors.contains(&assessor) {
            panic_with_error!(&env, InsuranceError::Unauthorized);
        }

        let mut claim = Self::load_claim(&env, claim_id);
        if env.ledger().timestamp() < claim.voting_deadline {
            panic_with_error!(&env, InsuranceError::VotingPeriodNotEnded);
        }
        if claim.status != ClaimStatus::Pending {
            panic_with_error!(&env, InsuranceError::ClaimAlreadyApproved);
        }

        let key = DataKey::ClaimApprovals(claim_id);
        let mut approvals: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));
        if approvals.contains(&assessor) {
            panic_with_error!(&env, InsuranceError::AlreadyVoted);
        }
        approvals.push_back(assessor.clone());
        env.storage().persistent().set(&key, &approvals);
        env.events().publish(
            (symbol_short!("ins"), symbol_short!("vote")),
            (claim_id, assessor, approvals.len(), threshold),
        );

        if approvals.len() < threshold {
            return;
        }

        let available = Self::get_available_balance(env.clone(), claim.token.clone());
        if available <= 0 {
            panic_with_error!(&env, InsuranceError::InsufficientPoolBalance);
        }
        let reserve = if claim.amount > available { available } else { claim.amount };
        let reserved = Self::get_reserved(env.clone(), claim.token.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Reserved(claim.token.clone()), &(reserved + reserve));

        claim.status = ClaimStatus::Approved;
        claim.approved_amount = reserve;
        env.storage()
            .persistent()
            .set(&DataKey::Claim(claim_id), &claim);
        env.events().publish(
            (symbol_short!("ins"), symbol_short!("approved")),
            (claim_id, claim.amount, reserve),
        );
    }

    /// Approvals recorded so far for a claim.
    pub fn get_claim_approvals(env: Env, claim_id: u64) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::ClaimApprovals(claim_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Reject a pending claim. Admin-only. Frees the policy for a new claim.
    /// Emits `(ins, rejected)`.
    pub fn reject_claim(env: Env, admin: Address, claim_id: u64) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let mut claim = Self::load_claim(&env, claim_id);
        if claim.status != ClaimStatus::Pending {
            panic_with_error!(&env, InsuranceError::ClaimAlreadyApproved);
        }
        claim.status = ClaimStatus::Rejected;
        env.storage()
            .persistent()
            .set(&DataKey::Claim(claim_id), &claim);

        let mut policy = Self::load_policy(&env, claim.policy_id);
        policy.claimed = false;
        env.storage().persistent().set(&DataKey::Policy(claim.policy_id), &policy);

        env.events().publish(
            (symbol_short!("ins"), symbol_short!("rejected")),
            claim_id,
        );
    }

    /// Pay out an approved claim's reserved amount to the claimant.
    ///
    /// `caller` must be the admin or the claimant. The payout is exactly
    /// `claim.approved_amount`, which was reserved at approval, so the pool
    /// can never be overdrawn. Emits `(ins, payout)`.
    pub fn execute_payout(env: Env, caller: Address, claim_id: u64) {
        caller.require_auth();
        Self::require_initialized(&env);

        let mut claim = Self::load_claim(&env, claim_id);
        let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
        if caller != admin && caller != claim.claimant {
            panic_with_error!(&env, InsuranceError::Unauthorized);
        }
        if claim.status != ClaimStatus::Approved {
            if claim.status == ClaimStatus::Executed {
                panic_with_error!(&env, InsuranceError::ClaimAlreadyExecuted);
            } else {
                panic_with_error!(&env, InsuranceError::ClaimNotApproved);
            }
        }

        let payout = claim.approved_amount;
        let pool_balance = Self::get_pool_balance(env.clone(), claim.token.clone());
        let reserved = Self::get_reserved(env.clone(), claim.token.clone());
        if payout > pool_balance || payout > reserved {
            // Unreachable while the solvency invariant holds.
            panic_with_error!(&env, InsuranceError::InsufficientPoolBalance);
        }

        // EFFECTS before the token transfer.
        env.storage().persistent().set(
            &DataKey::PoolBalance(claim.token.clone()),
            &(pool_balance - payout),
        );
        env.storage().persistent().set(
            &DataKey::Reserved(claim.token.clone()),
            &(reserved - payout),
        );
        claim.status = ClaimStatus::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::Claim(claim_id), &claim);

        token::Client::new(&env, &claim.token).transfer(
            &env.current_contract_address(),
            &claim.claimant,
            &payout,
        );

        env.events().publish(
            (symbol_short!("ins"), symbol_short!("payout")),
            (claim_id, claim.claimant, claim.token, payout),
        );
    }

    /// Retrieve a claim record by ID.
    pub fn get_claim(env: Env, claim_id: u64) -> Claim {
        Self::require_initialized(&env);
        Self::load_claim(&env, claim_id)
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
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
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
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &stored_admin);
        env.storage().persistent().set(&DataKey::Admin, &accepted);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn require_initialized(env: &Env) {
        if !env.storage().persistent().has(&DataKey::Admin) {
            panic_with_error!(env, InsuranceError::NotInitialized);
        }
    }

    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, InsuranceError::NotInitialized));
        if *caller != admin {
            panic_with_error!(env, InsuranceError::Unauthorized);
        }
    }

    fn assessor_config(env: &Env) -> (Vec<Address>, u32) {
        match env.storage().persistent().get::<DataKey, Vec<Address>>(&DataKey::Assessors) {
            Some(a) => {
                let t: u32 = env.storage().persistent().get(&DataKey::Threshold).unwrap_or(1);
                (a, t)
            }
            None => {
                let admin: Address = env.storage().persistent().get(&DataKey::Admin).unwrap();
                (vec![env, admin], 1)
            }
        }
    }

    fn credit_pool(env: &Env, token: &Address, amount: i128) {
        let current = Self::get_pool_balance(env.clone(), token.clone());
        env.storage()
            .persistent()
            .set(&DataKey::PoolBalance(token.clone()), &(current + amount));
    }

    fn fetch_dispute_outcome(env: &Env, escrow_id: u64) -> DisputeOutcome {
        let escrow: Address = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowContract)
            .unwrap_or_else(|| panic_with_error!(env, InsuranceError::EscrowNotConfigured));
        let args: Vec<Val> = vec![env, escrow_id.into_val(env)];
        let outcome: Option<DisputeOutcome> =
            env.invoke_contract(&escrow, &Symbol::new(env, "get_dispute_outcome"), args);
        outcome.unwrap_or_else(|| panic_with_error!(env, InsuranceError::NoVerifiedDispute))
    }

    fn load_claim(env: &Env, claim_id: u64) -> Claim {
        env.storage()
            .persistent()
            .get::<DataKey, Claim>(&DataKey::Claim(claim_id))
            .unwrap_or_else(|| panic_with_error!(env, InsuranceError::ClaimNotFound))
    }

    fn load_policy(env: &Env, policy_id: u64) -> Policy {
        env.storage()
            .persistent()
            .get::<DataKey, Policy>(&DataKey::Policy(policy_id))
            .unwrap_or_else(|| panic_with_error!(env, InsuranceError::PolicyNotFound))
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Env,
    };

    /// Minimal stand-in for the escrow contract's `get_dispute_outcome`.
    #[contract]
    pub struct MockEscrow;

    #[contractimpl]
    impl MockEscrow {
        pub fn set_outcome(env: Env, outcome: DisputeOutcome) {
            env.storage().persistent().set(&outcome.escrow_id, &outcome);
        }
        pub fn get_dispute_outcome(env: Env, escrow_id: u64) -> Option<DisputeOutcome> {
            env.storage().persistent().get(&escrow_id)
        }
    }

    struct Ctx<'a> {
        env: Env,
        client: InsuranceContractClient<'a>,
        admin: Address,
        token: Address,
        escrow: MockEscrowClient<'a>,
        payer: Address,
        payee: Address,
    }

    fn setup<'a>() -> Ctx<'a> {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let id = env.register(InsuranceContract, ());
        let client = InsuranceContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let token = sac.address();
        let escrow_id = env.register(MockEscrow, ());
        let escrow = MockEscrowClient::new(&env, &escrow_id);
        client.set_escrow_contract(&admin, &escrow_id);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sa = StellarAssetClient::new(&env, &token);
        sa.mint(&payer, &10_000);
        sa.mint(&payee, &10_000);
        Ctx { env, client, admin, token, escrow, payer, payee }
    }

    /// Fund the pool with `amount` from a fresh contributor.
    fn fund(c: &Ctx, amount: i128) {
        let from = Address::generate(&c.env);
        StellarAssetClient::new(&c.env, &c.token).mint(&from, &amount);
        c.client.contribute_to_pool(&from, &amount, &c.token);
    }

    /// Record a resolved dispute in which the payer lost `payer_loss`.
    fn resolve(c: &Ctx, escrow_id: u64, amount: i128, payer_loss: i128) {
        let now = c.env.ledger().timestamp();
        c.escrow.set_outcome(&DisputeOutcome {
            escrow_id,
            payer: c.payer.clone(),
            payee: c.payee.clone(),
            token: c.token.clone(),
            amount,
            payer_amount: amount - payer_loss,
            payee_amount: payer_loss,
            disputed_at: now + 10,
            resolved_at: now + 20,
        });
        c.env.ledger().with_mut(|l| l.timestamp = now + 30);
    }

    fn pass_voting(c: &Ctx) {
        c.env.ledger().with_mut(|l| l.timestamp += CLAIM_VOTING_PERIOD_SECS + 1);
    }

    fn ev(c: &Ctx) -> String {
        String::from_str(&c.env, "dispute #1")
    }

    #[test]
    fn test_initialize_and_pool_balance_zero() {
        let c = setup();
        assert_eq!(c.client.get_pool_balance(&c.token), 0);
        assert_eq!(c.client.get_reserved(&c.token), 0);
    }

    #[test]
    #[should_panic]
    fn test_double_initialize_panics() {
        let c = setup();
        c.client.initialize(&c.admin);
    }

    #[test]
    fn test_buy_policy_charges_premium_into_pool() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        let p = c.client.get_policy(&pid);
        assert_eq!(p.premium, 20); // 2 % default
        assert_eq!(c.client.get_pool_balance(&c.token), 20);
    }

    #[test]
    fn test_full_flow_verified_claim_paid() {
        let c = setup();
        fund(&c, 5_000);
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 800);
        let id = c.client.submit_claim(&c.payer, &pid, &800, &ev(&c));
        pass_voting(&c);
        c.client.approve_claim(&c.admin, &id);
        assert_eq!(c.client.get_claim(&id).status, ClaimStatus::Approved);
        assert_eq!(c.client.get_reserved(&c.token), 800);
        c.client.execute_payout(&c.payer, &id);
        assert_eq!(c.client.get_claim(&id).status, ClaimStatus::Executed);
        assert_eq!(c.client.get_reserved(&c.token), 0);
        assert_eq!(c.client.get_pool_balance(&c.token), 5_020 - 800);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn test_claim_without_matching_dispute_rejected() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        c.client.submit_claim(&c.payer, &pid, &100, &ev(&c));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #16)")]
    fn test_claim_above_verified_loss_rejected() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 300);
        c.client.submit_claim(&c.payer, &pid, &301, &ev(&c));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #13)")]
    fn test_claim_above_coverage_rejected() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &100);
        resolve(&c, 1, 2_000, 1_000);
        c.client.submit_claim(&c.payer, &pid, &101, &ev(&c));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #17)")]
    fn test_policy_bought_after_dispute_rejected() {
        let c = setup();
        resolve(&c, 1, 2_000, 1_000);
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        c.client.submit_claim(&c.payer, &pid, &100, &ev(&c));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #12)")]
    fn test_one_claim_per_policy() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 1_000);
        c.client.submit_claim(&c.payer, &pid, &100, &ev(&c));
        c.client.submit_claim(&c.payer, &pid, &100, &ev(&c));
    }

    #[test]
    fn test_approval_pro_rates_when_pool_short() {
        let c = setup();
        fund(&c, 480); // pool = 480 + 2 premiums of 20 = 520
        let p1 = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        let p2 = c.client.buy_policy(&c.payer, &2, &c.token, &1_000);
        resolve(&c, 1, 1_000, 400);
        resolve(&c, 2, 1_000, 400);
        let a = c.client.submit_claim(&c.payer, &p1, &400, &ev(&c));
        let b = c.client.submit_claim(&c.payer, &p2, &400, &ev(&c));
        pass_voting(&c);
        c.client.approve_claim(&c.admin, &a);
        c.client.approve_claim(&c.admin, &b);
        assert_eq!(c.client.get_claim(&a).approved_amount, 400);
        assert_eq!(c.client.get_claim(&b).approved_amount, 120);
        // Solvency: reserved never exceeds the pool.
        assert_eq!(c.client.get_reserved(&c.token), c.client.get_pool_balance(&c.token));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_approval_fails_when_pool_fully_reserved() {
        let c = setup();
        let p1 = c.client.buy_policy(&c.payer, &1, &c.token, &1_000); // pool = 20
        let p2 = c.client.buy_policy(&c.payer, &2, &c.token, &1_000); // pool = 40
        resolve(&c, 1, 1_000, 500);
        resolve(&c, 2, 1_000, 500);
        let a = c.client.submit_claim(&c.payer, &p1, &500, &ev(&c));
        let b = c.client.submit_claim(&c.payer, &p2, &500, &ev(&c));
        pass_voting(&c);
        c.client.approve_claim(&c.admin, &a); // reserves all 40
        c.client.approve_claim(&c.admin, &b);
    }

    #[test]
    fn test_multi_assessor_threshold() {
        let c = setup();
        fund(&c, 5_000);
        let a1 = Address::generate(&c.env);
        let a2 = Address::generate(&c.env);
        let a3 = Address::generate(&c.env);
        c.client.set_assessors(&c.admin, &vec![&c.env, a1.clone(), a2.clone(), a3.clone()], &2);
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 500);
        let id = c.client.submit_claim(&c.payer, &pid, &500, &ev(&c));
        pass_voting(&c);
        c.client.approve_claim(&a1, &id);
        assert_eq!(c.client.get_claim(&id).status, ClaimStatus::Pending);
        assert_eq!(c.client.get_reserved(&c.token), 0);
        c.client.approve_claim(&a2, &id);
        assert_eq!(c.client.get_claim(&id).status, ClaimStatus::Approved);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #19)")]
    fn test_assessor_cannot_vote_twice() {
        let c = setup();
        let a1 = Address::generate(&c.env);
        let a2 = Address::generate(&c.env);
        c.client.set_assessors(&c.admin, &vec![&c.env, a1.clone(), a2.clone()], &2);
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 500);
        let id = c.client.submit_claim(&c.payer, &pid, &500, &ev(&c));
        pass_voting(&c);
        c.client.approve_claim(&a1, &id);
        c.client.approve_claim(&a1, &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_non_assessor_cannot_approve() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 500);
        let id = c.client.submit_claim(&c.payer, &pid, &500, &ev(&c));
        pass_voting(&c);
        c.client.approve_claim(&Address::generate(&c.env), &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_non_admin_cannot_set_assessors() {
        let c = setup();
        let a1 = Address::generate(&c.env);
        c.client.set_assessors(&a1, &vec![&c.env, a1.clone()], &1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #20)")]
    fn test_invalid_threshold_rejected() {
        let c = setup();
        let a1 = Address::generate(&c.env);
        c.client.set_assessors(&c.admin, &vec![&c.env, a1], &2);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn test_approve_before_voting_deadline_panics() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 500);
        let id = c.client.submit_claim(&c.payer, &pid, &500, &ev(&c));
        c.client.approve_claim(&c.admin, &id);
    }

    #[test]
    fn test_reject_claim_frees_policy() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 500);
        let id = c.client.submit_claim(&c.payer, &pid, &500, &ev(&c));
        c.client.reject_claim(&c.admin, &id);
        assert_eq!(c.client.get_claim(&id).status, ClaimStatus::Rejected);
        assert!(!c.client.get_policy(&pid).claimed);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_execute_payout_on_pending_claim_panics() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 500);
        let id = c.client.submit_claim(&c.payer, &pid, &500, &ev(&c));
        c.client.execute_payout(&c.admin, &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_stranger_cannot_execute_payout() {
        let c = setup();
        fund(&c, 5_000);
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 500);
        let id = c.client.submit_claim(&c.payer, &pid, &500, &ev(&c));
        pass_voting(&c);
        c.client.approve_claim(&c.admin, &id);
        c.client.execute_payout(&Address::generate(&c.env), &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #15)")]
    fn test_non_party_policy_holder_rejected() {
        let c = setup();
        let stranger = Address::generate(&c.env);
        StellarAssetClient::new(&c.env, &c.token).mint(&stranger, &1_000);
        let pid = c.client.buy_policy(&stranger, &1, &c.token, &1_000);
        resolve(&c, 1, 2_000, 500);
        c.client.submit_claim(&stranger, &pid, &100, &ev(&c));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_submit_claim_zero_amount_panics() {
        let c = setup();
        let pid = c.client.buy_policy(&c.payer, &1, &c.token, &1_000);
        c.client.submit_claim(&c.payer, &pid, &0, &ev(&c));
    }

    #[test]
    fn test_insurance_bps_constant() {
        assert_eq!(INSURANCE_BPS, 10);
        assert_eq!(1_000i128 * INSURANCE_BPS / 10_000, 1);
    }
}

// Issue #1719: shared upgrade-timelock conformance tests.
stellar_upgradeable::upgrade_timelock_tests!(
    upgrade_conformance,
    InsuranceContract,
    InsuranceContractClient,
    |env, id, admin| {
        InsuranceContractClient::new(&env, &id).initialize(&admin);
    }
);
