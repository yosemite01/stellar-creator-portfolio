#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol};

#[contracttype]
pub struct FreelancerProfile {
    pub address: Address,
    pub name: String,
    pub discipline: String,
    pub bio: String,
    pub rating: u32,
    pub total_rating_count: u32,
    pub completed_projects: u32,
    pub total_earnings: i128,
    pub verified: bool,
    pub created_at: u64,
}

#[contracttype]
pub struct FilterOptions {
    pub discipline: Option<String>,
    pub min_rating: Option<u32>,
    pub verified_only: Option<bool>,
}

#[contracttype]
pub enum DataKey {
    FreelancerCount,
    Profile(Address),
    AllFreelancers,
}

#[contract]
pub struct FreelancerContract;

// Shared topic prefix for all freelancer events — allows indexers to filter by contract.
const FREELANCER: Symbol = symbol_short!("freelancer");

#[contractimpl]
impl FreelancerContract {
    /// Registers a new freelancer profile.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `freelancer`: Freelancer address (must authenticate).
    /// - `name`: Freelancer's display name.
    /// - `discipline`: Area of expertise (e.g., \"Rust Development\").
    /// - `bio`: Professional bio/description.
    ///
    /// # Returns
    /// - `bool`: `true` if registration succeeded, `false` if already registered.
    ///
    /// # Errors
    /// - Panics if freelancer fails authentication.
    ///
    /// # State Changes
    /// - Creates new FreelancerProfile with default metrics.
    /// - Increments freelancer count.
    pub fn register_freelancer(
        env: Env,
        freelancer: Address,
        name: String,
        discipline: String,
        bio: String,
    ) -> bool {
        freelancer.require_auth();

        let key = DataKey::Profile(freelancer.clone());
        if env.storage().persistent().has(&key) {
            return false;
        }

        let timestamp = env.ledger().timestamp();
        let profile = FreelancerProfile {
            address: freelancer.clone(),
            name: name.clone(),
            discipline,
            bio,
            rating: 0,
            total_rating_count: 0,
            completed_projects: 0,
            total_earnings: 0,
            verified: false,
            created_at: timestamp,
        };

        env.storage().persistent().set(&key, &profile);

        // Add to all freelancers list
        let mut freelancers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AllFreelancers)
            .unwrap_or(Vec::new(&env));
        freelancers.push_back(freelancer);
        env.storage().persistent().set(&DataKey::AllFreelancers, &freelancers);

        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::FreelancerCount)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::FreelancerCount, &(count + 1));

        // Event: freelancer registered
        env.events().publish(
            (FREELANCER, symbol_short!("registered"), freelancer),
            (name, timestamp),
        );

        true
    }

    /// Retrieves freelancer profile.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `freelancer`: Freelancer address.
    ///
    /// # Returns
    /// - `FreelancerProfile`: Complete profile data.
    ///
    /// # Errors
    /// - Panics with \"Freelancer not registered\" if profile doesn't exist.
    pub fn get_profile(env: Env, freelancer: Address) -> FreelancerProfile {
        env.storage()
            .persistent()
            .get(&DataKey::Profile(freelancer))
            .expect(\"Freelancer not registered\")
    }

    /// Updates freelancer's average rating with new review.
    /// Uses running average calculation.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `freelancer`: Target freelancer.
    /// - `new_rating`: New rating (0-5 expected).
    ///
    /// # Returns
    /// - `bool`: Always `true`.
    ///
    /// # Errors
    /// - Panics if freelancer not registered.
    ///
    /// # Logic
    /// - total = old_rating * count
    /// - new_avg = (total + new_rating) / (count + 1)
    pub fn update_rating(env: Env, freelancer: Address, new_rating: u32) -> bool {
        let key = DataKey::Profile(freelancer.clone());
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect(\"Freelancer not registered\");

        let total = (profile.rating as u64) * (profile.total_rating_count as u64);
        profile.total_rating_count += 1;
        profile.rating = ((total + new_rating as u64) / profile.total_rating_count as u64) as u32;

        let aggregate_rating = profile.rating;
        let total_reviews = profile.total_rating_count;

        env.storage().persistent().set(&key, &profile);

        // Event: freelancer rated
        env.events().publish(
            (FREELANCER, symbol_short!("rated"), freelancer),
            (aggregate_rating, total_reviews),
        );

        true
    }

    /// Increments freelancer's completed projects count.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `freelancer`: Target freelancer.
    ///
    /// # Returns
    /// - `bool`: Always `true`.
    ///
    /// # Errors
    /// - Panics if freelancer not registered.
    pub fn update_completed_projects(env: Env, freelancer: Address) -> bool {
        let key = DataKey::Profile(freelancer);
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect(\"Freelancer not registered\");

        profile.completed_projects += 1;
        env.storage().persistent().set(&key, &profile);
        true
    }

    /// Adds to freelancer's total earnings.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `freelancer`: Target freelancer.
    /// - `amount`: Earnings amount to add (positive).
    ///
    /// # Returns
    /// - `bool`: Always `true`.
    ///
    /// # Errors
    /// - Panics if freelancer not registered.
    pub fn update_earnings(env: Env, freelancer: Address, amount: i128) -> bool {
        let key = DataKey::Profile(freelancer);
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect(\"Freelancer not registered\");

        profile.total_earnings += amount;
        env.storage().persistent().set(&key, &profile);
        true
    }

    /// Admin verifies freelancer (sets verified flag).
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `admin`: Admin address (must authenticate).
    /// - `freelancer`: Target freelancer.
    ///
    /// # Returns
    /// - `bool`: Always `true`.
    ///
    /// # Errors
    /// - Panics if admin fails authentication.
    /// - Panics if freelancer not registered.
    pub fn verify_freelancer(env: Env, admin: Address, freelancer: Address) -> bool {
        admin.require_auth();

        let key = DataKey::Profile(freelancer.clone());
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect(\"Freelancer not registered\");

        profile.verified = true;
        env.storage().persistent().set(&key, &profile);

        // Event: freelancer verified
        env.events().publish(
            (FREELANCER, symbol_short!("verified"), freelancer),
            (admin, true),
        );

        true
    }

    /// Checks if freelancer is verified.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `freelancer`: Freelancer address.
    ///
    /// # Returns
    /// - `bool`: `true` if verified, `false` if not registered or unverified.
    pub fn is_verified(env: Env, freelancer: Address) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, FreelancerProfile>(&DataKey::Profile(freelancer))
            .map(|p| p.verified)
            .unwrap_or(false)
    }

    /// Gets total registered freelancers count.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    ///
    /// # Returns
    /// - `u32`: Count of freelancers.
    pub fn get_freelancers_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::FreelancerCount)
            .unwrap_or(0)
    }

    /// Get all freelancer addresses
    pub fn get_all_freelancer_addresses(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::AllFreelancers)
            .unwrap_or(Vec::new(&env))
    }

    /// Query freelancers filtered by discipline
    pub fn get_freelancers_by_discipline(
        env: Env,
        discipline: String,
    ) -> Vec<FreelancerProfile> {
        let freelancers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AllFreelancers)
            .unwrap_or(Vec::new(&env));
        let mut result = Vec::new(&env);

        for freelancer in freelancers.iter() {
            if let Some(profile) = env
                .storage()
                .persistent()
                .get::<DataKey, FreelancerProfile>(&DataKey::Profile(freelancer))
            {
                if profile.discipline == discipline {
                    result.push_back(profile);
                }
            }
        }

        result
    }

    /// Query freelancers filtered by minimum rating
    pub fn get_freelancers_by_min_rating(
        env: Env,
        min_rating: u32,
    ) -> Vec<FreelancerProfile> {
        let freelancers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AllFreelancers)
            .unwrap_or(Vec::new(&env));
        let mut result = Vec::new(&env);

        for freelancer in freelancers.iter() {
            if let Some(profile) = env
                .storage()
                .persistent()
                .get::<DataKey, FreelancerProfile>(&DataKey::Profile(freelancer))
            {
                if profile.rating >= min_rating {
                    result.push_back(profile);
                }
            }
        }

        result
    }

    /// Query freelancers filtered by verification status
    pub fn get_freelancers_by_verification(
        env: Env,
        verified: bool,
    ) -> Vec<FreelancerProfile> {
        let freelancers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AllFreelancers)
            .unwrap_or(Vec::new(&env));
        let mut result = Vec::new(&env);

        for freelancer in freelancers.iter() {
            if let Some(profile) = env
                .storage()
                .persistent()
                .get::<DataKey, FreelancerProfile>(&DataKey::Profile(freelancer))
            {
                if profile.verified == verified {
                    result.push_back(profile);
                }
            }
        }

        result
    }

    /// Query freelancers with combined filters
    pub fn query_freelancers(
        env: Env,
        filters: FilterOptions,
    ) -> Vec<FreelancerProfile> {
        let freelancers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AllFreelancers)
            .unwrap_or(Vec::new(&env));
        let mut result = Vec::new(&env);

        for freelancer in freelancers.iter() {
            if let Some(profile) = env
                .storage()
                .persistent()
                .get::<DataKey, FreelancerProfile>(&DataKey::Profile(freelancer))
            {
                // Apply discipline filter
                if let Some(ref discipline) = filters.discipline {
                    if profile.discipline != *discipline {
                        continue;
                    }
                }

                // Apply minimum rating filter
                if let Some(min_rating) = filters.min_rating {
                    if profile.rating < min_rating {
                        continue;
                    }
                }

                // Apply verification filter
                if let Some(verified_only) = filters.verified_only {
                    if verified_only && !profile.verified {
                        continue;
                    }
                }

                result.push_back(profile);
            }
        }

        result
    }
}

