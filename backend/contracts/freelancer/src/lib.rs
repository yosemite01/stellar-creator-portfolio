#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address, Env, Map,
    String, Symbol,
};

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

    /// Update the rating for a freelancer. Only the contract owner may call this
    /// to prevent self-rating abuse. (#312)
    ///
    /// `new_rating` must be in [0, 500] (0–5 stars × 100). (#183)
    pub fn update_rating(env: Env, freelancer: Address, new_rating: u32) -> Result<bool, FreelancerError> {
        // #312: owner-only — ratings must come from the platform, not self
        let owner = Self::get_owner(&env)?;
        owner.require_auth();

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

    /// Record a completed project. Only the contract owner may call this. (#312)
    pub fn update_completed_projects(env: Env, freelancer: Address) -> Result<bool, FreelancerError> {
        // #312: owner-only — completion must be confirmed by the platform
        let owner = Self::get_owner(&env)?;
        owner.require_auth();

        let mut profile = load_profile(&env, &freelancer)?;

        profile.completed_projects += 1;
        env.storage().persistent().set(&profile_key(&env, &freelancer), &profile);

        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("completed")),
            (freelancer, profile.completed_projects),
        );
        Ok(true)
    }

    /// Update earnings for a freelancer. Only the contract owner may call this. (#312)
    pub fn update_earnings(env: Env, freelancer: Address, amount: i128) -> Result<bool, FreelancerError> {
        // #312: owner-only — earnings are credited by the escrow/platform
        let owner = Self::get_owner(&env)?;
        owner.require_auth();

        let mut profile = load_profile(&env, &freelancer)?;

        profile.total_earnings += amount;
        env.storage().persistent().set(&profile_key(&env, &freelancer), &profile);

        env.events().publish(
            (symbol_short!("freelncr"), symbol_short!("earnings")),
            (freelancer, amount, profile.total_earnings),
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
    #[should_panic(expected = "Identity metadata not found")]
    fn test_get_nonexistent_identity() {
        let env = Env::default();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        client.get_identity_metadata(&user);
    }
}
