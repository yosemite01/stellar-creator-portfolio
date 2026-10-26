//! # Insurance Pool Contract (#831)
//!
//! Accumulates 0.1 % of every platform fee into a token-denominated pool that
//! can pay out verified claims approved by governance.
//!
//! ## Design
//!
//! ```text
//! escrow::release_funds()
//!   └─ calls insurance::contribute_to_pool(fee * 0.001, token)
//!
//! user              → insurance::submit_claim(amount, evidence)
//! governance vote   → insurance::approve_claim(claim_id)    (3-day window)
//! governance/admin  → insurance::execute_payout(claim_id)
//! ```
//!
//! ## Storage layout
//!
//! | Key                       | Value      | TTL      |
//! |---------------------------|------------|----------|
//! | `PoolBalance(token)`      | `i128`     | persistent |
//! | `Claim(id)`               | `Claim`    | persistent |
//! | `ClaimCounter`            | `u64`      | persistent |
//! | `Admin`                   | `Address`  | persistent |
//!
//! ## Invariants
//!
//! * Pool balance **never** goes negative: `execute_payout` panics if the
//!   requested amount exceeds the pool.
//! * Claims accumulate in the `Pending` state until governance calls
//!   `approve_claim`.  Only approved, un-executed claims can be paid out.
//! * The 0.1 % insurance levy is computed by the caller (escrow contract)
//!   before calling `contribute_to_pool`, keeping this contract stateless
//!   with respect to fee logic.

#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, Env, String,
};

// ── Basis-point constant ─────────────────────────────────────────────────────

/// Insurance levy: 0.1 % = 10 bps of the platform fee collected per escrow.
pub const INSURANCE_BPS: i128 = 10;

/// Governance voting window for claims: 3 days in seconds.
pub const CLAIM_VOTING_PERIOD_SECS: u64 = 3 * 24 * 60 * 60;

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
}

// ── Claim lifecycle ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ClaimStatus {
    /// Waiting for governance vote.
    Pending,
    /// Governance approved — ready for `execute_payout`.
    Approved,
    /// Fully paid out.
    Executed,
    /// Rejected by governance.
    Rejected,
}

/// A single insurance claim submitted by a user.
#[contracttype]
pub struct Claim {
    pub id: u64,
    pub claimant: Address,
    /// Token the payout should be denominated in.
    pub token: Address,
    /// Amount requested (must not exceed pool balance at execution time).
    pub amount: i128,
    /// Arbitrary evidence string supplied by the claimant.
    pub evidence: String,
    pub status: ClaimStatus,
    /// Ledger timestamp when the claim was submitted.
    pub submitted_at: u64,
    /// Earliest ledger timestamp at which governance may approve/reject.
    /// Set to `submitted_at + CLAIM_VOTING_PERIOD_SECS`.
    pub voting_deadline: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct InsuranceContract;

#[contractimpl]
impl InsuranceContract {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initialize the insurance pool contract.
    ///
    /// Stores the governance multisig address as the contract admin and
    /// sets the claim counter to zero.  Must be called exactly once before
    /// any other public function.
    ///
    /// # Arguments
    ///
    /// * `admin` – Address of the governance multisig that will control
    ///   claim approvals, rejections, and payouts.
    ///
    /// # Panics
    ///
    /// * Panics with `InsuranceError::AlreadyInitialized` if the contract
    ///   has already been initialized.
    /// * Panics if `admin` does not authorize the transaction.
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

    // ── Pool management ───────────────────────────────────────────────────────

    /// Deposit tokens into the insurance pool.
    ///
    /// Called by the escrow contract on every fee collection.  The caller
    /// is responsible for computing the levy amount before calling this
    /// function (i.e. `amount = fee * INSURANCE_BPS / 10_000`).
    ///
    /// # Arguments
    ///
    /// * `from`   – Address transferring the tokens (typically the escrow
    ///              contract address).  Must authorize the transaction.
    /// * `amount` – Positive number of token units to deposit.
    /// * `token`  – Soroban address of the SPL token contract.
    ///
    /// # Errors
    ///
    /// * `InsuranceError::InvalidAmount` – if `amount <= 0`.
    /// * `InsuranceError::NotInitialized` – if `initialize` has not been called.
    ///
    /// # Panics
    ///
    /// * Panics if `from` does not authorize the transaction.
    pub fn contribute_to_pool(env: Env, from: Address, amount: i128, token: Address) {
        from.require_auth();
        Self::require_initialized(&env);

        if amount <= 0 {
            panic_with_error!(&env, InsuranceError::InvalidAmount);
        }

        // Pull tokens into this contract.
        token::Client::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);

