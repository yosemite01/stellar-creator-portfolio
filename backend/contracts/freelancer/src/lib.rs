#![no_std]



use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Symbol};

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

/// Storage key prefix for the public-key → user mapping.
const PK_MAP_PREFIX: &str = "pk_map_";
/// Identity Registry Metadata
#[contracttype]
pub struct IdentityMetadata {
    pub address: Address,
    pub metadata: Map<String, String>,
    pub last_updated: u64,
}

#[contract]
pub struct FreelancerContract;

#[contractimpl]
impl FreelancerContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Set the contract owner. Must be called once after deployment.
    pub fn initialize(env: Env, owner: Address) {
        owner.require_auth();
        let owner_key = Symbol::new(&env, OWNER_KEY);
        if env.storage().persistent().has(&owner_key) {
            panic!("Already initialized");
        }
        env.storage().persistent().set(&owner_key, &owner);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn get_owner(env: &Env) -> Address {
        let owner_key = Symbol::new(env, OWNER_KEY);
        env.storage()
            .persistent()
            .get::<Symbol, Address>(&owner_key)
            .expect("Contract not initialized")
    }

    // ── Public-key → user mapping (owner-only) ────────────────────────────────

    /// Map a Stellar public key to a user address. Only the contract owner may call this.
    pub fn set_public_key_mapping(env: Env, public_key: String, user: Address) {
        // #313: owner-only guard
        let owner = Self::get_owner(&env);
        owner.require_auth();

        let map_key = Symbol::new(&env, &format!("{}{:?}", PK_MAP_PREFIX, public_key));
        env.storage().persistent().set(&map_key, &user);
    }

    /// Retrieve the user address associated with a public key.
    pub fn get_user_by_public_key(env: Env, public_key: String) -> Option<Address> {
        let map_key = Symbol::new(&env, &format!("{}{:?}", PK_MAP_PREFIX, public_key));
        env.storage().persistent().get::<Symbol, Address>(&map_key)
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

        let profile_key = Symbol::new(&env, &format!("profile_{:?}", freelancer));

        let profile_key = (Symbol::new(&env, "profile"), freelancer.clone());
        
        // Check if already registered
        if env.storage().persistent().has(&profile_key) {
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

        env.storage().persistent().set(&profile_key, &profile);

        let count_key = Symbol::new(&env, "freelancer_count");
        // Increment freelancers count
        let count_key = Symbol::new(&env, "f_count");
        let count: u32 = env
            .storage()
            .persistent()
            .get::<Symbol, u32>(&count_key)
            .unwrap_or(0);
        env.storage().persistent().set(&count_key, &(count + 1));

        true
    }

    pub fn get_profile(env: Env, freelancer: Address) -> FreelancerProfile {
        let profile_key = (Symbol::new(&env, "profile"), freelancer);
        env.storage()
            .persistent()
            .get::<(Symbol, Address), FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered")
    }

    /// Update the rating for a freelancer. Only the contract owner may call this
    /// to prevent self-rating abuse. (#312)
    pub fn update_rating(env: Env, freelancer: Address, new_rating: u32) -> bool {
        // #312: owner-only — ratings must come from the platform, not self
        let owner = Self::get_owner(&env);
        owner.require_auth();

        let profile_key = Symbol::new(&env, &format!("profile_{:?}", freelancer));
    pub fn update_rating(
        env: Env,
        freelancer: Address,
        new_rating: u32,
    ) -> bool {
        let profile_key = (Symbol::new(&env, "profile"), freelancer);
        let mut profile = env
            .storage()
            .persistent()
            .get::<(Symbol, Address), FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered");

        let total = (profile.rating as u64) * (profile.total_rating_count as u64);
        let new_total = total + (new_rating as u64);
        profile.total_rating_count += 1;
        profile.rating = (new_total / (profile.total_rating_count as u64)) as u32;

        env.storage().persistent().set(&profile_key, &profile);
        true
    }

    /// Record a completed project. Only the contract owner may call this. (#312)
    pub fn update_completed_projects(env: Env, freelancer: Address) -> bool {
        // #312: owner-only — completion must be confirmed by the platform
        let owner = Self::get_owner(&env);
        owner.require_auth();

        let profile_key = Symbol::new(&env, &format!("profile_{:?}", freelancer));
    pub fn update_completed_projects(
        env: Env,
        freelancer: Address,
    ) -> bool {
        let profile_key = (Symbol::new(&env, "profile"), freelancer);
        let mut profile = env
            .storage()
            .persistent()
            .get::<(Symbol, Address), FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered");

        profile.completed_projects += 1;
        env.storage().persistent().set(&profile_key, &profile);
        true
    }

    /// Update earnings for a freelancer. Only the contract owner may call this. (#312)
    pub fn update_earnings(env: Env, freelancer: Address, amount: i128) -> bool {
        // #312: owner-only — earnings are credited by the escrow/platform
        let owner = Self::get_owner(&env);
        owner.require_auth();

        let profile_key = Symbol::new(&env, &format!("profile_{:?}", freelancer));
    pub fn update_earnings(
        env: Env,
        freelancer: Address,
        amount: i128,
    ) -> bool {
        let profile_key = (Symbol::new(&env, "profile"), freelancer);
        let mut profile = env
            .storage()
            .persistent()
            .get::<(Symbol, Address), FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered");

        profile.total_earnings += amount;
        env.storage().persistent().set(&profile_key, &profile);
        true
    }

    /// Verify a freelancer. Only the contract owner may call this. (#312)
    pub fn verify_freelancer(env: Env, freelancer: Address) -> bool {
        // #312: owner-only — verification is a privileged admin action
        let owner = Self::get_owner(&env);
        owner.require_auth();

        let profile_key = Symbol::new(&env, &format!("profile_{:?}", freelancer));
    pub fn verify_freelancer(
        env: Env,
        freelancer: Address,
    ) -> bool {
        let profile_key = (Symbol::new(&env, "profile"), freelancer);
        let mut profile = env
            .storage()
            .persistent()
            .get::<(Symbol, Address), FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered");

        profile.verified = true;
        env.storage().persistent().set(&profile_key, &profile);
        true
    }

    pub fn is_verified(env: Env, freelancer: Address) -> bool {
        let profile_key = (Symbol::new(&env, "profile"), freelancer);
        if let Some(profile) = env
            .storage()
            .persistent()
            .get::<(Symbol, Address), FreelancerProfile>(&profile_key)
        {
            profile.verified
        } else {
            false
        }
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
        true
    }

    /// Retrieve identity metadata for a given address.
    pub fn get_identity_metadata(env: Env, user: Address) -> IdentityMetadata {
        let identity_key = (Symbol::new(&env, "identity"), user);
        env.storage()
            .persistent()
            .get::<(Symbol, Address), IdentityMetadata>(&identity_key)
            .expect("Identity metadata not found")
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

        let contract_id = env.register_contract(None, FreelancerContract);
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
        let contract_id = env.register_contract(None, FreelancerContract);
        let client = FreelancerContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        client.get_identity_metadata(&user);
    }
}
