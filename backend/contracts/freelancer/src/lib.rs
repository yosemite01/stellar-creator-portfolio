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
    // Governance / admin configuration
    Governance,
    Deployer,
    // Trusted escrow contract allowed to call update_earnings
    EscrowContract,
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
    /// **Restricted:** Only the registered escrow contract may call this
    /// function. Call `set_escrow_contract` once after deployment to configure
    /// the trusted escrow address. Any other caller will be rejected.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow`: The escrow contract address (must authenticate).
    /// - `freelancer`: Target freelancer.
    /// - `amount`: Earnings amount to add. Must be positive (> 0).
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics with "Escrow contract not configured" if no escrow address is
    ///   registered yet.
    /// - Panics with "Unauthorized: only escrow contract may update earnings"
    ///   if `escrow` is not the registered escrow contract.
    /// - Panics with "Amount must be positive" if `amount` <= 0.
    /// - Panics with "Freelancer not registered" if the freelancer profile
    ///   does not exist.
    ///
    /// # State Changes
    /// - Increments `profile.total_earnings` by `amount`.
    pub fn update_earnings(env: Env, escrow: Address, freelancer: Address, amount: i128) -> bool {
        // Require the escrow contract to sign this transaction
        escrow.require_auth();

        // Load and validate the configured escrow contract address
        let registered_escrow: Address = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowContract)
            .expect("Escrow contract not configured");

        // Reject if the caller is not the trusted escrow contract
        if escrow != registered_escrow {
            panic!("Unauthorized: only escrow contract may update earnings");
        }

        // Reject non-positive amounts to prevent earnings manipulation
        if amount <= 0 {
            panic!("Amount must be positive");
        }

        let key = DataKey::Profile(freelancer.clone());
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Freelancer not registered");

        profile.total_earnings += amount;
        env.storage().persistent().set(&key, &profile);

        let new_total = profile.total_earnings;

        // Emit EarningsUpdated event
        env.events().publish(
            (FREELANCER, symbol_short!("earnings"), freelancer),
            (amount, new_total),
        );

        true
    }

    /// Registers the trusted escrow contract address.
    ///
    /// Only the deployer (first caller of this function) may set or update
    /// the escrow contract address, using the same deployer-lock pattern as
    /// `set_governance_contract`.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `setter`: Address calling this function (must authenticate).
    /// - `escrow`: The escrow contract address that will be allowed to call
    ///   `update_earnings`.
    ///
    /// # Returns
    /// - `bool`: Always `true`.
    ///
    /// # Errors
    /// - Panics with "Only deployer may set escrow contract" if called by an
    ///   address other than the first setter.
    pub fn set_escrow_contract(env: Env, setter: Address, escrow: Address) -> bool {
        setter.require_auth();

        // Reuse the same deployer slot as set_governance_contract so both
        // functions share a single deployer identity.
        let maybe_deployer: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Deployer);

        if let Some(deployer) = maybe_deployer {
            if deployer != setter {
                panic!("Only deployer may set escrow contract");
            }
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::Deployer, &setter);
        }

        env.storage()
            .persistent()
            .set(&DataKey::EscrowContract, &escrow);

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
        // Require the caller to authenticate as the admin address passed in.
        admin.require_auth();

        // If a governance contract is configured, delegate the admin-role check to it.
        // This keeps verification meaningful: only addresses that the governance
        // contract recognizes as admins can verify freelancers. If no governance
        // contract is configured, fall back to the legacy behaviour (auth only).
        if let Some(gov) = env.storage().persistent().get::<DataKey, Address>(&DataKey::Governance) {
                // Call governance contract's `is_admin` entrypoint. If it returns
                // false, reject. We expect the governance contract to expose a
                // method named `is_admin` that takes an Address and returns bool.
                // If the governance contract is not present or doesn't expose the
                // method, this will trap at runtime — that's intentional to make
                // misconfiguration visible.
                let is_admin: bool = env.invoke_contract(&gov, &symbol_short!("is_admin"), (admin.clone(),));
                if !is_admin {
                    panic!("Admin role required");
                }
            }
        }

        let key = DataKey::Profile(freelancer.clone());
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Freelancer not registered");

        profile.verified = true;
        env.storage().persistent().set(&key, &profile);

        // Event: freelancer verified
        env.events().publish(
            (FREELANCER, symbol_short!("verified"), freelancer),
            (admin, true),
        );

        true
    }

    /// Sets the governance contract address used for admin role checks.
    /// Can be called by any address that authenticates; this is intentionally
    /// permissive to allow initial configuration. Operators should set this
    /// to the governance contract address and then manage admin roles via the
    /// governance contract itself.
    pub fn set_governance_contract(env: Env, setter: Address, governance: Address) -> bool {
        setter.require_auth();

        // If deployer not set yet, record the first setter as the deployer.
        let maybe_deployer: Option<Address> = env.storage().persistent().get(&DataKey::Deployer);
        if let Some(deployer) = maybe_deployer {
            // Only the recorded deployer can change the governance address
            if deployer != setter {
                panic!("Only deployer may set governance contract");
            }
        } else {
            // Record the setter as deployer on first-time configuration
            env.storage().persistent().set(&DataKey::Deployer, &setter);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Governance, &governance);
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

    // -------------------------------------------------------------------------
    // Tests for update_earnings authorization (Issue #190)
    // -------------------------------------------------------------------------

    #[test]
    fn test_update_earnings_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let deployer = Address::generate(&env);
        let escrow = Address::generate(&env);
        let freelancer = Address::generate(&env);

        // Configure trusted escrow contract
        client.set_escrow_contract(&deployer, &escrow);

        // Register freelancer
        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        // Escrow updates earnings
        let result = client.update_earnings(&escrow, &freelancer, &500i128);
        assert!(result);

        let profile = client.get_profile(&freelancer);
        assert_eq!(profile.total_earnings, 500i128);

        // Second update accumulates
        client.update_earnings(&escrow, &freelancer, &250i128);
        let profile = client.get_profile(&freelancer);
        assert_eq!(profile.total_earnings, 750i128);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: only escrow contract may update earnings")]
    fn test_update_earnings_unauthorized_caller() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let deployer = Address::generate(&env);
        let escrow = Address::generate(&env);
        let attacker = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.set_escrow_contract(&deployer, &escrow);
        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        // Attacker tries to inflate earnings
        client.update_earnings(&attacker, &freelancer, &9999i128);
    }

    #[test]
    #[should_panic(expected = "Escrow contract not configured")]
    fn test_update_earnings_no_escrow_configured() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let escrow = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        // No escrow configured yet — should panic
        client.update_earnings(&escrow, &freelancer, &100i128);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_update_earnings_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let deployer = Address::generate(&env);
        let escrow = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.set_escrow_contract(&deployer, &escrow);
        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        // Zero amount should be rejected
        client.update_earnings(&escrow, &freelancer, &0i128);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_update_earnings_negative_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let deployer = Address::generate(&env);
        let escrow = Address::generate(&env);
        let freelancer = Address::generate(&env);

        client.set_escrow_contract(&deployer, &escrow);
        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        // Negative amount (attempting to reduce earnings) should be rejected
        client.update_earnings(&escrow, &freelancer, &-100i128);
    }

    #[test]
    #[should_panic(expected = "Only deployer may set escrow contract")]
    fn test_set_escrow_contract_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);

        let deployer = Address::generate(&env);
        let escrow = Address::generate(&env);
        let attacker = Address::generate(&env);
        let new_escrow = Address::generate(&env);

        // Deployer sets the escrow contract
        client.set_escrow_contract(&deployer, &escrow);

        // Attacker tries to replace the escrow with their own address
        client.set_escrow_contract(&attacker, &new_escrow);
    }
}