        let current = Self::get_pool_balance(env.clone(), token.clone());
        env.storage()
            .persistent()
            .set(&DataKey::PoolBalance(token.clone()), &(current + amount));

        env.events().publish(
            (symbol_short!("ins"), symbol_short!("contrib")),
            (from, token, amount),
        );
    }

    /// Return the current pool balance for a given token.
    ///
    /// # Arguments
    ///
    /// * `token` – Soroban address of the token to query.
    ///
    /// # Returns
    ///
    /// The number of token units currently held in the pool.  Returns `0`
    /// if no deposits have been made for this token yet.
    pub fn get_pool_balance(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, i128>(&DataKey::PoolBalance(token))
            .unwrap_or(0)
    }

    // ── Claims ────────────────────────────────────────────────────────────────

    /// Submit a new insurance claim.
    ///
    /// Creates a claim in `Pending` status.  Governance has
    /// `CLAIM_VOTING_PERIOD_SECS` (3 days) to review and call
    /// `approve_claim` or `reject_claim` before the voting deadline.
    ///
    /// # Arguments
    ///
    /// * `claimant` – Address of the user submitting the claim.  Must
    ///                authorize the transaction.
    /// * `amount`   – Number of token units requested as payout.
    /// * `token`    – Soroban address of the token for the payout.
    /// * `evidence` – Arbitrary string describing the claim (e.g. a
    ///                transaction hash or IPFS CID).
    ///
    /// # Returns
    ///
    /// The newly assigned claim ID (monotonically increasing `u64`).
    ///
    /// # Errors
    ///
    /// * `InsuranceError::InvalidAmount` – if `amount <= 0`.
    /// * `InsuranceError::NotInitialized` – if `initialize` has not been called.
    ///
    /// # Panics
    ///
    /// * Panics if `claimant` does not authorize the transaction.
    pub fn submit_claim(
        env: Env,
        claimant: Address,
        amount: i128,
        token: Address,
        evidence: String,
    ) -> u64 {
        claimant.require_auth();
        Self::require_initialized(&env);

        if amount <= 0 {
            panic_with_error!(&env, InsuranceError::InvalidAmount);
        }

        let id: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ClaimCounter)
            .unwrap_or(0);

        let submitted_at = env.ledger().timestamp();
        let claim = Claim {
            id,
            claimant: claimant.clone(),
            token: token.clone(),
            amount,
            evidence,
            status: ClaimStatus::Pending,
            submitted_at,
            voting_deadline: submitted_at + CLAIM_VOTING_PERIOD_SECS,
        };
        env.storage().persistent().set(&DataKey::Claim(id), &claim);
        env.storage()
            .persistent()
            .set(&DataKey::ClaimCounter, &(id + 1));

