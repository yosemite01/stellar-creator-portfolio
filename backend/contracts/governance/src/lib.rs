#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec};

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
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalType {
    AddAdmin(Address),
    RemoveAdmin(Address),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
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
    pub votes_for: u32,
    pub votes_against: u32,
    pub created_at: u64,
}

// =============================================================================
// SECURITY INVARIANTS (for formal verification / audit reference)
// =============================================================================
// INV-1: Only the stored owner may add or remove admins.
// INV-2: Only admins may create proposals or vote.
// INV-3: An admin may vote at most once per proposal (HasVoted key enforces this).
// INV-4: Proposal status transitions: Pending → Executed | Rejected only.
//        Terminal states never revert.
// INV-5: execute_proposal applies state changes only when votes_for > votes_against
//        AND votes_for > 0; otherwise marks Rejected.
// INV-6: ProposalCounter is monotonically increasing; proposal IDs are unique.
// =============================================================================

// ── Events ───────────────────────────────────────────────────────────────────

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct AdminAdded {
    pub admin: Address,
    pub owner: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct AdminRemoved {
    pub admin: Address,
    pub owner: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalCreated {
    pub proposal_id: u64,
    pub creator: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct Voted {
    pub proposal_id: u64,
    pub voter: Address,
    pub support: bool,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalExecuted {
    pub proposal_id: u64,
    pub status: u32,
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    /// Initialize the governance contract owner. Owner must authenticate.
    pub fn init(env: Env, owner: Address) -> bool {
        owner.require_auth();
        env.storage().persistent().set(&DataKey::Owner, &owner);
        env.storage()
            .persistent()
            .set(&DataKey::AdminList, &Vec::<Address>::new(&env));
        true
    }

    /// Add an admin. Only the owner may add admins.
    pub fn add_admin(env: Env, owner: Address, admin: Address) -> bool {
        owner.require_auth();
        let stored_owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Owner)
            .expect("Governance not initialized");
        if stored_owner != owner {
            panic!("Only owner can add admins");
        }

        Self::add_admin_internal(env.clone(), admin.clone());
        env.events()
            .publish((GOVERNANCE, symbol_short!("adm_add"), admin), (owner,));
        true
    }

    /// Remove an admin. Only the owner may remove admins.
    pub fn remove_admin(env: Env, owner: Address, admin: Address) -> bool {
        owner.require_auth();
        let stored_owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Owner)
            .expect("Governance not initialized");
        if stored_owner != owner {
            panic!("Only owner can remove admins");
        }

        Self::remove_admin_internal(env.clone(), admin.clone());
        env.events()
            .publish((GOVERNANCE, symbol_short!("adm_rm"), admin), (owner,));
        true
    }

    /// Check whether an address is an admin.
    pub fn is_admin(env: Env, addr: Address) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::Admin(addr))
            .unwrap_or(false)
    }

    /// Returns all active admin addresses.
    pub fn get_admins(env: Env) -> Vec<Address> {
        Self::admin_list(env)
    }

    /// Delegate the caller's voting power to another admin.
    pub fn delegate_vote(env: Env, delegator: Address, delegatee: Address) -> bool {
        delegator.require_auth();

        if !Self::is_admin(env.clone(), delegator.clone()) {
            panic!("Only admins can delegate");
        }
        if !Self::is_admin(env.clone(), delegatee.clone()) {
            panic!("Delegatee must be an admin");
        }
        if delegator == delegatee {
            panic!("Cannot delegate to self");
        }

        Self::assert_no_delegation_cycle(env.clone(), delegator.clone(), delegatee.clone());

        env.storage()
            .persistent()
            .set(&DataKey::Delegate(delegator.clone()), &delegatee);

        env.events().publish(
            (GOVERNANCE, symbol_short!("deleg_set"), delegator),
            (delegatee,),
        );
        true
    }

    /// Remove any existing voting delegation for the caller.
    pub fn clear_delegate(env: Env, delegator: Address) -> bool {
        delegator.require_auth();

        if !Self::is_admin(env.clone(), delegator.clone()) {
            panic!("Only admins can clear delegation");
        }

        env.storage()
            .persistent()
            .remove(&DataKey::Delegate(delegator.clone()));
        env.events()
            .publish((GOVERNANCE, symbol_short!("deleg_clr"), delegator), ());
        true
    }

    /// Return the current delegate for an admin, if set.
    pub fn get_delegate(env: Env, delegator: Address) -> Option<Address> {
        env.storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Delegate(delegator))
    }

    // -------------------------------------------------------------------------
    // Proposal logic (Issue #192)
    // -------------------------------------------------------------------------

    /// Creates a new governance proposal.
    /// Only an active admin can create a proposal.
    pub fn create_proposal(env: Env, creator: Address, prop_type: ProposalType) -> u64 {
        creator.require_auth();
        if !Self::is_admin(env.clone(), creator.clone()) {
            panic!("Only admins can create proposals");
        }

        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::ProposalCounter)
            .unwrap_or(0);
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

        env.storage()
            .persistent()
            .set(&DataKey::Proposal(counter), &proposal);
        env.storage()
            .persistent()
            .set(&DataKey::ProposalCounter, &counter);

        env.events().publish(
            (GOVERNANCE, symbol_short!("prop_new"), counter),
            (creator,),
        );

        counter
    }

    /// Cast a vote on a Pending proposal.
    /// Voting power includes direct voter + any admins delegating to the voter.
    pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) -> bool {
        voter.require_auth();
        if !Self::is_admin(env.clone(), voter.clone()) {
            panic!("Only admins can vote");
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Delegate(voter.clone()))
        {
            panic!("Delegated admins cannot vote directly");
        }

        let key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Pending {
            panic!("Proposal is not in Pending status");
        }

        let admins = Self::admin_list(env.clone());
        let admin_count = admins.len();
        let mut voting_power: u32 = 0;
        let mut i: u32 = 0;
        while i < admin_count {
            let admin = admins.get(i).expect("admin missing");
            let voted_key = DataKey::HasVoted(proposal_id, admin.clone());
            if !env.storage().persistent().has(&voted_key) {
                let final_delegate =
                    Self::resolve_final_delegate(env.clone(), admin.clone(), admin_count + 1);
                if final_delegate == voter {
                    voting_power += 1;
                    env.storage().persistent().set(&voted_key, &true);
                }
            }
            i += 1;
        }

        if voting_power == 0 {
            panic!("No voting power available");
        }

        if support {
            proposal.votes_for += voting_power;
        } else {
            proposal.votes_against += voting_power;
        }

        env.storage().persistent().set(&key, &proposal);
        env.events().publish(
            (GOVERNANCE, symbol_short!("voted"), proposal_id),
            (voter, support, voting_power),
        );

        true
    }

    /// Executes a proposal.
    /// Only admins can trigger execution, and the proposal must be Pending.
    /// If `votes_for > votes_against` and `votes_for > 0`, it executes the specific State Change Action.
    /// Otherwise, it marks the proposal as Rejected.
    pub fn execute_proposal(env: Env, caller: Address, proposal_id: u64) -> bool {
        caller.require_auth();
        if !Self::is_admin(env.clone(), caller.clone()) {
            panic!("Only admins can execute proposals");
        }

        let key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Pending {
            panic!("Proposal is not in Pending status");
        }

        if proposal.votes_for > proposal.votes_against && proposal.votes_for > 0 {
            proposal.status = ProposalStatus::Executed;

            match &proposal.prop_type {
                ProposalType::AddAdmin(new_admin) => {
                    Self::add_admin_internal(env.clone(), new_admin.clone());
                    env.events().publish(
                        (GOVERNANCE, symbol_short!("adm_add"), new_admin.clone()),
                        (Symbol::new(&env, "proposal"),),
                    );
                }
                ProposalType::RemoveAdmin(old_admin) => {
                    Self::remove_admin_internal(env.clone(), old_admin.clone());
                    env.events().publish(
                        (GOVERNANCE, symbol_short!("adm_rm"), old_admin.clone()),
                        (Symbol::new(&env, "proposal"),),
                    );
                }
            }
        } else {
            proposal.status = ProposalStatus::Rejected;
        }

        env.storage().persistent().set(&key, &proposal);
        env.events().publish(
            (GOVERNANCE, symbol_short!("prop_exec"), proposal_id),
            (proposal.status as u32,),
        );

        true
    }

    /// Retrieves the full details of a proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .expect("Proposal not found")
    }

    fn add_admin_internal(env: Env, admin: Address) {
        if Self::is_admin(env.clone(), admin.clone()) {
            return;
        }

        env.storage()
            .persistent()
            .set(&DataKey::Admin(admin.clone()), &true);

        let mut admins = Self::admin_list(env.clone());
        admins.push_back(admin);
        env.storage().persistent().set(&DataKey::AdminList, &admins);
    }

    fn remove_admin_internal(env: Env, admin: Address) {
        if !Self::is_admin(env.clone(), admin.clone()) {
            return;
        }

        env.storage()
            .persistent()
            .remove(&DataKey::Admin(admin.clone()));

        let mut admins = Self::admin_list(env.clone());
        let mut i: u32 = 0;
        while i < admins.len() {
            if admins.get(i).expect("admin missing") == admin {
                admins.remove(i);
                break;
            }
            i += 1;
        }
        env.storage().persistent().set(&DataKey::AdminList, &admins);

        env.storage()
            .persistent()
            .remove(&DataKey::Delegate(admin.clone()));

        // Clear delegations pointing at the removed admin to avoid stale targets.
        let mut j: u32 = 0;
        while j < admins.len() {
            let current_admin = admins.get(j).expect("admin missing");
            let current_delegate: Option<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::Delegate(current_admin.clone()));
            if current_delegate == Some(admin.clone()) {
                env.storage()
                    .persistent()
                    .remove(&DataKey::Delegate(current_admin));
            }
            j += 1;
        }
    }

    fn admin_list(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::AdminList)
            .unwrap_or(Vec::new(&env))
    }

    fn assert_no_delegation_cycle(env: Env, delegator: Address, delegatee: Address) {
        let mut current = delegatee;
        let max_hops = Self::admin_list(env.clone()).len() + 1;
        let mut hops: u32 = 0;

        while hops < max_hops {
            if current == delegator {
                panic!("Delegation cycle not allowed");
            }

            let next: Option<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::Delegate(current.clone()));

            match next {
                Some(next_addr) => current = next_addr,
                None => return,
            }

            hops += 1;
        }

        panic!("Delegation cycle not allowed");
    }

    fn resolve_final_delegate(env: Env, start: Address, max_hops: u32) -> Address {
        let mut current = start;
        let mut hops: u32 = 0;

        while hops < max_hops {
            let next: Option<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::Delegate(current.clone()));

            match next {
                Some(next_addr) => {
                    // If delegate target is no longer an active admin, stop resolution
                    // and keep voting power with the current admin.
                    if !Self::is_admin(env.clone(), next_addr.clone()) {
                        return current;
                    }
                    current = next_addr;
                }
                None => return current,
            }

            hops += 1;
        }

        panic!("Delegation cycle not allowed");
    }
	/// Initialize the governance contract owner. Owner must authenticate.
	pub fn init(env: Env, owner: Address) -> bool {
		owner.require_auth();
		env.storage().persistent().set(&DataKey::Owner, &owner);
		true
	}

	/// Add an admin. Only the owner may add admins.
	pub fn add_admin(env: Env, owner: Address, admin: Address) -> bool {
		owner.require_auth();
		let stored_owner: Address = env
			.storage()
			.persistent()
			.get(&DataKey::Owner)
			.expect("Governance not initialized");
		if stored_owner != owner {
			panic!("Only owner can add admins");
		}
		env.storage()
			.persistent()
			.set(&DataKey::Admin(admin.clone()), &true);
		
		// Event: admin added
		AdminAdded { admin, owner }.publish(&env);
		true
	}

	/// Remove an admin. Only the owner may remove admins.
	pub fn remove_admin(env: Env, owner: Address, admin: Address) -> bool {
		owner.require_auth();
		let stored_owner: Address = env
			.storage()
			.persistent()
			.get(&DataKey::Owner)
			.expect("Governance not initialized");
		if stored_owner != owner {
			panic!("Only owner can remove admins");
		}
		env.storage().persistent().remove(&DataKey::Admin(admin.clone()));
		
		AdminRemoved { admin, owner }.publish(&env);
		true
	}

	/// Check whether an address is an admin.
	pub fn is_admin(env: Env, addr: Address) -> bool {
		env.storage()
			.persistent()
			.get::<DataKey, bool>(&DataKey::Admin(addr))
			.unwrap_or(false)
	}

	// -------------------------------------------------------------------------
	// Proposal logic (Issue #192)
	// -------------------------------------------------------------------------

	/// Creates a new governance proposal.
	pub fn create_proposal(env: Env, creator: Address, prop_type: ProposalType) -> u64 {
		creator.require_auth();
		if !Self::is_admin(env.clone(), creator.clone()) {
			panic!("Only admins can create proposals");
		}

		let mut counter: u64 = env.storage().instance().get(&DataKey::ProposalCounter).unwrap_or(0);
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
		env.storage().instance().set(&DataKey::ProposalCounter, &counter);

		ProposalCreated { proposal_id: counter, creator }.publish(&env);

		counter
	}

	/// Cast a vote on a Pending proposal.
	pub fn vote(env: Env, voter: Address, proposal_id: u64, support: bool) -> bool {
		voter.require_auth();
		if !Self::is_admin(env.clone(), voter.clone()) {
			panic!("Only admins can vote");
		}

		let key = DataKey::Proposal(proposal_id);
		let mut proposal: Proposal = env
			.storage()
			.persistent()
			.get(&key)
			.expect("Proposal not found");

		if proposal.status != ProposalStatus::Pending {
			panic!("Proposal is not in Pending status");
		}

		let voted_key = DataKey::HasVoted(proposal_id, voter.clone());
		if env.storage().persistent().has(&voted_key) {
			panic!("Already voted");
		}

		if support {
			proposal.votes_for += 1;
		} else {
			proposal.votes_against += 1;
		}

		env.storage().persistent().set(&key, &proposal);
		env.storage().persistent().set(&voted_key, &true);

		Voted { proposal_id, voter, support }.publish(&env);

		true
	}

	/// Executes a proposal.
	pub fn execute_proposal(env: Env, caller: Address, proposal_id: u64) -> bool {
		caller.require_auth();
		if !Self::is_admin(env.clone(), caller.clone()) {
			panic!("Only admins can execute proposals");
		}

		let key = DataKey::Proposal(proposal_id);
		let mut proposal: Proposal = env
			.storage()
			.persistent()
			.get(&key)
			.expect("Proposal not found");

		if proposal.status != ProposalStatus::Pending {
			panic!("Proposal is not in Pending status");
		}

		// Execution condition
		if proposal.votes_for > proposal.votes_against && proposal.votes_for > 0 {
			proposal.status = ProposalStatus::Executed;

			// Apply State Changes directly mapped to enum
			match &proposal.prop_type {
				ProposalType::AddAdmin(new_admin) => {
					env.storage()
						.persistent()
						.set(&DataKey::Admin(new_admin.clone()), &true);
					AdminAdded { admin: new_admin.clone(), owner: caller.clone() }.publish(&env);
				}
				ProposalType::RemoveAdmin(old_admin) => {
					env.storage().persistent().remove(&DataKey::Admin(old_admin.clone()));
					AdminRemoved { admin: old_admin.clone(), owner: caller.clone() }.publish(&env);
				}
			}
		} else {
			proposal.status = ProposalStatus::Rejected;
		}

		env.storage().persistent().set(&key, &proposal);

		ProposalExecuted { proposal_id, status: proposal.status as u32 }.publish(&env);

		true
	}

	/// Retrieves the full details of a proposal by ID.
	pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
		env.storage()
			.persistent()
			.get(&DataKey::Proposal(proposal_id))
			.expect("Proposal not found")
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger};
    use soroban_sdk::{Env, IntoVal};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Admin management – existing behaviour preserved
    // -----------------------------------------------------------------------

    #[test]
    fn test_add_and_check_admin() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        assert!(client.add_admin(&t.owner, &admin));
        assert!(client.is_admin(&admin));
        assert!(client.remove_admin(&t.owner, &admin));
        assert!(!client.is_admin(&admin));
    }

    // -----------------------------------------------------------------------
    // Proposal lifecycle – existing behaviour preserved
    // -----------------------------------------------------------------------

    #[test]
    fn test_proposal_lifecycle() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        let new_admin = Address::generate(&t.env);

        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(new_admin.clone()));
        assert_eq!(prop_id, 1);
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Pending);

        client.vote(&admin1, &prop_id, &true);
        assert_eq!(client.get_proposal(&prop_id).votes_for, 1);

        assert!(client.execute_proposal(&admin2, &prop_id));
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Executed);
	use super::*;
	use soroban_sdk::testutils::Address as _;
	use soroban_sdk::Env;

	#[test]
	fn test_add_and_check_admin() {
		let env = Env::default();
		env.mock_all_auths();
		let contract_id = env.register(GovernanceContract, ());
		let client = GovernanceContractClient::new(&env, &contract_id);

		let owner = Address::generate(&env);
		// Initialize
		assert!(client.init(&owner));

		let admin = Address::generate(&env);
		assert!(client.add_admin(&owner, &admin));
		assert!(client.is_admin(&admin));

		assert!(client.remove_admin(&owner, &admin));
		assert!(!client.is_admin(&admin));
	}

	#[test]
	fn test_proposal_lifecycle() {
		let env = Env::default();
		env.mock_all_auths();
		let contract_id = env.register(GovernanceContract, ());
		let client = GovernanceContractClient::new(&env, &contract_id);

		let owner = Address::generate(&env);
		let admin1 = Address::generate(&env);
		let admin2 = Address::generate(&env);
		let new_admin = Address::generate(&env);

		// Initialize & setup admins
		client.init(&owner);
		client.add_admin(&owner, &admin1);
		client.add_admin(&owner, &admin2);

		// admin1 creates proposal to add new_admin
		let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(new_admin.clone()));
		assert_eq!(prop_id, 1);

		let prop = client.get_proposal(&prop_id);
		assert_eq!(prop.status, ProposalStatus::Pending);
		assert_eq!(prop.votes_for, 0);

		// admin1 votes FOR
		assert!(client.vote(&admin1, &prop_id, &true));

		let prop_after_vote = client.get_proposal(&prop_id);
		assert_eq!(prop_after_vote.votes_for, 1);

		// admin2 executes the proposal (1 vote for > 0 against)
		assert!(client.execute_proposal(&admin2, &prop_id));

		let prop_executed = client.get_proposal(&prop_id);
		assert_eq!(prop_executed.status, ProposalStatus::Executed);

		// Verify effect: new_admin is now an admin
		assert!(client.is_admin(&new_admin));
	}

	#[test]
	#[should_panic(expected = "Already voted")]
	fn test_double_vote_panic() {
		let env = Env::default();
		env.mock_all_auths();
		let contract_id = env.register(GovernanceContract, ());
		let client = GovernanceContractClient::new(&env, &contract_id);

		let owner = Address::generate(&env);
		let admin = Address::generate(&env);
		let new_admin = Address::generate(&env);

		client.init(&owner);
		client.add_admin(&owner, &admin);

		let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(new_admin.clone()));

		client.vote(&admin, &prop_id, &true);
		// Should panic here
		client.vote(&admin, &prop_id, &true);
	}

	#[test]
	#[should_panic(expected = "Only admins can create proposals")]
	fn test_unauthorized_propose_panic() {
		let env = Env::default();
		env.mock_all_auths();
		let contract_id = env.register(GovernanceContract, ());
		let client = GovernanceContractClient::new(&env, &contract_id);

		let owner = Address::generate(&env);
		let rando = Address::generate(&env);
		let new_admin = Address::generate(&env);

		client.init(&owner);
		// rando is NOT an admin
		client.create_proposal(&rando, &ProposalType::AddAdmin(new_admin));
	}
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_add_and_check_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        assert!(client.init(&owner));

        let admin = Address::generate(&env);
        assert!(client.add_admin(&owner, &admin));
        assert!(client.is_admin(&admin));

        assert!(client.remove_admin(&owner, &admin));
        assert!(!client.is_admin(&admin));
    }

    #[test]
    fn test_proposal_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.init(&owner);
        client.add_admin(&owner, &admin1);
        client.add_admin(&owner, &admin2);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(new_admin.clone()));
        assert_eq!(prop_id, 1);

        let prop = client.get_proposal(&prop_id);
        assert_eq!(prop.status, ProposalStatus::Pending);
        assert_eq!(prop.votes_for, 0);

        assert!(client.vote(&admin1, &prop_id, &true));

        let prop_after_vote = client.get_proposal(&prop_id);
        assert_eq!(prop_after_vote.votes_for, 1);

        assert!(client.execute_proposal(&admin2, &prop_id));

        let prop_executed = client.get_proposal(&prop_id);
        assert_eq!(prop_executed.status, ProposalStatus::Executed);
        assert!(client.is_admin(&new_admin));
    }

    #[test]
    #[should_panic(expected = "Already voted")]
    fn test_double_vote_panic() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(target));
        client.vote(&admin, &prop_id, &true);
        client.vote(&admin, &prop_id, &true);
    }

    #[test]
    #[should_panic(expected = "Only admins can create proposals")]
    fn test_unauthorized_propose_panic() {
        let t = TestEnv::new();
        let client = t.client();
        let rando = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.create_proposal(&rando, &ProposalType::AddAdmin(target));
    }

    // -----------------------------------------------------------------------
    // Event: ProposalCreatedEvent
    // -----------------------------------------------------------------------

    #[test]
    fn test_event_proposal_created_emitted() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);

        t.env.ledger().set_timestamp(42);
        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(target.clone()));

        let all_events = t.env.events().all();
        let prop_new_sym: Symbol = symbol_short!("prop_new");
        let gov_sym: Symbol = symbol_short!("gov");

        let found = all_events.iter().any(|e| {
            let topics = e.0;
            topics.len() >= 2
                && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                && topics.get(1) == Some(prop_new_sym.clone().into_val(&t.env))
        });
        assert!(found, "prop_new event not found");

        let prop_event = all_events
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(prop_new_sym.clone().into_val(&t.env))
            })
            .expect("prop_new event missing");

        let data: ProposalCreatedEvent = prop_event.1.into_val(&t.env);
        assert_eq!(data.proposal_id, prop_id);
        assert_eq!(data.proposer, admin);
        assert_eq!(data.timestamp, 42);
    }

    #[test]
    fn test_event_proposal_created_increments_id() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        let t1 = Address::generate(&t.env);
        let t2 = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);

        let id1 = client.create_proposal(&admin, &ProposalType::AddAdmin(t1));
        let id2 = client.create_proposal(&admin, &ProposalType::AddAdmin(t2));
        assert_eq!(id1, 1);
        assert_eq!(id2, 2);

        let gov_sym: Symbol = symbol_short!("gov");
        let prop_new_sym: Symbol = symbol_short!("prop_new");
        let count = t.env
            .events()
            .all()
            .iter()
            .filter(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(prop_new_sym.clone().into_val(&t.env))
            })
            .count();
        assert_eq!(count, 2);
    }

    // -----------------------------------------------------------------------
    // Event: VoteCastEvent
    // -----------------------------------------------------------------------

    #[test]
    fn test_event_vote_cast_for() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(target));

        t.env.ledger().set_timestamp(100);
        client.vote(&admin, &prop_id, &true);

        let gov_sym: Symbol = symbol_short!("gov");
        let voted_sym: Symbol = symbol_short!("voted");

        let vote_event = t.env
            .events()
            .all()
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(voted_sym.clone().into_val(&t.env))
            })
            .expect("voted event missing");

        let data: VoteCastEvent = vote_event.1.into_val(&t.env);
        assert_eq!(data.proposal_id, prop_id);
        assert_eq!(data.voter, admin);
        assert!(data.support);
        assert_eq!(data.voting_power, 1);
        assert_eq!(data.timestamp, 100);
    }

    #[test]
    fn test_event_vote_cast_against() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(target));

        client.vote(&admin, &prop_id, &false);

        let gov_sym: Symbol = symbol_short!("gov");
        let voted_sym: Symbol = symbol_short!("voted");

        let vote_event = t.env
            .events()
            .all()
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(voted_sym.clone().into_val(&t.env))
            })
            .expect("voted event missing");

        let data: VoteCastEvent = vote_event.1.into_val(&t.env);
        assert!(!data.support);
        assert_eq!(data.voting_power, 1);
    }

    #[test]
    fn test_event_multiple_votes_emitted() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);
        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(target));

        client.vote(&admin1, &prop_id, &true);
        client.vote(&admin2, &prop_id, &false);

        let gov_sym: Symbol = symbol_short!("gov");
        let voted_sym: Symbol = symbol_short!("voted");

        let count = t.env
            .events()
            .all()
            .iter()
            .filter(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(voted_sym.clone().into_val(&t.env))
            })
            .count();
        assert_eq!(count, 2);
    }

    // -----------------------------------------------------------------------
    // Event: ProposalExecutedEvent – executed path
    // -----------------------------------------------------------------------

    #[test]
    fn test_event_proposal_executed_success() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);
        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(target));
        client.vote(&admin1, &prop_id, &true);

        t.env.ledger().set_timestamp(200);
        client.execute_proposal(&admin2, &prop_id);

        let gov_sym: Symbol = symbol_short!("gov");
        let exec_sym: Symbol = symbol_short!("prop_exec");

        let exec_event = t.env
            .events()
            .all()
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(exec_sym.clone().into_val(&t.env))
            })
            .expect("prop_exec event missing");

        let data: ProposalExecutedEvent = exec_event.1.into_val(&t.env);
        assert_eq!(data.proposal_id, prop_id);
        assert_eq!(data.executor, admin2);
        assert_eq!(data.result, ProposalStatus::Executed as u32);
        assert_eq!(data.votes_for, 1);
        assert_eq!(data.votes_against, 0);
        assert_eq!(data.timestamp, 200);
    }

    // -----------------------------------------------------------------------
    // Event: ProposalExecutedEvent – rejected path
    // -----------------------------------------------------------------------

    #[test]
    fn test_event_proposal_rejected() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);
        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(target));
        client.vote(&admin1, &prop_id, &false);
        client.execute_proposal(&admin2, &prop_id);

        let gov_sym: Symbol = symbol_short!("gov");
        let exec_sym: Symbol = symbol_short!("prop_exec");

        let exec_event = t.env
            .events()
            .all()
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(exec_sym.clone().into_val(&t.env))
            })
            .expect("prop_exec event missing");

        let data: ProposalExecutedEvent = exec_event.1.into_val(&t.env);
        assert_eq!(data.result, ProposalStatus::Rejected as u32);
        assert_eq!(data.votes_for, 0);
        assert_eq!(data.votes_against, 1);
    }

    #[test]
    fn test_event_proposal_rejected_no_votes() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);
        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(target));
        client.execute_proposal(&admin2, &prop_id);

        let gov_sym: Symbol = symbol_short!("gov");
        let exec_sym: Symbol = symbol_short!("prop_exec");

        let exec_event = t.env
            .events()
            .all()
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(exec_sym.clone().into_val(&t.env))
            })
            .expect("prop_exec event missing");

        let data: ProposalExecutedEvent = exec_event.1.into_val(&t.env);
        assert_eq!(data.result, ProposalStatus::Rejected as u32);
        assert_eq!(data.votes_for, 0);
        assert_eq!(data.votes_against, 0);
    }

    // -----------------------------------------------------------------------
    // Event: AdminAddedEvent / AdminRemovedEvent via direct owner calls
    // -----------------------------------------------------------------------

    #[test]
    fn test_event_admin_added_direct() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        t.env.ledger().set_timestamp(77);
        client.add_admin(&t.owner, &admin);

        let gov_sym: Symbol = symbol_short!("gov");
        let adm_add_sym: Symbol = symbol_short!("adm_add");

        let evt = t.env
            .events()
            .all()
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(adm_add_sym.clone().into_val(&t.env))
            })
            .expect("adm_add event missing");

        let data: AdminAddedEvent = evt.1.into_val(&t.env);
        assert_eq!(data.admin, admin);
        assert_eq!(data.added_by, t.owner);
        assert_eq!(data.timestamp, 77);
    }

    #[test]
    fn test_event_admin_removed_direct() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        t.env.ledger().set_timestamp(88);
        client.remove_admin(&t.owner, &admin);

        let gov_sym: Symbol = symbol_short!("gov");
        let adm_rem_sym: Symbol = symbol_short!("adm_rem");

        let evt = t.env
            .events()
            .all()
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(adm_rem_sym.clone().into_val(&t.env))
            })
            .expect("adm_rem event missing");

        let data: AdminRemovedEvent = evt.1.into_val(&t.env);
        assert_eq!(data.admin, admin);
        assert_eq!(data.removed_by, t.owner);
        assert_eq!(data.timestamp, 88);
    }

    // -----------------------------------------------------------------------
    // Event: AdminAddedEvent / AdminRemovedEvent via proposal execution
    // -----------------------------------------------------------------------

    #[test]
    fn test_event_admin_added_via_proposal() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        let new_admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(new_admin.clone()));
        client.vote(&admin, &prop_id, &true);
        client.execute_proposal(&admin, &prop_id);

        let gov_sym: Symbol = symbol_short!("gov");
        let adm_add_sym: Symbol = symbol_short!("adm_add");

        // Two adm_add events: one from add_admin, one from execute_proposal
        let count = t.env
            .events()
            .all()
            .iter()
            .filter(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(adm_add_sym.clone().into_val(&t.env))
            })
            .count();
        assert_eq!(count, 2);

        // The last adm_add event should be for new_admin
        let last_evt = t.env
            .events()
            .all()
            .iter()
            .filter(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(adm_add_sym.clone().into_val(&t.env))
            })
            .last()
            .unwrap();
        let data: AdminAddedEvent = last_evt.1.into_val(&t.env);
        assert_eq!(data.admin, new_admin);
        assert_eq!(data.added_by, admin);
    }

    #[test]
    fn test_event_admin_removed_via_proposal() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);

        let prop_id = client.create_proposal(&admin1, &ProposalType::RemoveAdmin(admin2.clone()));
        client.vote(&admin1, &prop_id, &true);
        client.execute_proposal(&admin1, &prop_id);

        assert!(!client.is_admin(&admin2));

        let gov_sym: Symbol = symbol_short!("gov");
        let adm_rem_sym: Symbol = symbol_short!("adm_rem");

        let evt = t.env
            .events()
            .all()
            .iter()
            .find(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(adm_rem_sym.clone().into_val(&t.env))
            })
            .expect("adm_rem event missing");

        let data: AdminRemovedEvent = evt.1.into_val(&t.env);
        assert_eq!(data.admin, admin2);
        assert_eq!(data.removed_by, admin1);
    }

    // -----------------------------------------------------------------------
    // No spurious events on error paths
    // -----------------------------------------------------------------------

    /// Verify that a successful single vote emits exactly one `voted` event,
    /// confirming no phantom emissions occur on the happy path.
    #[test]
    fn test_exactly_one_vote_event_per_cast() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(target));
        client.vote(&admin, &prop_id, &true);

        let gov_sym: Symbol = symbol_short!("gov");
        let voted_sym: Symbol = symbol_short!("voted");
        let count = t.env
            .events()
            .all()
            .iter()
            .filter(|e| {
                let topics = e.0.clone();
                topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                    && topics.get(1) == Some(voted_sym.clone().into_val(&t.env))
            })
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    #[should_panic(expected = "Already voted")]
    fn test_double_vote_no_second_event() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(target));
        client.vote(&admin, &prop_id, &true);
        client.vote(&admin, &prop_id, &true);
    }

    // -----------------------------------------------------------------------
    // Integration: full proposal round-trip with event ordering
    // -----------------------------------------------------------------------

    #[test]
    fn test_full_round_trip_event_ordering() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        let new_admin = Address::generate(&t.env);

        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(new_admin.clone()));
        client.vote(&admin1, &prop_id, &true);
        client.vote(&admin2, &prop_id, &true);
        client.execute_proposal(&admin1, &prop_id);

        let gov_sym: Symbol = symbol_short!("gov");
        let all = t.env.events().all();

        // Collect second-topic symbols for all gov events, in emission order
        let topic1s: soroban_sdk::Vec<Symbol> = all
            .iter()
            .filter_map(|e| {
                let topics = e.0.clone();
                if topics.len() >= 2
                    && topics.get(0) == Some(gov_sym.clone().into_val(&t.env))
                {
                    topics.get(1).map(|v| v.into_val(&t.env))
                } else {
                    None
                }
            })
            .collect();

        // Expected: adm_add, adm_add, prop_new, voted, voted, adm_add (exec), prop_exec
        assert_eq!(topic1s.len(), 7);
        assert_eq!(topic1s.get(0).unwrap(), symbol_short!("adm_add"));
        assert_eq!(topic1s.get(1).unwrap(), symbol_short!("adm_add"));
        assert_eq!(topic1s.get(2).unwrap(), symbol_short!("prop_new"));
        assert_eq!(topic1s.get(3).unwrap(), symbol_short!("voted"));
        assert_eq!(topic1s.get(4).unwrap(), symbol_short!("voted"));
        assert_eq!(topic1s.get(5).unwrap(), symbol_short!("adm_add"));
        assert_eq!(topic1s.get(6).unwrap(), symbol_short!("prop_exec"));
    #[should_panic(expected = "No voting power available")]
    fn test_double_vote_panic() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.init(&owner);
        client.add_admin(&owner, &admin);

        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(new_admin.clone()));
        client.vote(&admin, &prop_id, &true);
        client.vote(&admin, &prop_id, &true);
    }

    #[test]
    #[should_panic(expected = "Only admins can create proposals")]
    fn test_unauthorized_propose_panic() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let rando = Address::generate(&env);
        let new_admin = Address::generate(&env);

        client.init(&owner);
        client.create_proposal(&rando, &ProposalType::AddAdmin(new_admin));
    }

    #[test]
    fn test_delegated_vote_counts_weight() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);
        let candidate = Address::generate(&env);

        client.init(&owner);
        client.add_admin(&owner, &admin1);
        client.add_admin(&owner, &admin2);
        client.add_admin(&owner, &admin3);

        assert!(client.delegate_vote(&admin2, &admin1));
        assert!(client.delegate_vote(&admin3, &admin1));

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(candidate.clone()));
        assert!(client.vote(&admin1, &prop_id, &true));

        let proposal = client.get_proposal(&prop_id);
        assert_eq!(proposal.votes_for, 3);
    }

    #[test]
    #[should_panic(expected = "Delegated admins cannot vote directly")]
    fn test_delegator_cannot_vote_directly() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let candidate = Address::generate(&env);

        client.init(&owner);
        client.add_admin(&owner, &admin1);
        client.add_admin(&owner, &admin2);
        client.delegate_vote(&admin2, &admin1);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(candidate));
        client.vote(&admin2, &prop_id, &true);
    }

    #[test]
    #[should_panic(expected = "Delegation cycle not allowed")]
    fn test_delegation_cycle_blocked() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);

        client.init(&owner);
        client.add_admin(&owner, &admin1);
        client.add_admin(&owner, &admin2);

        client.delegate_vote(&admin1, &admin2);
        client.delegate_vote(&admin2, &admin1);
    }

    #[test]
    fn test_clear_delegate_restores_direct_vote() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(GovernanceContract, ());
        let client = GovernanceContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let candidate = Address::generate(&env);

        client.init(&owner);
        client.add_admin(&owner, &admin1);
        client.add_admin(&owner, &admin2);
        client.delegate_vote(&admin2, &admin1);
        client.clear_delegate(&admin2);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(candidate));
        assert!(client.vote(&admin2, &prop_id, &false));

        let proposal = client.get_proposal(&prop_id);
        assert_eq!(proposal.votes_against, 1);
    }
}
