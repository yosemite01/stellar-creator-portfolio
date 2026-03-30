#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Symbol, Vec};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Owner,
    Admin(Address),
    AdminList,
    Delegate(Address),
    ProposalCounter,
    Proposal(u64),
    HasVoted(u64, Address),
    FreelancerContract, // Link to freelancer contract for reputation weights
    TokenContract,      // Link to platform token contract for token-based voting
    PlatformFee,        // From main: platform fee state
    Parameter(Symbol),  // From main: dynamic parameters
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FreelancerProfile {
    pub address: Address,
    pub name: soroban_sdk::String,
    pub discipline: soroban_sdk::String,
    pub bio: soroban_sdk::String,
    pub rating: u32,
    pub total_rating_count: u32,
    pub completed_projects: u32,
    pub total_earnings: i128,
    pub verified: bool,
    pub created_at: u64,
    pub skills: soroban_sdk::Vec<soroban_sdk::String>,
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalType {
    AddAdmin(Address),
    RemoveAdmin(Address),
    FeeChange(u32),
    ParameterUpdate(Symbol, u32),
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ProposalStatus {
    Pending = 0,
    Executed = 1,
    Rejected = 2,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub creator: Address,
    pub prop_type: ProposalType,
    pub status: ProposalStatus,
    pub votes_for: i128,    // Weighted voting uses i128
    pub votes_against: i128, 
    pub created_at: u64,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AdminAddedEvent {
    pub admin: Address,
    pub added_by: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AdminRemovedEvent {
    pub admin: Address,
    pub removed_by: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalCreatedEvent {
    pub proposal_id: u64,
    pub proposer: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VoteCastEvent {
    pub proposal_id: u64,
    pub voter: Address,
    pub support: bool,
    pub weight: i128, // Using weighted power
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalExecutedEvent {
    pub proposal_id: u64,
    pub executor: Address,
    pub status: u32,
    pub votes_for: i128,
    pub votes_against: i128,
    pub timestamp: u64,
}

const GOV: Symbol = symbol_short!("gov");

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    /// Initialize the governance contract owner.
    pub fn init(env: Env, owner: Address) -> bool {
        owner.require_auth();
        if env.storage().persistent().has(&DataKey::Owner) {
            panic!("Already initialized");
        }
        env.storage().persistent().set(&DataKey::Owner, &owner);
        env.storage()
            .persistent()
            .set(&DataKey::AdminList, &Vec::<Address>::new(&env));
        true
    }

    /// Set the freelancer contract to query reputation/earnings.
    pub fn set_freelancer_contract(env: Env, owner: Address, freelancer_contract: Address) -> bool {
        owner.require_auth();
        let stored_owner: Address = env.storage().persistent().get(&DataKey::Owner).expect("Not initialized");
        if owner != stored_owner {
            panic!("Only owner can set freelancer contract");
        }
        env.storage().persistent().set(&DataKey::FreelancerContract, &freelancer_contract);
        true
    }

    /// Set the platform token contract for token-based voting weights.
    pub fn set_token_contract(env: Env, owner: Address, token_contract: Address) -> bool {
        owner.require_auth();
        let stored_owner: Address = env.storage().persistent().get(&DataKey::Owner).expect("Not initialized");
        if owner != stored_owner {
            panic!("Only owner can set token contract");
        }
        env.storage().persistent().set(&DataKey::TokenContract, &token_contract);
        true
    }

    pub fn add_admin(env: Env, owner: Address, admin: Address) -> bool {
        owner.require_auth();
        let stored_owner: Address = env.storage().persistent().get(&DataKey::Owner).expect("Not initialized");
        if stored_owner != owner { panic!("Unauthorized"); }

        Self::add_admin_internal(env.clone(), admin.clone());
        env.events().publish(
            (GOV, symbol_short!("adm_add")),
            (admin, owner, env.ledger().timestamp()),
        );
        true
    }

    pub fn remove_admin(env: Env, owner: Address, admin: Address) -> bool {
        owner.require_auth();
        let stored_owner: Address = env.storage().persistent().get(&DataKey::Owner).expect("Not initialized");
        if stored_owner != owner { panic!("Unauthorized"); }

        Self::remove_admin_internal(env.clone(), admin.clone());
        env.events().publish(
            (GOV, symbol_short!("adm_rm")),
            (admin, owner, env.ledger().timestamp()),
        );
        true
    }

    pub fn is_admin(env: Env, addr: Address) -> bool {
        env.storage().persistent().get::<DataKey, bool>(&DataKey::Admin(addr)).unwrap_or(false)
    }

    pub fn delegate_vote(env: Env, delegator: Address, delegatee: Address) -> bool {
        delegator.require_auth();
        if !Self::is_admin(env.clone(), delegator.clone()) { panic!("Only admins"); }
        if !Self::is_admin(env.clone(), delegatee.clone()) { panic!("Only admins"); }
        
        Self::assert_no_delegation_cycle(env.clone(), delegator.clone(), delegatee.clone());
        env.storage().persistent().set(&DataKey::Delegate(delegator.clone()), &delegatee);
        true
    }

    pub fn create_proposal(env: Env, creator: Address, prop_type: ProposalType) -> u64 {
        creator.require_auth();
        if !Self::is_admin(env.clone(), creator.clone()) { panic!("Only admins"); }

        let mut counter: u64 = env.storage().persistent().get(&DataKey::ProposalCounter).unwrap_or(0);
        counter += 1;

        let proposal = Proposal {
            id: counter,
            creator: creator.clone(),
            prop_type,
            status: ProposalStatus::Pending,
            votes_for: 0,
            votes_against: 0,
            created_at: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::Proposal(counter), &proposal);
        env.storage().persistent().set(&DataKey::ProposalCounter, &counter);

        env.events().publish(
            (GOV, symbol_short!("prop_new")),
            (counter, creator, env.ledger().timestamp()),
        );
        counter
    }

    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) -> bool {
        voter.require_auth();
        if !Self::is_admin(env.clone(), voter.clone()) { panic!("Only admins"); }
        if env.storage().persistent().has(&DataKey::Delegate(voter.clone())) { panic!("Delegated"); }

        let key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env.storage().persistent().get(&key).expect("Not found");
        if proposal.status != ProposalStatus::Pending { panic!("Not pending"); }

        let admins = Self::admin_list(env.clone());
        let mut total_weight: i128 = 0;
        
        for admin in admins.iter() {
            let voted_key = DataKey::HasVoted(proposal_id, admin.clone());
            if !env.storage().persistent().has(&voted_key) {
                let final_delegate = Self::resolve_final_delegate(env.clone(), admin.clone(), admins.len() + 1);
                if final_delegate == voter {
                    let weight = Self::get_voter_weight(env.clone(), admin.clone());
                    total_weight += weight;
                    env.storage().persistent().set(&voted_key, &true);
                }
            }
        }

        if total_weight == 0 { panic!("No power"); }

        if support { proposal.votes_for += total_weight; } 
        else { proposal.votes_against += total_weight; }

        env.storage().persistent().set(&key, &proposal);
        env.events().publish(
            (GOV, symbol_short!("voted")),
            (proposal_id, voter, support, total_weight, env.ledger().timestamp()),
        );
        true
    }

    pub fn execute_proposal(env: Env, caller: Address, proposal_id: u64) -> bool {
        caller.require_auth();
        let key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env.storage().persistent().get(&key).expect("Not found");

        if proposal.votes_for > proposal.votes_against && proposal.votes_for > 0 {
            proposal.status = ProposalStatus::Executed;
            match &proposal.prop_type {
                ProposalType::AddAdmin(new_admin) => Self::add_admin_internal(env.clone(), new_admin.clone()),
                ProposalType::RemoveAdmin(old_admin) => Self::remove_admin_internal(env.clone(), old_admin.clone()),
                ProposalType::FeeChange(new_fee) => env.storage().persistent().set(&DataKey::PlatformFee, &new_fee),
                ProposalType::ParameterUpdate(param, value) => env.storage().persistent().set(&DataKey::Parameter(param.clone()), &value),
            }
        } else {
            proposal.status = ProposalStatus::Rejected;
        }

        env.storage().persistent().set(&key, &proposal);
        env.events().publish(
            (GOV, symbol_short!("prop_exc")),
            (proposal_id, caller, (proposal.status as u32), proposal.votes_for, proposal.votes_against, env.ledger().timestamp()),
        );
        true
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        env.storage().persistent().get(&DataKey::Proposal(proposal_id)).expect("Not found")
    }

    // ── Internal Helpers ─────────────────────────────────────────────────────

    fn get_voter_weight(env: Env, voter: Address) -> i128 {
        let mut total_weight: i128 = 1;

        if let Some(fl_contract) = env.storage().persistent().get::<DataKey, Address>(&DataKey::FreelancerContract) {
            let get_profile_sym = soroban_sdk::Symbol::new(&env, "get_profile");
            if let Ok(Ok(profile)) = env.try_invoke_contract::<FreelancerProfile, soroban_sdk::Error>(
                &fl_contract, &get_profile_sym, soroban_sdk::vec![&env, voter.clone().into_val(&env)]
            ) {
                total_weight += (profile.total_earnings / 10_000_000) + (profile.completed_projects as i128 * 10);
            }
        }

        if let Some(token_contract) = env.storage().persistent().get::<DataKey, Address>(&DataKey::TokenContract) {
            if let Ok(Ok(balance)) = env.try_invoke_contract::<i128, soroban_sdk::Error>(
                &token_contract, &symbol_short!("balance"), soroban_sdk::vec![&env, voter.into_val(&env)]
            ) {
                total_weight += balance / 1_000_000;
            }
        }
        total_weight
    }

    fn add_admin_internal(env: Env, admin: Address) {
        if Self::is_admin(env.clone(), admin.clone()) { return; }
        env.storage().persistent().set(&DataKey::Admin(admin.clone()), &true);
        let mut admins = Self::admin_list(env.clone());
        admins.push_back(admin);
        env.storage().persistent().set(&DataKey::AdminList, &admins);
    }

    fn remove_admin_internal(env: Env, admin: Address) {
        if !Self::is_admin(env.clone(), admin.clone()) { return; }
        env.storage().persistent().remove(&DataKey::Admin(admin.clone()));
        let mut admins = Self::admin_list(env.clone());
        for i in 0..admins.len() {
            if admins.get(i).unwrap() == admin { admins.remove(i); break; }
        }
        env.storage().persistent().set(&DataKey::AdminList, &admins);
        env.storage().persistent().remove(&DataKey::Delegate(admin.clone()));
    }

    fn admin_list(env: Env) -> Vec<Address> {
        env.storage().persistent().get(&DataKey::AdminList).unwrap_or(Vec::new(&env))
    }

    fn assert_no_delegation_cycle(env: Env, delegator: Address, delegatee: Address) {
        let mut current = delegatee;
        for _ in 0..(Self::admin_list(env.clone()).len() + 1) {
            if current == delegator { panic!("Cycle"); }
            match env.storage().persistent().get::<DataKey, Address>(&DataKey::Delegate(current.clone())) {
                Some(next) => current = next,
                None => return,
            }
        }
        panic!("Cycle");
    }

    fn resolve_final_delegate(env: Env, start: Address, max_hops: u32) -> Address {
        let mut current = start;
        for _ in 0..max_hops {
            match env.storage().persistent().get::<DataKey, Address>(&DataKey::Delegate(current.clone())) {
                Some(next) => {
                    if !Self::is_admin(env.clone(), next.clone()) { return current; }
                    current = next;
                }
                None => return current,
            }
        }
        panic!("Cycle");
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    struct TestEnv {
        env: Env,
        owner: Address,
        contract_id: Address,
    }

    impl TestEnv {
        fn new() -> Self {
            let env = Env::default();
            env.mock_all_auths();
            let contract_id = env.register(GovernanceContract, ());
            let owner = Address::generate(&env);
            GovernanceContractClient::new(&env, &contract_id).init(&owner);
            TestEnv { env, owner, contract_id }
        }

        fn client(&self) -> GovernanceContractClient {
            GovernanceContractClient::new(&self.env, &self.contract_id)
        }
    }

    #[test]
    fn test_init_and_admin() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        assert!(client.is_admin(&admin));
    }

    #[contract]
    pub struct MockFreelancer;

    #[contractimpl]
    impl MockFreelancer {
        pub fn get_profile(env: Env, addr: Address) -> FreelancerProfile {
            FreelancerProfile {
                address: addr,
                name: soroban_sdk::String::from_str(&env, "Mock"),
                discipline: soroban_sdk::String::from_str(&env, "Mock"),
                bio: soroban_sdk::String::from_str(&env, "Mock"),
                rating: 500,
                total_rating_count: 1,
                completed_projects: 10,
                total_earnings: 20_000_000,
                verified: true,
                created_at: 0,
                skills: soroban_sdk::Vec::new(&env),
            }
        }
    }

    #[contract]
    pub struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn balance(_env: Env, _addr: Address) -> i128 {
            5_000_000
        }
    }

    #[test]
    fn test_weighted_voting_reputation() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);

        let freelancer_id = t.env.register(MockFreelancer, ());
        client.set_freelancer_contract(&t.owner, &freelancer_id);

        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(Address::generate(&t.env)));
        client.vote(&admin, &prop_id, &true);

        let proposal = client.get_proposal(&prop_id);
        // Base(1) + (20,000,000 / 10,000,000) + (10 * 10) = 1 + 2 + 100 = 103
        assert_eq!(proposal.votes_for, 103);
    }

    #[test]
    fn test_weighted_voting_tokens() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);

        let token_id = t.env.register(MockToken, ());
        client.set_token_contract(&t.owner, &token_id);

        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(Address::generate(&t.env)));
        client.vote(&admin, &prop_id, &true);

        let proposal = client.get_proposal(&prop_id);
        // Base(1) + (5,000,000 / 1,000,000) = 1 + 5 = 6
        assert_eq!(proposal.votes_for, 6);
    }

    #[test]
    fn test_weighted_voting_combined() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);

        let freelancer_id = t.env.register(MockFreelancer, ());
        let token_id = t.env.register(MockToken, ());
        client.set_freelancer_contract(&t.owner, &freelancer_id);
        client.set_token_contract(&t.owner, &token_id);

        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(Address::generate(&t.env)));
        client.vote(&admin, &prop_id, &true);

        let proposal = client.get_proposal(&prop_id);
        // Base(1) + Rep(2 + 100) + Tok(5) = 1 + 102 + 5 = 108
        assert_eq!(proposal.votes_for, 108);
    }

    #[test]
    fn test_weighted_voting_base() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(Address::generate(&t.env)));
        client.vote(&admin1, &prop_id, &true);
        
        let proposal = client.get_proposal(&prop_id);
        // Default weight is 1.
        assert_eq!(proposal.votes_for, 1);
    }

    #[test]
    fn test_weighted_voting_with_delegation() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        let admin3 = Address::generate(&t.env);
        
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);
        client.add_admin(&t.owner, &admin3);

        client.delegate_vote(&admin2, &admin1);
        client.delegate_vote(&admin3, &admin1);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(Address::generate(&t.env)));
        client.vote(&admin1, &prop_id, &true);
        
        let proposal = client.get_proposal(&prop_id);
        // Default base weights: 1 + 1 + 1 = 3.
        assert_eq!(proposal.votes_for, 3);
    }

    #[test]
    #[should_panic(expected = "Delegated")]
    fn test_delegator_cannot_vote() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);
        client.delegate_vote(&admin2, &admin1);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(Address::generate(&t.env)));
        client.vote(&admin2, &prop_id, &true);
    }
}