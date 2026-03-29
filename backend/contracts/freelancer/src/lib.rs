#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug)]
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
    pub skills: Vec<String>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FilterOptions {
    pub discipline: Option<String>,
    pub min_rating: Option<u32>,
    pub verified_only: Option<bool>,
    pub skill: Option<String>,
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

// =============================================================================
// SECURITY INVARIANTS (for formal verification / audit reference)
// =============================================================================
// INV-1: A freelancer address maps to at most one profile (duplicate registration
//        returns false without overwriting).
// INV-2: FreelancerCount equals the number of unique registered addresses.
// INV-3: Rating is a running average; total_rating_count is monotonically increasing.
// INV-4: new_rating must be in [0, 500] (0–5 stars × 100); enforced in update_rating.
// INV-5: update_rating requires the caller to be the registered bounty/escrow contract.
// INV-6: verify_freelancer requires admin authentication; if a governance contract
//        is configured, the caller must also pass the is_admin check there.
// INV-7: set_governance_contract is restricted to the first setter (deployer),
//        preventing governance hijacking after initial configuration.
// =============================================================================

#[contract]
pub struct FreelancerContract;

const FL: Symbol = symbol_short!("fl");

#[contractimpl]
impl FreelancerContract {
    /// Registers a new freelancer profile.
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
            skills: Vec::new(&env),
        };

        env.storage().persistent().set(&key, &profile);

        let mut freelancers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::AllFreelancers)
            .unwrap_or(Vec::new(&env));
        freelancers.push_back(freelancer.clone());
        env.storage()
            .persistent()
            .set(&DataKey::AllFreelancers, &freelancers);

        let count: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FreelancerCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::FreelancerCount, &(count + 1));

        env.events()
            .publish((FL, symbol_short!("reg"), freelancer), (name, timestamp));

        true
    }

    /// Retrieves freelancer profile.
    pub fn get_profile(env: Env, freelancer: Address) -> FreelancerProfile {
        env.storage()
            .persistent()
            .get(&DataKey::Profile(freelancer))
            .expect("Freelancer not registered")
    }

    /// Updates freelancer's average rating with a new review.
    ///
    /// # Issue #181 — Authorization
    /// Only the registered escrow contract may submit ratings. This prevents
    /// arbitrary callers from manipulating the rating system.
    ///
    /// # Issue #183 — Bounds check
    /// `new_rating` must be in [0, 500] (representing 0.0–5.0 stars × 100).
    /// Values outside this range are rejected.
    pub fn update_rating(env: Env, caller: Address, freelancer: Address, new_rating: u32) -> bool {
        caller.require_auth();

        // #181: Only the registered escrow/bounty contract may rate freelancers
        let registered: Address = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowContract)
            .expect("Escrow contract not configured");
        if caller != registered {
            panic!("Unauthorized: only escrow contract may submit ratings");
        }

        // #183: Validate rating is within [0, 500] (0.0–5.0 stars × 100)
        assert!(new_rating <= 500, "Rating must be between 0 and 500");

        let key = DataKey::Profile(freelancer.clone());
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Freelancer not registered");

        let total = (profile.rating as u64) * (profile.total_rating_count as u64);
        profile.total_rating_count += 1;
        profile.rating =
            ((total + new_rating as u64) / profile.total_rating_count as u64) as u32;

        env.storage().persistent().set(&key, &profile);

        env.events().publish(
            (FL, symbol_short!("rate"), freelancer),
            (profile.rating, profile.total_rating_count),
        );

        true
    }

    /// Increments freelancer's completed projects count.
    pub fn update_completed_projects(env: Env, freelancer: Address) -> bool {
        let key = DataKey::Profile(freelancer);
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Freelancer not registered");

        profile.completed_projects += 1;
        env.storage().persistent().set(&key, &profile);
        true
    }

    /// Adds to freelancer's total earnings.
    ///
    /// Restricted: only the registered escrow contract may call this.
    pub fn update_earnings(env: Env, escrow: Address, freelancer: Address, amount: i128) -> bool {
        escrow.require_auth();

        let registered_escrow: Address = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowContract)
            .expect("Escrow contract not configured");

        if escrow != registered_escrow {
            panic!("Unauthorized: only escrow contract may update earnings");
        }

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

        env.events().publish(
            (FL, symbol_short!("earn"), freelancer),
            (amount, profile.total_earnings),
        );

        true
    }

    /// Registers the trusted escrow contract address (deployer-locked).
    pub fn set_escrow_contract(env: Env, setter: Address, escrow: Address) -> bool {
        setter.require_auth();

        let maybe_deployer: Option<Address> =
            env.storage().persistent().get(&DataKey::Deployer);

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
    pub fn verify_freelancer(env: Env, admin: Address, freelancer: Address) -> bool {
        admin.require_auth();

        if let Some(gov) =
            env.storage()
                .persistent()
                .get::<DataKey, Address>(&DataKey::Governance)
        {
            let args = soroban_sdk::vec![&env, admin.clone().into_val(&env)];
            let is_admin: bool =
                env.invoke_contract(&gov, &symbol_short!("is_admin"), args);
            if !is_admin {
                panic!("Admin role required");
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

        env.events()
            .publish((FL, symbol_short!("ver"), freelancer), (admin, true));

        true
    }

    /// Sets the governance contract address (deployer-locked).
    pub fn set_governance_contract(env: Env, setter: Address, governance: Address) -> bool {
        setter.require_auth();

        let maybe_deployer: Option<Address> =
            env.storage().persistent().get(&DataKey::Deployer);
        if let Some(deployer) = maybe_deployer {
            if deployer != setter {
                panic!("Only deployer may set governance contract");
            }
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::Deployer, &setter);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Governance, &governance);
        true
    }

    /// Checks if freelancer is verified.
    pub fn is_verified(env: Env, freelancer: Address) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, FreelancerProfile>(&DataKey::Profile(freelancer))
            .map(|p| p.verified)
            .unwrap_or(false)
    }

    /// Gets total registered freelancers count.
    pub fn get_freelancers_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::FreelancerCount)
            .unwrap_or(0)
    }

    /// Adds a skill to a freelancer's profile.
    pub fn add_skill(env: Env, freelancer: Address, skill: String) -> bool {
        freelancer.require_auth();
        let key = DataKey::Profile(freelancer.clone());
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Freelancer not registered");

        for s in profile.skills.iter() {
            if s == skill {
                return false;
            }
        }

        profile.skills.push_back(skill.clone());
        env.storage().persistent().set(&key, &profile);

        env.events()
            .publish((FL, symbol_short!("sk_add"), freelancer), skill);
        true
    }

    /// Removes a skill from a freelancer's profile.
    pub fn remove_skill(env: Env, freelancer: Address, skill: String) -> bool {
        freelancer.require_auth();
        let key = DataKey::Profile(freelancer.clone());
        let mut profile: FreelancerProfile = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Freelancer not registered");

        let mut index = None;
        for (i, s) in profile.skills.iter().enumerate() {
            if s == skill {
                index = Some(i as u32);
                break;
            }
        }

        if let Some(i) = index {
            profile.skills.remove(i);
            env.storage().persistent().set(&key, &profile);
            env.events()
                .publish((FL, symbol_short!("sk_rem"), freelancer), skill);
            true
        } else {
            false
        }
    }

    /// Query freelancers with combined filters.
    pub fn query_freelancers(env: Env, filters: FilterOptions) -> Vec<FreelancerProfile> {
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
                if let Some(ref discipline) = filters.discipline {
                    if profile.discipline != *discipline {
                        continue;
                    }
                }
                if let Some(min_rating) = filters.min_rating {
                    if profile.rating < min_rating {
                        continue;
                    }
                }
                if let Some(verified_only) = filters.verified_only {
                    if verified_only && !profile.verified {
                        continue;
                    }
                }
                if let Some(ref skill) = filters.skill {
                    let mut has_skill = false;
                    for s in profile.skills.iter() {
                        if s == *skill {
                            has_skill = true;
                            break;
                        }
                    }
                    if !has_skill {
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
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup(env: &Env) -> (FreelancerContractClient, Address, Address) {
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(env, &contract_id);
        let deployer = Address::generate(env);
        let escrow = Address::generate(env);
        client.set_escrow_contract(&deployer, &escrow);
        (client, deployer, escrow)
    }

    #[test]
    fn test_register_and_profile() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);
        let freelancer = Address::generate(&env);

        assert!(client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        ));
        assert_eq!(client.get_freelancers_count(), 1);
        assert!(!client.is_verified(&freelancer));
    }

    #[test]
    fn test_duplicate_registration_returns_false() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);
        let freelancer = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );
        assert!(!client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        ));
    }

    // -------------------------------------------------------------------------
    // Issue #183 — Rating bounds check
    // -------------------------------------------------------------------------

    #[test]
    fn test_update_rating_valid() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, escrow) = setup(&env);
        let freelancer = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Dev"),
            &String::from_str(&env, "Bio"),
        );

        assert!(client.update_rating(&escrow, &freelancer, &400));
        assert_eq!(client.get_profile(&freelancer).rating, 400);
    }

    #[test]
    fn test_update_rating_boundary_500() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, escrow) = setup(&env);
        let freelancer = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Dev"),
            &String::from_str(&env, "Bio"),
        );

        assert!(client.update_rating(&escrow, &freelancer, &500));
    }

    #[test]
    #[should_panic(expected = "Rating must be between 0 and 500")]
    fn test_update_rating_exceeds_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, escrow) = setup(&env);
        let freelancer = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Dev"),
            &String::from_str(&env, "Bio"),
        );

        client.update_rating(&escrow, &freelancer, &501);
    }

    // -------------------------------------------------------------------------
    // Issue #181 — Rating authorization
    // -------------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "Unauthorized: only escrow contract may submit ratings")]
    fn test_update_rating_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);
        let freelancer = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Dev"),
            &String::from_str(&env, "Bio"),
        );

        client.update_rating(&attacker, &freelancer, &300);
    }

    #[test]
    #[should_panic(expected = "Escrow contract not configured")]
    fn test_update_rating_no_escrow_configured() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreelancerContract, ());
        let client = FreelancerContractClient::new(&env, &contract_id);
        let freelancer = Address::generate(&env);
        let caller = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Bob"),
            &String::from_str(&env, "Dev"),
            &String::from_str(&env, "Bio"),
        );

        client.update_rating(&caller, &freelancer, &300);
    }

    // -------------------------------------------------------------------------
    // Earnings authorization
    // -------------------------------------------------------------------------

    #[test]
    fn test_update_earnings_success() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, escrow) = setup(&env);
        let freelancer = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        assert!(client.update_earnings(&escrow, &freelancer, &500));
        assert_eq!(client.get_profile(&freelancer).total_earnings, 500);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: only escrow contract may update earnings")]
    fn test_update_earnings_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, _) = setup(&env);
        let freelancer = Address::generate(&env);
        let attacker = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        client.update_earnings(&attacker, &freelancer, &9999);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_update_earnings_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _, escrow) = setup(&env);
        let freelancer = Address::generate(&env);

        client.register_freelancer(
            &freelancer,
            &String::from_str(&env, "Alice"),
            &String::from_str(&env, "Design"),
            &String::from_str(&env, "Bio"),
        );

        client.update_earnings(&escrow, &freelancer, &0);
    }
}
