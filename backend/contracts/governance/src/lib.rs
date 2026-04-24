#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, IntoVal, Symbol, Vec};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
pub enum DataKey {
    Owner,
    PendingOwner,
    Admin(Address),
    AdminList,
    Delegate(Address),
    ProposalCounter,
    Proposal(u64),
    HasVoted(u64, Address),
    PlatformFee,
    Parameter(Symbol),
    TimelockDelay,
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
    Queued = 3,
    Cancelled = 3,
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
    /// Timestamp after which a Queued proposal may be executed.
    /// Set to 0 for proposals that have not yet passed voting.
    pub executable_after: u64,
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
// INV-7: execute_proposal uses a two-phase mechanism. First call (Pending→Queued)
//        records executable_after = now + timelock_delay. Second call (Queued→Executed)
//        verifies the current timestamp exceeds executable_after before applying changes.
// =============================================================================

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

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct FeeChangedEvent {
    pub new_fee: u32,
    pub caller: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ParameterUpdatedEvent {
    pub parameter: Symbol,
    pub new_value: u32,
    pub caller: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ProposalQueuedEvent {
    pub proposal_id: u64,
    pub executable_after: u64,
    pub queued_by: Address,
}

const GOVERNANCE: Symbol = symbol_short!("GOV");
/// Default timelock delay (24 hours in seconds). Used when no custom delay is set.
const DEFAULT_TIMELOCK_DELAY: u64 = 86_400;
pub struct ProposalCancelledEvent {
    pub proposal_id: u64,
    pub cancelled_by: Address,
    pub timestamp: u64,
}

const GOVERNANCE: Symbol = symbol_short!("GOV");
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

    /// Returns a stored governance parameter value, if configured.
    pub fn get_parameter(env: Env, parameter: Symbol) -> Option<u32> {
        env.storage()
            .persistent()
            .get(&DataKey::Parameter(parameter))
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
            executable_after: 0,
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

    /// Executes or queues a proposal with mandatory timelock enforcement (Issue #198).
    ///
    /// **Two-phase mechanism:**
    /// - **Phase 1 (Pending → Queued):** If `votes_for > votes_against && votes_for > 0`,
    ///   the proposal is moved to `Queued` status and `executable_after` is set to
    ///   `now + timelock_delay`. If votes do not pass, the proposal is immediately Rejected.
    /// - **Phase 2 (Queued → Executed):** Once the timelock has elapsed, a second call
    ///   applies the state change and marks the proposal Executed.
    ///
    /// This gives stakeholders time to react to approved changes before they take effect.
    pub fn execute_proposal(env: Env, caller: Address, proposal_id: u64) -> bool {
        caller.require_auth();
        let key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Proposal not found");

        let now = env.ledger().timestamp();

        if proposal.status == ProposalStatus::Pending {
            // Phase 1: determine outcome and either queue or reject
            if proposal.votes_for > proposal.votes_against && proposal.votes_for > 0 {
                let delay: u64 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TimelockDelay)
                    .unwrap_or(DEFAULT_TIMELOCK_DELAY);

                proposal.executable_after = now + delay;
                proposal.status = ProposalStatus::Queued;
                env.storage().persistent().set(&key, &proposal);

                env.events().publish(
                    (GOVERNANCE, symbol_short!("prop_que"), proposal_id),
                    (caller, proposal.executable_after),
                );
            } else {
                proposal.status = ProposalStatus::Rejected;
                env.storage().persistent().set(&key, &proposal);

                env.events().publish(
                    (GOVERNANCE, symbol_short!("prop_rej"), proposal_id),
                    (proposal.votes_for, proposal.votes_against),
                );
            }
            return true;
        }
        let mut proposal: Proposal = env.storage().persistent().get(&key).expect("Not found");

        if proposal.status == ProposalStatus::Queued {
            // Phase 2: enforce timelock and execute
            if now < proposal.executable_after {
                panic!("Timelock period has not elapsed");
            }

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
                ProposalType::FeeChange(new_fee) => {
                    let max_fee: u32 = env
                        .storage()
                        .persistent()
                        .get(&DataKey::Parameter(Symbol::new(&env, "max_fee")))
                        .unwrap_or(1000); // default cap: 10%
                    assert!(*new_fee <= max_fee, "Fee exceeds maximum allowed");
                    env.storage()
                        .persistent()
                        .set(&DataKey::PlatformFee, &new_fee);
                    env.events().publish(
                        (GOVERNANCE, symbol_short!("fee_chg"), *new_fee),
                        (caller.clone(),),
                    );
                }
                ProposalType::ParameterUpdate(param, value) => {
                    env.storage()
                        .persistent()
                        .set(&DataKey::Parameter(param.clone()), &value);
                    env.events().publish(
                        (GOVERNANCE, symbol_short!("param_upd"), param.clone()),
                        (*value, caller.clone()),
                    );
                }
                ProposalType::AddAdmin(new_admin) => Self::add_admin_internal(env.clone(), new_admin.clone()),
                ProposalType::RemoveAdmin(old_admin) => Self::remove_admin_internal(env.clone(), old_admin.clone()),
                ProposalType::FeeChange(new_fee) => env.storage().persistent().set(&DataKey::PlatformFee, &new_fee),
                ProposalType::ParameterUpdate(param, value) => env.storage().persistent().set(&DataKey::Parameter(param.clone()), &value),
            }

            env.storage().persistent().set(&key, &proposal);
            env.events().publish(
                (GOVERNANCE, symbol_short!("prop_exec"), proposal_id),
                (caller,),
            );

            return true;
        }

        panic!("Proposal is not in a executable state");
    }

    /// Sets the timelock delay (in seconds) that governs how long approved
    /// proposals must wait before they can be executed. Only the owner may call this.
    pub fn set_timelock_delay(env: Env, owner: Address, delay_seconds: u64) -> bool {
        owner.require_auth();
        let stored_owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Owner)
            .expect("Governance not initialized");
        if stored_owner != owner {
            panic!("Only owner can set timelock delay");
        }

        env.storage()
            .persistent()
            .set(&DataKey::TimelockDelay, &delay_seconds);

        env.events().publish(
            (GOVERNANCE, symbol_short!("tl_set"), delay_seconds),
            (owner,),
            (GOV, symbol_short!("prop_exc")),
            (proposal_id, caller, (proposal.status as u32), proposal.votes_for, proposal.votes_against, env.ledger().timestamp()),
        );
        true
    }

