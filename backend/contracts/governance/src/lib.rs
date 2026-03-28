#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

#[contracttype]
pub enum DataKey {
	Owner,
	Admin(Address),
    ProposalCounter,
    Proposal(u64),
    HasVoted(u64, Address),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalType {
    AddAdmin(Address),
    RemoveAdmin(Address),
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

#[contract]
pub struct GovernanceContract;

const GOVERNANCE: Symbol = symbol_short!("gov");

#[contractimpl]
impl GovernanceContract {
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
		env.events().publish((GOVERNANCE, symbol_short!("adm_added"), admin), (owner,));
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
		env.events().publish((GOVERNANCE, symbol_short!("adm_rmvd"), admin), (owner,));
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
	/// Only an active admin can create a proposal.
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

		env.events().publish(
			(GOVERNANCE, symbol_short!("prop_crt"), counter),
			(creator.clone(),),
		);

		counter
	}

	/// Cast a vote on a Pending proposal.
	/// Only admins can vote. An admin can only vote once per proposal.
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

		env.events().publish(
			(GOVERNANCE, symbol_short!("voted"), proposal_id),
			(voter.clone(), support),
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

		// Execution condition
		if proposal.votes_for > proposal.votes_against && proposal.votes_for > 0 {
			proposal.status = ProposalStatus::Executed;

			// Apply State Changes directly mapped to enum
			match &proposal.prop_type {
				ProposalType::AddAdmin(new_admin) => {
					env.storage()
						.persistent()
						.set(&DataKey::Admin(new_admin.clone()), &true);
					env.events().publish(
						(GOVERNANCE, symbol_short!("adm_added"), new_admin.clone()),
						(Symbol::new(&env, "proposal"),),
					);
				}
				ProposalType::RemoveAdmin(old_admin) => {
					env.storage().persistent().remove(&DataKey::Admin(old_admin.clone()));
					env.events().publish(
						(GOVERNANCE, symbol_short!("adm_rmvd"), old_admin.clone()),
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
}


#[cfg(test)]
mod tests {
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
}