        env.events().publish(
            (symbol_short!("ins"), symbol_short!("claim")),
            (id, claimant, token, amount),
        );
        id
    }

    /// Approve a pending claim.
    ///
    /// Only the admin (governance multisig) may call this.  The claim's
    /// voting deadline must have elapsed.
    ///
    /// # Arguments
    ///
    /// * `admin`    – Address of the governance multisig.  Must authorize
    ///                the transaction and match the stored admin.
    /// * `claim_id` – ID of the claim to approve.
    ///
    /// # Errors
    ///
    /// * `InsuranceError::Unauthorized`        – if `admin` is not the stored admin.
    /// * `InsuranceError::ClaimNotFound`       – if no claim exists with `claim_id`.
    /// * `InsuranceError::ClaimAlreadyApproved` – if the claim is not in `Pending`
    ///   status (i.e. already approved, rejected, or executed).
    /// * `InsuranceError::VotingPeriodNotEnded` – if the current ledger timestamp
    ///   is before `claim.voting_deadline`.
    ///
    /// # Panics
    ///
    /// * Panics if `admin` does not authorize the transaction.
    pub fn approve_claim(env: Env, admin: Address, claim_id: u64) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let mut claim = Self::load_claim(&env, claim_id);
        if env.ledger().timestamp() < claim.voting_deadline {
            panic_with_error!(&env, InsuranceError::VotingPeriodNotEnded);
        }
        if claim.status != ClaimStatus::Pending {
            panic_with_error!(&env, InsuranceError::ClaimAlreadyApproved);
        }
        claim.status = ClaimStatus::Approved;
        env.storage()
            .persistent()
            .set(&DataKey::Claim(claim_id), &claim);
        env.events().publish(
            (symbol_short!("ins"), symbol_short!("approved")),
            claim_id,
        );
    }

    /// Reject a pending claim.
    ///
    /// Only the admin (governance multisig) may call this.  The claim
    /// must still be in `Pending` status.
    ///
    /// # Arguments
    ///
    /// * `admin`    – Address of the governance multisig.  Must authorize
    ///                the transaction and match the stored admin.
    /// * `claim_id` – ID of the claim to reject.
    ///
    /// # Errors
    ///
    /// * `InsuranceError::Unauthorized`         – if `admin` is not the stored admin.
    /// * `InsuranceError::ClaimNotFound`        – if no claim exists with `claim_id`.
    /// * `InsuranceError::ClaimAlreadyApproved` – if the claim is not in `Pending`
    ///   status (i.e. already approved, rejected, or executed).
    ///
    /// # Panics
    ///
    /// * Panics if `admin` does not authorize the transaction.
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
        env.events().publish(
            (symbol_short!("ins"), symbol_short!("rejected")),
            claim_id,
        );
    }

    /// Execute payout for an approved claim.
    ///
    /// Transfers `claim.amount` token units from the pool to the
    /// claimant and marks the claim as `Executed`.  Only the admin
    /// (governance multisig) may call this.
    ///
    /// # Arguments
    ///
    /// * `admin`    – Address of the governance multisig.  Must authorize
    ///                the transaction and match the stored admin.
    /// * `claim_id` – ID of the approved claim to pay out.
    ///
    /// # Errors
    ///
    /// * `InsuranceError::Unauthorized`           – if `admin` is not the stored admin.
    /// * `InsuranceError::ClaimNotFound`          – if no claim exists with `claim_id`.
    /// * `InsuranceError::ClaimNotApproved`       – if the claim status is not
    ///   `Approved` (e.g. `Pending` or `Rejected`).
    /// * `InsuranceError::ClaimAlreadyExecuted`   – if the claim has already been
    ///   paid out.
    /// * `InsuranceError::InsufficientPoolBalance` – if the pool does not hold
    ///   enough tokens to cover `claim.amount`.
    ///
    /// # Panics
    ///
    /// * Panics if `admin` does not authorize the transaction.
    pub fn execute_payout(env: Env, admin: Address, claim_id: u64) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        let mut claim = Self::load_claim(&env, claim_id);
        if claim.status != ClaimStatus::Approved {
            if claim.status == ClaimStatus::Executed {
                panic_with_error!(&env, InsuranceError::ClaimAlreadyExecuted);
            } else {
                panic_with_error!(&env, InsuranceError::ClaimNotApproved);
            }
        }

        let pool_balance = Self::get_pool_balance(env.clone(), claim.token.clone());
        if claim.amount > pool_balance {
            panic_with_error!(&env, InsuranceError::InsufficientPoolBalance);
        }

        // Transfer payout to claimant.
        token::Client::new(&env, &claim.token).transfer(
            &env.current_contract_address(),
            &claim.claimant,
            &claim.amount,
        );

        // Update pool balance.
        env.storage().persistent().set(
            &DataKey::PoolBalance(claim.token.clone()),
            &(pool_balance - claim.amount),
        );

        claim.status = ClaimStatus::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::Claim(claim_id), &claim);

        env.events().publish(
            (symbol_short!("ins"), symbol_short!("payout")),
            (claim_id, claim.claimant, claim.token, claim.amount),
        );
    }

    /// Retrieve a claim record by ID.
    ///
    /// # Arguments
    ///
    /// * `claim_id` – Numeric ID assigned when the claim was submitted.
    ///
    /// # Returns
    ///
    /// The full `Claim` struct including status, amounts, timestamps,
    /// and evidence.
    ///
    /// # Errors
    ///
    /// * `InsuranceError::ClaimNotFound`  – if no claim exists with `claim_id`.
    /// * `InsuranceError::NotInitialized` – if `initialize` has not been called.
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
            .expect("Not initialized");
        if *caller != admin {
            panic_with_error!(env, InsuranceError::Unauthorized);
        }
    }

    fn load_claim(env: &Env, claim_id: u64) -> Claim {
        env.storage()
            .persistent()
            .get::<DataKey, Claim>(&DataKey::Claim(claim_id))
            .unwrap_or_else(|| panic_with_error!(env, InsuranceError::ClaimNotFound))
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        Env,
    };

    fn setup(env: &Env) -> (InsuranceContractClient, Address) {
        let id = env.register(InsuranceContract, ());
        let client = InsuranceContractClient::new(env, &id);
        let admin = Address::generate(env);
        client.initialize(&admin);
        (client, admin)
    }

    #[test]
    fn test_initialize_and_pool_balance_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);
        let token = Address::generate(&env);
        assert_eq!(client.get_pool_balance(&token), 0);
    }

    #[test]
    #[should_panic]
    fn test_double_initialize_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);
        client.initialize(&admin);
    }

    #[test]
    fn test_get_pool_balance_unknown_token_returns_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);
        assert_eq!(client.get_pool_balance(&Address::generate(&env)), 0);
    }

    #[test]
    fn test_submit_claim_increments_counter() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);
        let claimant = Address::generate(&env);
        let token = Address::generate(&env);
        let evidence = String::from_str(&env, "tx-hash-abc123");
        let id1 = client.submit_claim(&claimant, &500, &token, &evidence);
        let id2 = client.submit_claim(&claimant, &200, &token, &evidence);
        assert_eq!(id1, 0);
        assert_eq!(id2, 1);
    }

    #[test]
    fn test_claim_initial_status_is_pending() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);
        let claimant = Address::generate(&env);
        let token = Address::generate(&env);
        let evidence = String::from_str(&env, "evidence");
        let id = client.submit_claim(&claimant, &100, &token, &evidence);
        let claim = client.get_claim(&id);
        assert_eq!(claim.status, ClaimStatus::Pending);
        assert_eq!(claim.amount, 100);
    }

    #[test]
    #[should_panic]
    fn test_approve_before_voting_deadline_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);
        let claimant = Address::generate(&env);
        let token = Address::generate(&env);
        let evidence = String::from_str(&env, "evidence");
        let id = client.submit_claim(&claimant, &100, &token, &evidence);
        // Voting deadline hasn't passed yet — should panic.
        client.approve_claim(&admin, &id);
    }

    #[test]
    fn test_approve_claim_after_voting_deadline() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);
        let claimant = Address::generate(&env);
        let token = Address::generate(&env);
        let evidence = String::from_str(&env, "evidence");
        let id = client.submit_claim(&claimant, &100, &token, &evidence);
        // Advance time past the voting deadline.
        env.ledger().with_mut(|l| {
            l.timestamp += CLAIM_VOTING_PERIOD_SECS + 1;
        });
        client.approve_claim(&admin, &id);
        let claim = client.get_claim(&id);
        assert_eq!(claim.status, ClaimStatus::Approved);
    }

    #[test]
    fn test_reject_claim() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);
        let claimant = Address::generate(&env);
        let token = Address::generate(&env);
        let evidence = String::from_str(&env, "evidence");
        let id = client.submit_claim(&claimant, &100, &token, &evidence);
        client.reject_claim(&admin, &id);
        let claim = client.get_claim(&id);
        assert_eq!(claim.status, ClaimStatus::Rejected);
    }

    #[test]
    #[should_panic]
    fn test_execute_payout_on_pending_claim_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);
        let claimant = Address::generate(&env);
        let token = Address::generate(&env);
        let evidence = String::from_str(&env, "evidence");
        let id = client.submit_claim(&claimant, &100, &token, &evidence);
        client.execute_payout(&admin, &id);
    }

    #[test]
    #[should_panic]
    fn test_submit_claim_zero_amount_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);
        let claimant = Address::generate(&env);
        let token = Address::generate(&env);
        let evidence = String::from_str(&env, "evidence");
        client.submit_claim(&claimant, &0, &token, &evidence);
    }

    #[test]
    #[should_panic]
    fn test_non_admin_cannot_approve_claim() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _) = setup(&env);
        let claimant = Address::generate(&env);
        let token = Address::generate(&env);
        let evidence = String::from_str(&env, "evidence");
        let id = client.submit_claim(&claimant, &100, &token, &evidence);
        env.ledger().with_mut(|l| {
            l.timestamp += CLAIM_VOTING_PERIOD_SECS + 1;
        });
        let stranger = Address::generate(&env);
        client.approve_claim(&stranger, &id);
    }

    #[test]
    fn test_insurance_bps_constant() {
        // 0.1 % = 10 bps
        assert_eq!(INSURANCE_BPS, 10);
        // Levy on 1_000 units = 1 unit
        assert_eq!(1_000i128 * INSURANCE_BPS / 10_000, 1);
    }
}