#[cfg(test)]
mod event_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_register_freelancer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let freelancer = Address::generate(&env);
        let result = client.register_freelancer(
            &freelancer,
            &String::from_str(&env, \"Alice\"),
            &String::from_str(&env, \"UI/UX Design\"),
            &String::from_str(&env, \"Designer with 5 years experience\"),
        );

        assert!(result);
        assert_eq!(client.get_freelancers_count(), 1);
        assert!(!client.is_verified(&freelancer));
    }

    #[test]
    fn test_duplicate_registration_returns_false() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let freelancer = Address::generate(&env);
        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, \"Alice\"),
            &String::from_str(&env, \"Design\"),
            &String::from_str(&env, \"Bio\"),
        );
        let second = client.register_freelancer(
            &freelancer,
            &String::from_str(&env, \"Alice\"),
            &String::from_str(&env, \"Design\"),
            &String::from_str(&env, \"Bio\"),
        );
        assert!(!second);
    }

    #[test]
    fn test_get_all_freelancer_addresses() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let f1 = Address::generate(&env);
        let f2 = Address::generate(&env);
        
        client.register_freelancer(
            &f1,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );
        client.register_freelancer(
            &f2,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Development"),
            &String::from_str(&env, "Bio"),
        );

        let addresses = client.get_all_freelancer_addresses();
        assert_eq!(addresses.len(), 2);
    }

    #[test]
    fn test_get_freelancers_by_discipline() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let f1 = Address::generate(&env);
        let f2 = Address::generate(&env);
        
        client.register_freelancer(
            &f1,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );
        client.register_freelancer(
            &f2,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Development"),
            &String::from_str(&env, "Bio"),
        );

        let designers = client.get_freelancers_by_discipline(&String::from_str(&env, "Design"));
        assert_eq!(designers.len(), 1);
        assert_eq!(designers.get(0).unwrap().name, String::from_str(&env, "Alice"));

        let developers = client.get_freelancers_by_discipline(&String::from_str(&env, "Development"));
        assert_eq!(developers.len(), 1);
        assert_eq!(developers.get(0).unwrap().name, String::from_str(&env, "Bob"));
    }

    #[test]
    fn test_get_freelancers_by_min_rating() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let f1 = Address::generate(&env);
        let f2 = Address::generate(&env);
        let f3 = Address::generate(&env);
        
        client.register_freelancer(
            &f1,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );
        client.register_freelancer(
            &f2,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );
        client.register_freelancer(
            &f3,
            &String::from_str(&env, "Charlie"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        // Update ratings: Alice=5, Bob=3, Charlie=1
        client.update_rating(&f1, &5);
        client.update_rating(&f2, &3);
        client.update_rating(&f3, &1);

        let high_rated = client.get_freelancers_by_min_rating(&4);
        assert_eq!(high_rated.len(), 1);
        assert_eq!(high_rated.get(0).unwrap().rating, 5);

        let mid_rated = client.get_freelancers_by_min_rating(&3);
        assert_eq!(mid_rated.len(), 2);
    }

    #[test]
    fn test_get_freelancers_by_verification() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let f1 = Address::generate(&env);
        let f2 = Address::generate(&env);
        
        client.register_freelancer(
            &f1,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );
        client.register_freelancer(
            &f2,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        // Verify Alice
        let admin = Address::generate(&env);
        client.verify_freelancer(&admin, &f1);

        let verified = client.get_freelancers_by_verification(&true);
        assert_eq!(verified.len(), 1);
        assert_eq!(verified.get(0).unwrap().name, String::from_str(&env, "Alice"));

        let unverified = client.get_freelancers_by_verification(&false);
        assert_eq!(unverified.len(), 1);
        assert_eq!(unverified.get(0).unwrap().name, String::from_str(&env, "Bob"));
    }

    #[test]
    fn test_query_freelancers_combined_filters() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let f1 = Address::generate(&env);
        let f2 = Address::generate(&env);
        let f3 = Address::generate(&env);
        
        client.register_freelancer(
            &f1,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );
        client.register_freelancer(
            &f2,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );
        client.register_freelancer(
            &f3,
            &String::from_str(&env, "Charlie"),
            &String::from_str(&env, "Development"),
            &String::from_str(&env, "Bio"),
        );

        // Update ratings and verify
        client.update_rating(&f1, &5);
        client.update_rating(&f2, &3);
        client.update_rating(&f3, &5);
        
        let admin = Address::generate(&env);
        client.verify_freelancer(&admin, &f1);
        client.verify_freelancer(&admin, &f3);

        // Filter: Design + rating >= 4 + verified only
        let filters = FilterOptions {
            discipline: Some(String::from_str(&env, "Design")),
            min_rating: Some(4),
            verified_only: Some(true),
        };
        let result = client.query_freelancers(&filters);
        assert_eq!(result.len(), 1);
        assert_eq!(result.get(0).unwrap().name, String::from_str(&env, "Alice"));

        // Filter: verified only (any discipline, any rating)
        let filters_verified = FilterOptions {
            discipline: None,
            min_rating: None,
            verified_only: Some(true),
        };
        let verified = client.query_freelancers(&filters_verified);
        assert_eq!(verified.len(), 2);

        // Filter: Development only
        let filters_dev = FilterOptions {
            discipline: Some(String::from_str(&env, "Development")),
            min_rating: None,
            verified_only: None,
        };
        let devs = client.query_freelancers(&filters_dev);
        assert_eq!(devs.len(), 1);
        assert_eq!(devs.get(0).unwrap().name, String::from_str(&env, "Charlie"));
    }
}
