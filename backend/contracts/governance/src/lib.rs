#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Symbol};

const DEFAULT_TIMELOCK_SECONDS: u64 = 48 * 60 * 60; // 48 hours

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

// ── Issue #632: DAO Governance extensions ────────────────────────────────────

/// Weighted vote cast by a token holder.
///
/// `weight` is the voter's token balance at vote time, expressed in the
/// token's smallest denomination.  Callers supply this value; a production
/// deployment would read it from an on-chain token contract.
#[contracttype]
pub struct TokenVote {
    pub proposal_id: u64,
    pub voter: Address,
    pub weight: u64,
    pub vote_yes: bool,
}

/// Execution timelock for an approved proposal.
///
/// An approved proposal must wait `unlock_at` (ledger timestamp) before
/// `execute_timelocked` can be called.  This guards against flash-loan
/// or rushed governance attacks.
#[contracttype]
pub struct ExecutionTimelock {
    pub proposal_id: u64,
    pub unlock_at: u64,
}

/// Optional on-chain parameter change attached to a proposal.
///
/// When a proposal carries a `ProposalParam`, `execute_timelocked` applies
/// the change directly to the governance config, creating a fully on-chain
/// parameter-update flow without requiring a separate admin transaction.
#[contracttype]
pub struct ProposalParam {
    /// New platform fee in basis points (None = no change).
    pub target_fee_bps: Option<u32>,
    /// New minimum bounty budget (None = no change).
    pub target_min_budget: Option<i128>,
    /// New maximum bounty budget (None = no change).
    pub target_max_budget: Option<i128>,
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn get_config(env: Env) -> GovernanceConfig {
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
                    admin_address: env.current_contract_address(),
                    last_updated: 0,
                }
            })
    }

    pub fn set_platform_fee(
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

        // Extend TTL for config storage (30 days in ledgers)
        let ledger_ttl = 30 * 24 * 3600 / 5; // ~30 days (5 second blocks)
        env.storage().persistent().extend_ttl(&config_key, 4096, ledger_ttl);

        true
    }

    pub fn set_bounty_limits(
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

        // Extend TTL for config storage (30 days in ledgers)
        let ledger_ttl = 30 * 24 * 3600 / 5; // ~30 days (5 second blocks)
        env.storage().persistent().extend_ttl(&config_key, 4096, ledger_ttl);

        true
    }

    pub fn create_proposal(
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
            status: String::from_str(&env, "pending"),
            created_at: env.ledger().timestamp(),
            voting_deadline: env.ledger().timestamp() + voting_period,
        };

        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        env.storage().persistent().set(&proposal_key, &proposal);
        env.storage()
            .persistent()
            .set(&proposal_counter_key, &counter);

        // Extend TTL for proposal storage (30 days in ledgers)
        let ledger_ttl = 30 * 24 * 3600 / 5; // ~30 days (5 second blocks)
        env.storage().persistent().extend_ttl(&proposal_key, 4096, ledger_ttl);
        env.storage().persistent().extend_ttl(&proposal_counter_key, 4096, ledger_ttl);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("created")),
            (proposal_id, proposer, proposal.voting_deadline),
        );

        proposal_id
    }

    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_yes: bool,
    ) -> bool {
        voter.require_auth();

        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        let mut proposal = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Proposal>(&proposal_key)
            .expect("Proposal not found");

        let pending = String::from_str(&env, "pending");
        assert!(proposal.status == pending, "Proposal not pending");
        assert!(
            env.ledger().timestamp() < proposal.voting_deadline,
            "Voting period has ended"
        );

        // Check if voter already voted (simplified - in reality use a mapping)
        let vote_key = (Symbol::new(&env, "vote"), proposal_id, voter.clone());
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

        // Extend TTL for vote storage (30 days in ledgers)
        let ledger_ttl = 30 * 24 * 3600 / 5; // ~30 days (5 second blocks)
        env.storage().persistent().extend_ttl(&proposal_key, 4096, ledger_ttl);
        env.storage().persistent().extend_ttl(&vote_key, 4096, ledger_ttl);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("voted")),
            (proposal_id, voter, vote_yes),
        );

        true
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Proposal {
        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        env.storage()
            .persistent()
            .get::<(Symbol, u64), Proposal>(&proposal_key)
            .expect("Proposal not found")
    }

    pub fn execute_proposal(env: Env, proposal_id: u64) -> bool {
        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        let mut proposal = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Proposal>(&proposal_key)
            .expect("Proposal not found");

        assert!(
            env.ledger().timestamp() >= proposal.voting_deadline,
            "Voting still in progress"
        );
        let pending = String::from_str(&env, "pending");
        assert!(proposal.status == pending, "Proposal not pending");

        if proposal.yes_votes > proposal.no_votes {
            proposal.status = String::from_str(&env, "approved");
        } else {
            proposal.status = String::from_str(&env, "rejected");
        }

        env.storage().persistent().set(&proposal_key, &proposal);

        // Extend TTL for proposal storage (30 days in ledgers)
        let ledger_ttl = 30 * 24 * 3600 / 5; // ~30 days (5 second blocks)
        env.storage().persistent().extend_ttl(&proposal_key, 4096, ledger_ttl);

        true
    }

    // ── Issue #632: Token-weighted voting ────────────────────────────────────

    /// Cast a token-weighted vote on a proposal.
    ///
    /// `token_weight` is the caller's token balance used as vote weight.  The
    /// contract accumulates weighted tallies (`yes_votes` / `no_votes`) so that
    /// large token holders have proportionally more influence.
    pub fn vote_weighted(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_yes: bool,
        token_weight: u64,
    ) -> bool {
        voter.require_auth();
        assert!(token_weight > 0, "Token weight must be positive");

        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        let mut proposal = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Proposal>(&proposal_key)
            .expect("Proposal not found");

        let pending = String::from_str(&env, "pending");
        assert!(proposal.status == pending, "Proposal not pending");
        assert!(
            env.ledger().timestamp() < proposal.voting_deadline,
            "Voting period has ended"
        );

        // Prevent double-voting
        let vote_key = (Symbol::new(&env, "wvote"), proposal_id, voter.clone());
        assert!(
            !env.storage().persistent().has(&vote_key),
            "Already voted"
        );

        if vote_yes {
            proposal.yes_votes = proposal.yes_votes.saturating_add(token_weight);
        } else {
            proposal.no_votes = proposal.no_votes.saturating_add(token_weight);
        }

        let tv = TokenVote { proposal_id, voter: voter.clone(), weight: token_weight, vote_yes };
        env.storage().persistent().set(&proposal_key, &proposal);
        env.storage().persistent().set(&vote_key, &tv);

        let ledger_ttl = 30 * 24 * 3600 / 5;
        env.storage().persistent().extend_ttl(&proposal_key, 4096, ledger_ttl);
        env.storage().persistent().extend_ttl(&vote_key, 4096, ledger_ttl);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("wvoted")),
            (proposal_id, voter, vote_yes, token_weight),
        );

        true
    }

    /// Queue an approved proposal for timelocked execution.
    ///
    /// `timelock_delay` is in seconds.  The proposal must already be in
    /// "approved" status (i.e. `execute_proposal` has been called).
    pub fn queue_execution(env: Env, proposal_id: u64, timelock_delay: u64) {
        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        let proposal = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Proposal>(&proposal_key)
            .expect("Proposal not found");

        let approved = String::from_str(&env, "approved");
        assert!(proposal.status == approved, "Proposal must be approved to queue");

        let unlock_at = env.ledger().timestamp().saturating_add(timelock_delay);
        let tl = ExecutionTimelock { proposal_id, unlock_at };
        let tl_key = (Symbol::new(&env, "timelock"), proposal_id);
        env.storage().persistent().set(&tl_key, &tl);

        let ledger_ttl = 30 * 24 * 3600 / 5;
        env.storage().persistent().extend_ttl(&tl_key, 4096, ledger_ttl);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("queued")),
            (proposal_id, unlock_at),
        );
    }

    /// Execute a timelocked proposal after its delay has elapsed.
    ///
    /// If the proposal carries a `ProposalParam` (stored via
    /// `create_param_proposal`), the governance config is updated on-chain.
    pub fn execute_timelocked(env: Env, proposal_id: u64) -> bool {
        let tl_key = (Symbol::new(&env, "timelock"), proposal_id);
        let tl: ExecutionTimelock = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), ExecutionTimelock>(&tl_key)
            .expect("Proposal not queued for timelocked execution");

        assert!(
            env.ledger().timestamp() >= tl.unlock_at,
            "Timelock has not elapsed"
        );

        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        let mut proposal = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Proposal>(&proposal_key)
            .expect("Proposal not found");

        let approved = String::from_str(&env, "approved");
        assert!(proposal.status == approved, "Proposal is not approved");

        // Apply any on-chain parameter changes attached to this proposal
        let param_key = (Symbol::new(&env, "pparam"), proposal_id);
        if let Some(param) = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), ProposalParam>(&param_key)
        {
            let config_key = Symbol::new(&env, "governance_config");
            let mut config = Self::get_config(env.clone());

            if let Some(fee_bps) = param.target_fee_bps {
                assert!(fee_bps <= 1000, "Proposed fee exceeds 10 %");
                config.platform_fee_percent = fee_bps;
            }
            if let Some(min_budget) = param.target_min_budget {
                assert!(min_budget > 0, "Proposed min budget must be positive");
                config.min_bounty_budget = min_budget;
            }
            if let Some(max_budget) = param.target_max_budget {
                config.max_bounty_budget = max_budget;
            }

            config.last_updated = env.ledger().timestamp();
            env.storage().persistent().set(&config_key, &config);
        }

        proposal.status = String::from_str(&env, "executed");
        env.storage().persistent().set(&proposal_key, &proposal);
        env.storage().persistent().remove(&tl_key);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("executed")),
            (proposal_id,),
        );

        true
    }

    /// Create a proposal that carries an on-chain parameter change.
    ///
    /// Combines `create_proposal` with attaching a `ProposalParam` so that
    /// on approval + timelock expiry the config updates atomically without any
    /// further admin transaction.
    pub fn create_param_proposal(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        voting_period: u64,
        param: ProposalParam,
    ) -> u64 {
        let proposal_id = Self::create_proposal(
            env.clone(),
            proposer,
            title,
            description,
            voting_period,
        );

        let param_key = (Symbol::new(&env, "pparam"), proposal_id);
        env.storage().persistent().set(&param_key, &param);

        let ledger_ttl = 30 * 24 * 3600 / 5;
        env.storage().persistent().extend_ttl(&param_key, 4096, ledger_ttl);

        proposal_id
    }

    /// Retrieve the weighted vote record for a specific voter on a proposal.
    pub fn get_token_vote(env: Env, proposal_id: u64, voter: Address) -> TokenVote {
        let vote_key = (Symbol::new(&env, "wvote"), proposal_id, voter);
        env.storage()
            .persistent()
            .get::<(Symbol, u64, Address), TokenVote>(&vote_key)
            .expect("Vote not found")
    }

    /// Retrieve the execution timelock for a queued proposal.
    pub fn get_timelock(env: Env, proposal_id: u64) -> ExecutionTimelock {
        let tl_key = (Symbol::new(&env, "timelock"), proposal_id);
        env.storage()
            .persistent()
            .get::<(Symbol, u64), ExecutionTimelock>(&tl_key)
            .expect("Proposal not queued")
    }

    // ── Issue #749: Quorum enforcement ───────────────────────────────────────

    const DEFAULT_QUORUM_PERCENT: u64 = 10; // 10% of total voting power

    /// Set the quorum threshold (0–100). Only admin can update.
    pub fn set_quorum_percent(env: Env, admin: Address, quorum_percent: u64) {
        admin.require_auth();
        let config = Self::get_config(env.clone());
        assert_eq!(admin, config.admin_address, "Only admin can set quorum");
        assert!(quorum_percent <= 100, "Quorum must be 0-100");
        let key = Symbol::new(&env, "quorum_pct");
        env.storage().persistent().set(&key, &quorum_percent);
        let ledger_ttl = 30 * 24 * 3600 / 5;
        env.storage().persistent().extend_ttl(&key, 4096, ledger_ttl);
        env.events().publish((symbol_short!("gov"), symbol_short!("quorum")), (quorum_percent,));
    }

    /// Get the current quorum threshold. Defaults to 10%.
    pub fn get_quorum_percent(env: Env) -> u64 {
        let key = Symbol::new(&env, "quorum_pct");
        env.storage().persistent().get::<Symbol, u64>(&key).unwrap_or(Self::DEFAULT_QUORUM_PERCENT)
    }

    /// Set total voting power (governance token supply). Admin only.
    pub fn set_total_voting_power(env: Env, admin: Address, total: u64) {
        admin.require_auth();
        let config = Self::get_config(env.clone());
        assert_eq!(admin, config.admin_address, "Only admin can set voting power");
        assert!(total > 0, "Total voting power must be positive");
        let key = Symbol::new(&env, "total_vp");
        env.storage().persistent().set(&key, &total);
        let ledger_ttl = 30 * 24 * 3600 / 5;
        env.storage().persistent().extend_ttl(&key, 4096, ledger_ttl);
    }

    /// Get total voting power. Returns 0 if not yet configured.
    pub fn get_total_voting_power(env: Env) -> u64 {
        let key = Symbol::new(&env, "total_vp");
        env.storage().persistent().get::<Symbol, u64>(&key).unwrap_or(0)
    }

    /// Finalize a proposal after its voting deadline, enforcing quorum.
    ///
    /// Requires `(yes_votes + no_votes) * 100 / total_supply >= quorum_percent`.
    /// Panics if quorum is not met, voting is still open, or total supply is 0.
    pub fn finalize_proposal(env: Env, proposal_id: u64) -> bool {
        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        let mut proposal = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Proposal>(&proposal_key)
            .expect("Proposal not found");

        assert!(
            env.ledger().timestamp() >= proposal.voting_deadline,
            "Voting still in progress"
        );
        let pending = String::from_str(&env, "pending");
        assert!(proposal.status == pending, "Proposal not pending");

        let total_supply = Self::get_total_voting_power(env.clone());
        assert!(total_supply > 0, "Total voting power not configured");

        let participation = (proposal.yes_votes + proposal.no_votes)
            .saturating_mul(100)
            / total_supply;
        let quorum = Self::get_quorum_percent(env.clone());

        assert!(participation >= quorum, "QuorumNotMet");

        proposal.status = if proposal.yes_votes > proposal.no_votes {
            String::from_str(&env, "approved")
        } else {
            String::from_str(&env, "rejected")
        };

        env.storage().persistent().set(&proposal_key, &proposal);
        let ledger_ttl = 30 * 24 * 3600 / 5;
        env.storage().persistent().extend_ttl(&proposal_key, 4096, ledger_ttl);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("finalized")),
            (proposal_id, participation, quorum),
        );

        true
    }

    // ── Issue #770: Guardian veto & configurable timelock ────────────────

    /// Add a guardian address that can veto queued proposals.
    /// Only the admin can add guardians.
    pub fn add_guardian(env: Env, admin: Address, guardian: Address) {
        admin.require_auth();
        let config = Self::get_config(env.clone());
        assert_eq!(admin, config.admin_address, "Only admin can add guardians");

        let guardian_key = (Symbol::new(&env, "guardian"), guardian.clone());
        env.storage().persistent().set(&guardian_key, &true);

        let ledger_ttl = 30 * 24 * 3600 / 5;
        env.storage().persistent().extend_ttl(&guardian_key, 4096, ledger_ttl);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("guard_add")),
            (guardian,),
        );
    }

    /// Remove a guardian. Only the admin can remove guardians.
    pub fn remove_guardian(env: Env, admin: Address, guardian: Address) {
        admin.require_auth();
        let config = Self::get_config(env.clone());
        assert_eq!(admin, config.admin_address, "Only admin can remove guardians");

        let guardian_key = (Symbol::new(&env, "guardian"), guardian.clone());
        env.storage().persistent().remove(&guardian_key);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("guard_rm")),
            (guardian,),
        );
    }

    /// Check if an address is a guardian.
    pub fn is_guardian(env: Env, addr: Address) -> bool {
        let guardian_key = (Symbol::new(&env, "guardian"), addr);
        env.storage()
            .persistent()
            .get::<(Symbol, Address), bool>(&guardian_key)
            .unwrap_or(false)
    }

    /// Set the default timelock duration (in seconds). Only admin can change.
    pub fn set_timelock_duration(env: Env, admin: Address, duration_secs: u64) {
        admin.require_auth();
        let config = Self::get_config(env.clone());
        assert_eq!(admin, config.admin_address, "Only admin can set timelock duration");

        let key = Symbol::new(&env, "tl_duration");
        env.storage().persistent().set(&key, &duration_secs);

        let ledger_ttl = 30 * 24 * 3600 / 5;
        env.storage().persistent().extend_ttl(&key, 4096, ledger_ttl);
    }

    /// Get the current timelock duration. Defaults to 48 hours.
    pub fn get_timelock_duration(env: Env) -> u64 {
        let key = Symbol::new(&env, "tl_duration");
        env.storage()
            .persistent()
            .get::<Symbol, u64>(&key)
            .unwrap_or(DEFAULT_TIMELOCK_SECONDS)
    }

    /// Queue an approved proposal using the configured default timelock.
    pub fn queue_execution_default(env: Env, proposal_id: u64) {
        let duration = Self::get_timelock_duration(env.clone());
        Self::queue_execution(env, proposal_id, duration);
    }

    /// Veto a queued proposal. Only guardians can veto.
    /// Removes the timelock and marks the proposal as rejected.
    pub fn veto_proposal(env: Env, guardian: Address, proposal_id: u64) {
        guardian.require_auth();
        assert!(
            Self::is_guardian(env.clone(), guardian.clone()),
            "Only guardians can veto proposals"
        );

        let tl_key = (Symbol::new(&env, "timelock"), proposal_id);
        assert!(
            env.storage().persistent().has(&tl_key),
            "Proposal is not queued for execution"
        );

        let proposal_key = (Symbol::new(&env, "proposal"), proposal_id);
        let mut proposal = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), Proposal>(&proposal_key)
            .expect("Proposal not found");

        let approved = String::from_str(&env, "approved");
        assert!(proposal.status == approved, "Proposal is not in approved status");

        proposal.status = String::from_str(&env, "vetoed");
        env.storage().persistent().set(&proposal_key, &proposal);
        env.storage().persistent().remove(&tl_key);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("vetoed")),
            (proposal_id, guardian),
        );
    }

    // ── Issue #732: Contract upgrade mechanism ────────────────────────────────

    /// Upgrade the contract WASM. Only the governance admin multisig may call this.
    /// Emits an `upgraded` event with the new wasm hash.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) {
        admin.require_auth();
        let config = Self::get_config(env.clone());
        assert_eq!(admin, config.admin_address, "unauthorized");

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        env.events().publish(
            (symbol_short!("contract"), symbol_short!("upgraded")),
            new_wasm_hash,
        );
    }
}

mod tests;
