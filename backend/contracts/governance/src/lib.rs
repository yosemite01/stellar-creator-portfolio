#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol};

/// Governance Configuration
#[contracttype]
pub struct GovernanceConfig {
    pub platform_fee_percent: u32, // 0-1000 represents 0-10% (fixed point)
    pub min_bounty_budget: i128,
    pub max_bounty_budget: i128,
    pub dispute_resolution_period: u64, // in seconds
    pub admin_address: Address,
    pub last_updated: u64,
}

/// Proposal
#[contracttype]
pub struct Proposal {
    pub id: u64,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub yes_votes: u64,
    pub no_votes: u64,
    pub status: String, // "pending", "approved", "rejected", "executed"
    pub created_at: u64,
    pub voting_deadline: u64,
}

#[contract]
pub trait GovernanceContractTrait {
    /// Get current governance config
    fn get_config(env: Env) -> GovernanceConfig;

    /// Update platform fee (admin only)
    fn set_platform_fee(
        env: Env,
        admin: Address,
        fee_percent: u32,
    ) -> bool;

    /// Update bounty budget limits (admin only)
    fn set_bounty_limits(
        env: Env,
        admin: Address,
        min_budget: i128,
        max_budget: i128,
    ) -> bool;

    /// Create governance proposal
    fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        voting_period: u64,
    ) -> u64;

    /// Vote on proposal
    fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_yes: bool,
    ) -> bool;

    /// Get proposal details
    fn get_proposal(env: Env, proposal_id: u64) -> Proposal;

    /// Execute approved proposal
    fn execute_proposal(env: Env, proposal_id: u64) -> bool;
}

#[contractimpl]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContractTrait for GovernanceContract {
    fn get_config(env: Env) -> GovernanceConfig {
        let config_key = Symbol::new(&env, "governance_config");
        env.storage()
            .persistent()
            .get::<Symbol, GovernanceConfig>(&config_key)
            .unwrap_or_else(|| {
                // Default configuration
                GovernanceConfig {
                    platform_fee_percent: 50, // 5%
                    min_bounty_budget: 100,
                    max_bounty_budget: 1_000_000,
                    dispute_resolution_period: 7 * 24 * 3600, // 7 days
                    admin_address: Address::random(&env),
                    last_updated: 0,
                }
            })
    }

    fn set_platform_fee(
        env: Env,
        admin: Address,
        fee_percent: u32,
    ) -> bool {
        admin.require_auth();

        let config_key = Symbol::new(&env, "governance_config");
        let mut config = Self::get_config(env.clone());

        assert_eq!(admin, config.admin_address, "Only admin can update fee");
        assert!(fee_percent <= 1000, "Fee cannot exceed 10%");

        config.platform_fee_percent = fee_percent;
        config.last_updated = env.ledger().timestamp();

        env.storage().persistent().set(&config_key, &config);

        true
    }

    fn set_bounty_limits(
        env: Env,
        admin: Address,
        min_budget: i128,
        max_budget: i128,
    ) -> bool {
        admin.require_auth();

        let config_key = Symbol::new(&env, "governance_config");
        let mut config = Self::get_config(env.clone());

        assert_eq!(admin, config.admin_address, "Only admin can update limits");
        assert!(min_budget > 0, "Min budget must be positive");
        assert!(max_budget > min_budget, "Max budget must be greater than min");

        config.min_bounty_budget = min_budget;
        config.max_bounty_budget = max_budget;
        config.last_updated = env.ledger().timestamp();

        env.storage().persistent().set(&config_key, &config);

        true
    }

    fn create_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        voting_period: u64,
    ) -> u64 {
        proposer.require_auth();

        let proposal_counter_key = Symbol::new(&env, "proposal_counter");
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&proposal_counter_key)
            .unwrap_or(0);

        counter += 1;
        let proposal_id = counter;

        let proposal = Proposal {
            id: proposal_id,
            proposer,
            title,
            description,
            yes_votes: 0,
            no_votes: 0,
            status: String::from_slice(&env, "pending"),
            created_at: env.ledger().timestamp(),
            voting_deadline: env.ledger().timestamp() + voting_period,
        };

        let proposal_key = Symbol::new(&env, &format!("proposal_{}", proposal_id));
        env.storage().persistent().set(&proposal_key, &proposal);
        env.storage()
            .persistent()
            .set(&proposal_counter_key, &counter);

        proposal_id
    }

    fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_yes: bool,
    ) -> bool {
        voter.require_auth();

        let proposal_key = Symbol::new(&env, &format!("proposal_{}", proposal_id));
        let mut proposal = env
            .storage()
            .persistent()
            .get::<Symbol, Proposal>(&proposal_key)
            .expect("Proposal not found");

        assert_eq!(proposal.status.as_slice(), b"pending", "Proposal not pending");
        assert!(
            env.ledger().timestamp() < proposal.voting_deadline,
            "Voting period has ended"
        );

        // Check if voter already voted (simplified - in reality use a mapping)
        let vote_key = Symbol::new(
            &env,
            &format!("vote_{}_{}", proposal_id, voter),
        );
        assert!(
            !env.storage().persistent().has(&vote_key),
            "Already voted"
        );

        if vote_yes {
            proposal.yes_votes += 1;
        } else {
            proposal.no_votes += 1;
        }

        env.storage().persistent().set(&proposal_key, &proposal);
        env.storage().persistent().set(&vote_key, &true);

        true
    }

    fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        let proposal_key = Symbol::new(&env, &format!("proposal_{}", proposal_id));
        env.storage()
            .persistent()
            .get::<Symbol, Proposal>(&proposal_key)
            .expect("Proposal not found")
    }

    fn execute_proposal(env: Env, proposal_id: u64) -> bool {
        let proposal_key = Symbol::new(&env, &format!("proposal_{}", proposal_id));
        let mut proposal = env
            .storage()
            .persistent()
            .get::<Symbol, Proposal>(&proposal_key)
            .expect("Proposal not found");

        assert!(
            env.ledger().timestamp() >= proposal.voting_deadline,
            "Voting still in progress"
        );
        assert_eq!(proposal.status.as_slice(), b"pending", "Proposal not pending");

        if proposal.yes_votes > proposal.no_votes {
            proposal.status = String::from_slice(&env, "approved");
        } else {
            proposal.status = String::from_slice(&env, "rejected");
        }

        env.storage().persistent().set(&proposal_key, &proposal);

        true
    }
}
