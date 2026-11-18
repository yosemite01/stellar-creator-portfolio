#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, vec, Address, Env,
    IntoVal, Map, String, Symbol, Val, Vec,
};

/// Mirror of the escrow contract's `EscrowStatus` (#1726). Integer enum, so
/// it decodes from the same `u32` the escrow contract emits.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum EscrowStatus {
    Active = 0,
    Released = 1,
    Refunded = 2,
    Disputed = 3,
    Complete = 4,
}

/// Mirror of the escrow contract's `ReleaseCondition` (#1726).
#[contracttype]
#[derive(Clone, Debug)]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

/// Mirror of the escrow contract's `EscrowAccount` (#1726). Field names must
/// match exactly: Soroban structs are encoded as maps keyed by field name.
#[contracttype]
#[derive(Clone, Debug)]
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

/// Freelancer Profile
#[contracttype]
pub struct FreelancerProfile {
    pub address: Address,
    pub name: String,
    pub discipline: String,
    pub bio: String,
    pub rating: u32, // 0-500 represents 0-5 stars (fixed point)
    pub total_rating_count: u32,
    pub completed_projects: u32,
    pub total_earnings: i128,
    pub verified: bool,
    pub created_at: u64,
}

/// Storage key for the contract owner address (set once at init).
const OWNER_KEY: &str = "owner";
/// Identity Registry Metadata
#[contracttype]
pub struct IdentityMetadata {
    pub address: Address,
    pub metadata: Map<String, String>,
    pub last_updated: u64,
}

/// Typed errors returned by freelancer entrypoints (#1562).
///
/// Codes are part of the contract's public interface: never renumber an
/// existing variant, only append. See docs/contracts.md for the full table.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum FreelancerError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotRegistered = 3,
    InvalidRating = 4,
    IdentityNotFound = 5,
    Unauthorized = 6,
    /// Escrow / review source contract not configured (#1726).
    SourceNotConfigured = 7,
    /// The escrow was not released to this freelancer (#1726).
    EscrowNotReleased = 8,
    /// The escrow release has already been credited (#1726).
    AlreadyCredited = 9,
    /// Stats for this profile were already migrated (#1726).
    AlreadyMigrated = 10,
}

/// Storage key: escrow contract trusted as the source of earnings (#1726).
const ESCROW_SOURCE_KEY: &str = "esc_src";
/// Storage key: review contract trusted as the source of ratings (#1726).
const REVIEW_SOURCE_KEY: &str = "rev_src";

fn credited_key(env: &Env, escrow_id: u64) -> (Symbol, u64) {
    (Symbol::new(env, "credited"), escrow_id)
}

fn migrated_key(env: &Env, freelancer: &Address) -> (Symbol, Address) {
    (Symbol::new(env, "stats_mig"), freelancer.clone())
}

fn profile_key(env: &Env, freelancer: &Address) -> (Symbol, Address) {
    (Symbol::new(env, "profile"), freelancer.clone())
}

fn load_profile(env: &Env, freelancer: &Address) -> Result<FreelancerProfile, FreelancerError> {
    env.storage()
        .persistent()
        .get::<(Symbol, Address), FreelancerProfile>(&profile_key(env, freelancer))
        .ok_or(FreelancerError::NotRegistered)
}

#[contract]
pub struct FreelancerContract;