    /// Returns the currently configured timelock delay in seconds.
    pub fn get_timelock_delay(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::TimelockDelay)
            .unwrap_or(DEFAULT_TIMELOCK_DELAY)
    }

    /// Retrieves the full details of a proposal by ID.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        env.storage().persistent().get(&DataKey::Proposal(proposal_id)).expect("Not found")
    }

    /// Returns the current platform fee in basis points (e.g. 500 = 5%).
    pub fn get_fee(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PlatformFee)
            .unwrap_or(0)
    }

    /// Step 1: Current owner nominates a new owner.
    /// The transfer is not effective until the pending owner calls `accept_ownership`.
    pub fn transfer_ownership(env: Env, owner: Address, new_owner: Address) -> bool {
        owner.require_auth();
        let stored_owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Owner)
            .expect("Governance not initialized");
        assert!(owner == stored_owner, "Only owner can transfer ownership");
        env.storage()
            .persistent()
            .set(&DataKey::PendingOwner, &new_owner);
        true
    }

    /// Step 2: Pending owner accepts and becomes the new owner.
    pub fn accept_ownership(env: Env, new_owner: Address) -> bool {
        new_owner.require_auth();
        let pending: Address = env
            .storage()
            .persistent()
            .get(&DataKey::PendingOwner)
            .expect("No pending owner");
        assert!(new_owner == pending, "Caller is not the pending owner");
        env.storage()
            .persistent()
            .set(&DataKey::Owner, &new_owner);
        env.storage()
            .persistent()
            .remove(&DataKey::PendingOwner);
        true
    }

    // -------------------------------------------------------------------------
    // Issue #196 — Proposal cancellation
    // -------------------------------------------------------------------------

    /// Cancels a Pending proposal before it is executed.
    ///
    /// Only the original proposer may cancel their own proposal.
    /// Cancelled proposals cannot be voted on or executed.
    pub fn cancel_proposal(env: Env, caller: Address, proposal_id: u64) -> bool {
        caller.require_auth();

        let key = DataKey::Proposal(proposal_id);
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Proposal not found");

        if proposal.status != ProposalStatus::Pending {
            panic!("Only Pending proposals can be cancelled");
        }

        if proposal.creator != caller {
            panic!("Only the proposer can cancel their proposal");
        }

        proposal.status = ProposalStatus::Cancelled;
        env.storage().persistent().set(&key, &proposal);

        env.events().publish(
            (GOVERNANCE, symbol_short!("prop_cxl"), proposal_id),
            (caller, env.ledger().timestamp()),
        );

        true
    }

    fn add_admin_internal(env: Env, admin: Address) {
        if Self::is_admin(env.clone(), admin.clone()) {
            return;
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

        fn client(&self) -> GovernanceContractClient<'_> {
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

    // -----------------------------------------------------------------------
    // Proposal lifecycle (with timelock)
    // -----------------------------------------------------------------------

    #[test]
    fn test_proposal_lifecycle_with_timelock() {
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

        // Set zero timelock to simplify test
        client.set_timelock_delay(&t.owner, &0u64);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(new_admin.clone()));
        assert_eq!(prop_id, 1);
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Pending);
        let freelancer_id = t.env.register(MockFreelancer, ());
        client.set_freelancer_contract(&t.owner, &freelancer_id);

        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(Address::generate(&t.env)));
        client.vote(&admin, &prop_id, &true);

        // Phase 1: queue the proposal
        assert!(client.execute_proposal(&admin2, &prop_id));
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Queued);
        assert!(!client.is_admin(&new_admin)); // not yet applied

        // Phase 2: execute after timelock (delay=0, so immediately eligible)
        assert!(client.execute_proposal(&admin2, &prop_id));
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Executed);
        assert!(client.is_admin(&new_admin));
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
        let admin = Address::generate(&t.env);
        let target = Address::generate(&t.env);
        let gov_sym = symbol_short!("GOV");

        client.add_admin(&t.owner, &admin);
        client.set_timelock_delay(&t.owner, &0u64);

        // 1. Proposal Created
        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(target.clone()));
        let events = t.env.events().all();
        assert!(verify_gov_event(
            &t.env,
            &gov_sym,
            &symbol_short!("prop_new"),
            &events
        ));

        // 2. Vote Cast
        client.vote(&admin, &prop_id, &true);
        let events = t.env.events().all();
        assert!(verify_gov_event(
            &t.env,
            &gov_sym,
            &symbol_short!("voted"),
            &events
        ));

        // 3. Queue (Phase 1)
        client.execute_proposal(&admin, &prop_id);
        let events = t.env.events().all();
        assert!(verify_gov_event(&t.env, &gov_sym, &symbol_short!("prop_que"), &events));

        // 4. Execute (Phase 2) — emits prop_exec
        client.execute_proposal(&admin, &prop_id);
        let events = t.env.events().all();
        assert!(verify_gov_event(&t.env, &gov_sym, &symbol_short!("prop_exec"), &events));
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

    // -----------------------------------------------------------------------
    // Issue #196 — Proposal cancellation
    // -----------------------------------------------------------------------

    #[test]
    fn test_cancel_proposal_by_proposer() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);

        let prop_id = client.create_proposal(&admin, &ProposalType::AddAdmin(Address::generate(&t.env)));
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Pending);

        assert!(client.cancel_proposal(&admin, &prop_id));
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Cancelled);
    }

    // test_delegation_with_timelock is defined below in the typed proposals section

    #[test]
    #[should_panic(expected = "Only the proposer can cancel their proposal")]
    fn test_cancel_proposal_by_non_proposer_panics() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(Address::generate(&t.env)));
        // admin2 tries to cancel admin1's proposal
        client.cancel_proposal(&admin2, &prop_id);
    }

    #[test]
    #[should_panic(expected = "Only Pending proposals can be cancelled")]
    fn test_cancel_executed_proposal_panics() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        client.set_timelock_delay(&t.owner, &0u64);

        // Fee Change — two-phase with zero timelock
        let prop_id = client.create_proposal(&admin, &ProposalType::FeeChange(500));
        client.vote(&admin, &prop_id, &true);
        client.execute_proposal(&admin, &prop_id); // queue
        client.execute_proposal(&admin, &prop_id); // execute
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Executed);

        // Parameter Update
        let param = symbol_short!("limit");
        let prop_id2 =
            client.create_proposal(&admin, &ProposalType::ParameterUpdate(param.clone(), 100));
        client.vote(&admin, &prop_id2, &true);
        client.execute_proposal(&admin, &prop_id2); // queue
        client.execute_proposal(&admin, &prop_id2); // execute
        assert_eq!(client.get_proposal(&prop_id2).status, ProposalStatus::Executed);
    }

    #[test]
    fn test_delegation_with_timelock() {
        let t = TestEnv::new();
        let client = t.client();

        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        let candidate = Address::generate(&t.env);

        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);
        client.set_timelock_delay(&t.owner, &0u64);

        client.delegate_vote(&admin2, &admin1);

        let prop_id = client.create_proposal(&admin1, &ProposalType::AddAdmin(candidate.clone()));
        client.vote(&admin1, &prop_id, &true);

        let proposal = client.get_proposal(&prop_id);
        assert_eq!(proposal.votes_for, 2);

        client.execute_proposal(&admin1, &prop_id); // queue
        client.execute_proposal(&admin1, &prop_id); // execute
        assert!(client.is_admin(&candidate));
    }

    // -----------------------------------------------------------------------
    // Issue #198 — Timelock tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_timelock_default_delay() {
        let t = TestEnv::new();
        let client = t.client();
        assert_eq!(client.get_timelock_delay(), 86_400u64);
    }

    #[test]
    fn test_set_timelock_delay() {
        let t = TestEnv::new();
        let client = t.client();
        client.set_timelock_delay(&t.owner, &3600u64);
        assert_eq!(client.get_timelock_delay(), 3600u64);
    }

    #[test]
    #[should_panic(expected = "Only owner can set timelock delay")]
    fn test_set_timelock_delay_non_owner_panics() {
        let t = TestEnv::new();
        let client = t.client();
        let rando = Address::generate(&t.env);
        client.set_timelock_delay(&rando, &0u64);
    }

    #[test]
    fn test_rejected_proposal_skips_timelock() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        // Leave default 24h timelock — rejected proposals skip it

        let prop_id = client.create_proposal(&admin, &ProposalType::FeeChange(100));
        // Vote against — proposal should be immediately Rejected on first execute call
        client.vote(&admin, &prop_id, &false);
        client.execute_proposal(&admin, &prop_id);
        assert_eq!(client.get_proposal(&prop_id).status, ProposalStatus::Rejected);
    }

    #[test]
    #[should_panic(expected = "Timelock period has not elapsed")]
    fn test_execute_before_timelock_panics() {
        let t = TestEnv::new();
        let client = t.client();
        let admin = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin);
        // Set a non-zero timelock
        client.set_timelock_delay(&t.owner, &3600u64);

        let prop_id = client.create_proposal(&admin, &ProposalType::FeeChange(200));
        client.vote(&admin, &prop_id, &true);
        client.execute_proposal(&admin, &prop_id); // queue (now + 3600s)
        // Try to execute immediately — should panic because timelock hasn't elapsed
        client.execute_proposal(&admin, &prop_id);
    }
}
        let prop_id = client.create_proposal(&admin, &ProposalType::FeeChange(100));
        client.vote(&admin, &prop_id, &true);
        client.execute_proposal(&admin, &prop_id);
        // Attempt to cancel after execution
        client.cancel_proposal(&admin, &prop_id);
    }

    #[test]
    #[should_panic]
    fn test_vote_on_cancelled_proposal_panics() {
        let t = TestEnv::new();
        let client = t.client();
        let admin1 = Address::generate(&t.env);
        let admin2 = Address::generate(&t.env);
        client.add_admin(&t.owner, &admin1);
        client.add_admin(&t.owner, &admin2);

        let prop_id = client.create_proposal(&admin1, &ProposalType::FeeChange(200));
        client.cancel_proposal(&admin1, &prop_id);
        // Voting on a cancelled proposal should panic
        client.vote(&admin2, &prop_id, &true);
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
