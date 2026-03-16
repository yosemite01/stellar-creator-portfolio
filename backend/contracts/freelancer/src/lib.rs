#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol};

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

#[contract]
pub trait FreelancerContractTrait {
    /// Register a new freelancer
    fn register_freelancer(
        env: Env,
        freelancer: Address,
        name: String,
        discipline: String,
        bio: String,
    ) -> bool;

    /// Get freelancer profile
    fn get_profile(env: Env, freelancer: Address) -> FreelancerProfile;

    /// Update freelancer rating
    fn update_rating(
        env: Env,
        freelancer: Address,
        new_rating: u32,
    ) -> bool;

    /// Update completed projects
    fn update_completed_projects(
        env: Env,
        freelancer: Address,
    ) -> bool;

    /// Update total earnings
    fn update_earnings(
        env: Env,
        freelancer: Address,
        amount: i128,
    ) -> bool;

    /// Verify freelancer
    fn verify_freelancer(
        env: Env,
        freelancer: Address,
    ) -> bool;

    /// Check if freelancer is verified
    fn is_verified(env: Env, freelancer: Address) -> bool;

    /// Get freelancers count
    fn get_freelancers_count(env: Env) -> u32;
}

#[contractimpl]
pub struct FreelancerContract;

#[contractimpl]
impl FreelancerContractTrait for FreelancerContract {
    fn register_freelancer(
        env: Env,
        freelancer: Address,
        name: String,
        discipline: String,
        bio: String,
    ) -> bool {
        freelancer.require_auth();

        let profile_key = Symbol::new(&env, &format!("profile_{}", freelancer));
        
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

        // Increment freelancers count
        let count_key = Symbol::new(&env, "freelancer_count");
        let count: u32 = env
            .storage()
            .persistent()
            .get::<Symbol, u32>(&count_key)
            .unwrap_or(0);
        env.storage().persistent().set(&count_key, &(count + 1));

        true
    }

    fn get_profile(env: Env, freelancer: Address) -> FreelancerProfile {
        let profile_key = Symbol::new(&env, &format!("profile_{}", freelancer));
        env.storage()
            .persistent()
            .get::<Symbol, FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered")
    }

    fn update_rating(
        env: Env,
        freelancer: Address,
        new_rating: u32,
    ) -> bool {
        let profile_key = Symbol::new(&env, &format!("profile_{}", freelancer));
        let mut profile = env
            .storage()
            .persistent()
            .get::<Symbol, FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered");

        // Calculate new average rating
        let total = (profile.rating as u64) * (profile.total_rating_count as u64);
        let new_total = total + (new_rating as u64);
        profile.total_rating_count += 1;
        profile.rating = (new_total / (profile.total_rating_count as u64)) as u32;

        env.storage().persistent().set(&profile_key, &profile);

        true
    }

    fn update_completed_projects(
        env: Env,
        freelancer: Address,
    ) -> bool {
        let profile_key = Symbol::new(&env, &format!("profile_{}", freelancer));
        let mut profile = env
            .storage()
            .persistent()
            .get::<Symbol, FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered");

        profile.completed_projects += 1;
        env.storage().persistent().set(&profile_key, &profile);

        true
    }

    fn update_earnings(
        env: Env,
        freelancer: Address,
        amount: i128,
    ) -> bool {
        let profile_key = Symbol::new(&env, &format!("profile_{}", freelancer));
        let mut profile = env
            .storage()
            .persistent()
            .get::<Symbol, FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered");

        profile.total_earnings += amount;
        env.storage().persistent().set(&profile_key, &profile);

        true
    }

    fn verify_freelancer(
        env: Env,
        freelancer: Address,
    ) -> bool {
        let profile_key = Symbol::new(&env, &format!("profile_{}", freelancer));
        let mut profile = env
            .storage()
            .persistent()
            .get::<Symbol, FreelancerProfile>(&profile_key)
            .expect("Freelancer not registered");

        // In a real scenario, this would require admin auth
        // For now, any verified contract can verify
        profile.verified = true;
        env.storage().persistent().set(&profile_key, &profile);

        true
    }

    fn is_verified(env: Env, freelancer: Address) -> bool {
        let profile_key = Symbol::new(&env, &format!("profile_{}", freelancer));
        if let Ok(profile) = env
            .storage()
            .persistent()
            .get::<Symbol, FreelancerProfile>(&profile_key)
        {
            profile.verified
        } else {
            false
        }
    }

    fn get_freelancers_count(env: Env) -> u32 {
        let count_key = Symbol::new(&env, "freelancer_count");
        env.storage()
            .persistent()
            .get::<Symbol, u32>(&count_key)
            .unwrap_or(0)
    }
}