#[contractimpl]
impl FreelancerContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Set the contract owner. Must be called once after deployment.
    pub fn initialize(env: Env, owner: Address) -> Result<(), FreelancerError> {
        owner.require_auth();
        let owner_key = Symbol::new(&env, OWNER_KEY);
        if env.storage().persistent().has(&owner_key) {
            return Err(FreelancerError::AlreadyInitialized);
        }
        env.storage().persistent().set(&owner_key, &owner);
        Ok(())
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn get_owner(env: &Env) -> Result<Address, FreelancerError> {
        let owner_key = Symbol::new(env, OWNER_KEY);
        env.storage()
            .persistent()
            .get::<Symbol, Address>(&owner_key)
            .ok_or(FreelancerError::NotInitialized)
    }

    // ── Public-key → user mapping (owner-only) ────────────────────────────────

    /// Map a Stellar public key to a user address. Only the contract owner may call this.
    pub fn set_public_key_mapping(env: Env, public_key: String, user: Address) -> Result<(), FreelancerError> {
        // #313: owner-only guard
        let owner = Self::get_owner(&env)?;
        owner.require_auth();

        let map_key = (Symbol::new(&env, "pk_map"), public_key.clone());
        env.storage().persistent().set(&map_key, &user);

        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("pk_mapped")),
            (public_key, user),
        );
        Ok(())
    }

    /// Retrieve the user address associated with a public key.
    pub fn get_user_by_public_key(env: Env, public_key: String) -> Option<Address> {
        let map_key = (Symbol::new(&env, "pk_map"), public_key);
        env.storage().persistent().get::<(Symbol, String), Address>(&map_key)
    }

    // ── Freelancer registration ───────────────────────────────────────────────

    pub fn register_freelancer(
        env: Env,
        freelancer: Address,
        name: String,
        discipline: String,
        bio: String,
    ) -> bool {
        // #312: caller must authorise this action
        freelancer.require_auth();

        let key = profile_key(&env, &freelancer);

        // Check if already registered
        if env.storage().persistent().has(&key) {
            return false;
        }

        let profile = FreelancerProfile {
            address: freelancer.clone(),
            name,
            discipline,
            bio,
            rating: 0,
            total_rating_count: 0,
            completed_projects: 0,
            total_earnings: 0,
            verified: false,
            created_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&key, &profile);
        // #1726: new profiles start with verified (zero) stats.
        env.storage().persistent().set(&migrated_key(&env, &freelancer), &true);

        // Increment freelancers count
        let count_key = Symbol::new(&env, "f_count");
        let count: u32 = env
            .storage()
            .persistent()
            .get::<Symbol, u32>(&count_key)
            .unwrap_or(0);
        env.storage().persistent().set(&count_key, &(count + 1));

        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("register")),
            (freelancer, env.ledger().timestamp()),
        );

        true
    }

    pub fn get_profile(env: Env, freelancer: Address) -> Result<FreelancerProfile, FreelancerError> {
        load_profile(&env, &freelancer)
    }

    // ── Verified stat sources (#1726) ─────────────────────────────────────────
    //
    // Ratings, completed projects and earnings can no longer be written by the
    // owner. They are derived from contract activity only:
    //   * earnings + completed projects ← `record_escrow_release`, which reads
    //     the released escrow from the configured escrow contract;
    //   * ratings ← `update_rating`, which must be invoked by the configured
    //     review contract (cross-contract auth).

    /// Configure the escrow contract earnings are derived from. Owner-only.
    /// Emits `(freelncr, esc_src)`.
    pub fn set_escrow_source(env: Env, escrow: Address) -> Result<(), FreelancerError> {
        let owner = Self::get_owner(&env)?;
        owner.require_auth();
        env.storage().persistent().set(&Symbol::new(&env, ESCROW_SOURCE_KEY), &escrow);
        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("esc_src")),
            escrow,
        );
        Ok(())
    }

    /// Configure the review contract allowed to post ratings. Owner-only.
    /// Emits `(freelncr, rev_src)`.
    pub fn set_review_source(env: Env, review: Address) -> Result<(), FreelancerError> {
        let owner = Self::get_owner(&env)?;
        owner.require_auth();
        env.storage().persistent().set(&Symbol::new(&env, REVIEW_SOURCE_KEY), &review);
        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("rev_src")),
            review,
        );
        Ok(())
    }

    pub fn get_escrow_source(env: Env) -> Option<Address> {
        env.storage().persistent().get(&Symbol::new(&env, ESCROW_SOURCE_KEY))
    }

    pub fn get_review_source(env: Env) -> Option<Address> {
        env.storage().persistent().get(&Symbol::new(&env, REVIEW_SOURCE_KEY))
    }

    /// Post a rating for a freelancer. `source` must be the configured review
    /// contract and must authorize the call — a contract calling this one
    /// directly satisfies `require_auth` for its own address, so only that
    /// contract can post ratings. The owner can no longer rate (#1726).
    ///
    /// `new_rating` must be in [0, 500] (0–5 stars × 100). (#183)
    pub fn update_rating(env: Env, source: Address, freelancer: Address, new_rating: u32) -> Result<bool, FreelancerError> {
        let review: Address = Self::get_review_source(env.clone()).ok_or(FreelancerError::SourceNotConfigured)?;
        if source != review {
            return Err(FreelancerError::Unauthorized);
        }
        source.require_auth();

        // #183: Validate rating is within [0, 500] (0.0–5.0 stars × 100)
        if new_rating > 500 {
            return Err(FreelancerError::InvalidRating);
        }

        let mut profile = load_profile(&env, &freelancer)?;

        let total = (profile.rating as u64) * (profile.total_rating_count as u64);
        let new_total = total + (new_rating as u64);
        profile.total_rating_count += 1;
        profile.rating = (new_total / (profile.total_rating_count as u64)) as u32;

        env.storage().persistent().set(&profile_key(&env, &freelancer), &profile);

        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("rated")),
            (freelancer, new_rating, profile.rating, profile.total_rating_count),
        );
        Ok(true)
    }

    /// Credit a released escrow to its payee's profile. Permissionless: the
    /// escrow is read from the configured escrow contract and must be
    /// `Released` to a registered freelancer. Each escrow is credited once.
    /// Adds `escrow.amount` to earnings and increments completed projects.
    /// Emits `(freelncr, earnings)` and `(freelncr, completed)`.
    pub fn record_escrow_release(env: Env, escrow_id: u64) -> Result<bool, FreelancerError> {
        let escrow_addr: Address = Self::get_escrow_source(env.clone()).ok_or(FreelancerError::SourceNotConfigured)?;
        let ckey = credited_key(&env, escrow_id);
        if env.storage().persistent().has(&ckey) {
            return Err(FreelancerError::AlreadyCredited);
        }

        let args: Vec<Val> = vec![&env, escrow_id.into_val(&env)];
        let escrow: EscrowAccount =
            env.invoke_contract(&escrow_addr, &Symbol::new(&env, "get_escrow"), args);
        if escrow.status != EscrowStatus::Released {
            return Err(FreelancerError::EscrowNotReleased);
        }

        let freelancer = escrow.payee.clone();
        let mut profile = load_profile(&env, &freelancer)?;
        profile.total_earnings += escrow.amount;
        profile.completed_projects += 1;
        env.storage().persistent().set(&profile_key(&env, &freelancer), &profile);
        env.storage().persistent().set(&ckey, &true);

        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("earnings")),
            (freelancer.clone(), escrow.amount, profile.total_earnings, escrow_id),
        );
        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("completed")),
            (freelancer, profile.completed_projects),
        );
        Ok(true)
    }

    /// Whether an escrow has already been credited.
    pub fn is_escrow_credited(env: Env, escrow_id: u64) -> bool {
        env.storage().persistent().has(&credited_key(&env, escrow_id))
    }

    /// One-shot migration (#1726): zero the stats of a profile created before
    /// stat writes were restricted, since those values were admin-written and
    /// unverified. They are then rebuilt via `record_escrow_release` and
    /// `update_rating`. Owner-only; can only reset (never set) values, and only
    /// once per profile. Profiles registered after this upgrade are marked
    /// migrated at registration. Emits `(freelncr, migrated)`.
    pub fn migrate_reset_stats(env: Env, freelancer: Address) -> Result<bool, FreelancerError> {
        let owner = Self::get_owner(&env)?;
        owner.require_auth();
        let mkey = migrated_key(&env, &freelancer);
        if env.storage().persistent().has(&mkey) {
            return Err(FreelancerError::AlreadyMigrated);
        }
        let mut profile = load_profile(&env, &freelancer)?;
        profile.rating = 0;
        profile.total_rating_count = 0;
        profile.completed_projects = 0;
        profile.total_earnings = 0;
        env.storage().persistent().set(&profile_key(&env, &freelancer), &profile);
        env.storage().persistent().set(&mkey, &true);
        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("migrated")),
            (freelancer,),
        );
        Ok(true)
    }

    /// Verify a freelancer. Only the contract owner may call this. (#312)
    pub fn verify_freelancer(env: Env, freelancer: Address) -> Result<bool, FreelancerError> {
        // #312: owner-only — verification is a privileged admin action
        let owner = Self::get_owner(&env)?;
        owner.require_auth();

        let mut profile = load_profile(&env, &freelancer)?;

        profile.verified = true;
        env.storage().persistent().set(&profile_key(&env, &freelancer), &profile);

        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("verified")),
            (freelancer,),
        );
        Ok(true)
    }

    pub fn is_verified(env: Env, freelancer: Address) -> bool {
        load_profile(&env, &freelancer).map(|p| p.verified).unwrap_or(false)
    }

    pub fn get_freelancers_count(env: Env) -> u32 {
        let count_key = Symbol::new(&env, "f_count");
        env.storage()
            .persistent()
            .get::<Symbol, u32>(&count_key)
            .unwrap_or(0)
    }

    /// Set identity metadata for the authenticated user.
    pub fn set_identity_metadata(env: Env, user: Address, metadata: Map<String, String>) -> bool {
        user.require_auth();

        let identity_key = (Symbol::new(&env, "identity"), user.clone());

        let identity = IdentityMetadata {
            address: user.clone(),
            metadata,
            last_updated: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&identity_key, &identity);

        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("identity")),
            (user, identity.last_updated),
        );
        true
    }

    /// Retrieve identity metadata for a given address.
    pub fn get_identity_metadata(env: Env, user: Address) -> Result<IdentityMetadata, FreelancerError> {
        let identity_key = (Symbol::new(&env, "identity"), user);
        env.storage()
            .persistent()
            .get::<(Symbol, Address), IdentityMetadata>(&identity_key)
            .ok_or(FreelancerError::IdentityNotFound)
    }

    // ── Issue #1564: Timelocked upgrade + two-step admin transfer ─────────────
    //
    // Replaces the old instant `upgrade` entrypoint. Shared logic lives in
    // `stellar-upgradeable`; see docs/contracts.md (Upgrading a live contract).

    /// Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
    /// which `execute_upgrade` may be called (now + 48h). Emits
    /// `(upgrade, proposed)`.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> u64 {
        let stored_admin: Address = Self::get_owner(&env).unwrap_or_else(|e| panic_with_error!(&env, e));
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = Self::get_owner(&env).unwrap_or_else(|e| panic_with_error!(&env, e));
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = Self::get_owner(&env).unwrap_or_else(|e| panic_with_error!(&env, e));
        stellar_upgradeable::cancel_upgrade(&env, &admin, &stored_admin);
    }

    /// The upgrade currently waiting out its timelock, if any.
    pub fn get_pending_upgrade(env: Env) -> Option<stellar_upgradeable::PendingUpgrade> {
        stellar_upgradeable::pending_upgrade(&env)
    }

    /// Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = Self::get_owner(&env).unwrap_or_else(|e| panic_with_error!(&env, e));
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let stored_admin: Address = Self::get_owner(&env).unwrap_or_else(|e| panic_with_error!(&env, e));
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &stored_admin);
        env.storage().persistent().set(&Symbol::new(&env, OWNER_KEY), &accepted);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = Self::get_owner(&env).unwrap_or_else(|e| panic_with_error!(&env, e));
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Env, String};

    #[test]
    fn test_identity_registry() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let mut metadata = Map::new(&env);
        metadata.set(String::from_str(&env, "email"), String::from_str(&env, "user@example.com"));
        metadata.set(String::from_str(&env, "github"), String::from_str(&env, "usergh"));

        client.set_identity_metadata(&user, &metadata);

        let identity = client.get_identity_metadata(&user);
        assert_eq!(identity.address, user);
        assert_eq!(identity.metadata.get(String::from_str(&env, "email")).unwrap(), String::from_str(&env, "user@example.com"));
        assert_eq!(identity.metadata.get(String::from_str(&env, "github")).unwrap(), String::from_str(&env, "usergh"));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_get_nonexistent_identity() {
        let env = Env::default();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        client.get_identity_metadata(&user);
    }

    // ── #1726: stats only from verified sources ───────────────────────────────

    #[contract]
    pub struct MockEscrow;

    #[contractimpl]
    impl MockEscrow {
        pub fn put(env: Env, escrow: EscrowAccount) {
            env.storage().persistent().set(&escrow.id, &escrow);
        }
        pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
            env.storage().persistent().get(&escrow_id).unwrap()
        }
    }

    /// Stand-in review contract: forwards a rating with its own address as source.
    #[contract]
    pub struct MockReview;

    #[contractimpl]
    impl MockReview {
        pub fn rate(env: Env, freelancer_contract: Address, freelancer: Address, rating: u32) {
            FreelancerContractClient::new(&env, &freelancer_contract)
                .update_rating(&env.current_contract_address(), &freelancer, &rating);
        }
    }

    fn setup_stats(env: &Env) -> (FreelancerContractClient<'_>, Address, MockEscrowClient<'_>, Address) {
        let id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(env, &id);
        let owner = Address::generate(env);
        client.initialize(&owner);
        let escrow_id = env.register(MockEscrow, ());
        client.set_escrow_source(&escrow_id);
        let freelancer = Address::generate(env);
        client.register_freelancer(
            &freelancer,
            &String::from_str(env, "Ada"),
            &String::from_str(env, "dev"),
            &String::from_str(env, "bio"),
        );
        (client, owner, MockEscrowClient::new(env, &escrow_id), freelancer)
    }

    fn escrow(env: &Env, id: u64, payee: &Address, status: EscrowStatus) -> EscrowAccount {
        EscrowAccount {
            id,
            bounty_id: id,
            payer: Address::generate(env),
            payee: payee.clone(),
            amount: 975,
            token: Address::generate(env),
            status,
            release_condition: ReleaseCondition::OnCompletion,
            created_at: 0,
            released_at: Some(1),
            fee_collected: 25,
        }
    }

    #[test]
    fn escrow_release_updates_earnings() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, esc, f) = setup_stats(&env);
        esc.put(&escrow(&env, 1, &f, EscrowStatus::Released));
        client.record_escrow_release(&1);
        let p = client.get_profile(&f);
        assert_eq!(p.total_earnings, 975);
        assert_eq!(p.completed_projects, 1);
        assert!(client.is_escrow_credited(&1));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #9)")]
    fn escrow_release_cannot_be_double_credited() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, esc, f) = setup_stats(&env);
        esc.put(&escrow(&env, 1, &f, EscrowStatus::Released));
        client.record_escrow_release(&1);
        client.record_escrow_release(&1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn unreleased_escrow_not_credited() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, esc, f) = setup_stats(&env);
        esc.put(&escrow(&env, 1, &f, EscrowStatus::Refunded));
        client.record_escrow_release(&1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn direct_admin_rating_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, owner, _, f) = setup_stats(&env);
        let review = env.register(MockReview, ());
        client.set_review_source(&review);
        // The owner is not the review contract.
        client.update_rating(&owner, &f, &500);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn rating_without_review_source_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, owner, _, f) = setup_stats(&env);
        client.update_rating(&owner, &f, &500);
    }

    #[test]
    fn review_contract_can_rate() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _, f) = setup_stats(&env);
        let review = env.register(MockReview, ());
        client.set_review_source(&review);
        // No mocked auth needed for the review contract: it is the direct invoker.
        env.set_auths(&[]);
        MockReviewClient::new(&env, &review).rate(&client.address, &f, &400);
        let p = client.get_profile(&f);
        assert_eq!(p.rating, 400);
        assert_eq!(p.total_rating_count, 1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn migration_is_one_shot_and_skips_new_profiles() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _, f) = setup_stats(&env);
        // Registered after the upgrade => already migrated.
        client.migrate_reset_stats(&f);
    }
}
