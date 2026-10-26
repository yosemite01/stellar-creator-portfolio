#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

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
/// `weight` is the voter's checkpointed voting power at the proposal's
/// snapshot ledger (Issue #1565), in the voting token's smallest
/// denomination. It is read on-chain, never supplied by the caller.
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

/// A voter's deposited voting power from `ledger` onwards (Issue #1565).
///
/// Checkpoints are append-only per account (one entry per ledger in which the
/// balance changed), so `get_past_votes` can answer "how much power did this
/// account have at ledger N" without trusting the caller.
#[contracttype]
#[derive(Clone)]
pub struct VotingCheckpoint {
    pub ledger: u32,
    pub votes: i128,
}

// ── Issue #1565: voting-power checkpoints ────────────────────────────────────

const LEDGER_TTL: u32 = 30 * 24 * 3600 / 5; // ~30 days (5 second blocks)

fn ckpt_count_key(env: &Env, account: &Address) -> (Symbol, Address) {
    (Symbol::new(env, "vp_n"), account.clone())
}

fn ckpt_key(env: &Env, account: &Address, index: u32) -> (Symbol, Address, u32) {
    (Symbol::new(env, "vp_ck"), account.clone(), index)
}

fn ckpt_count(env: &Env, account: &Address) -> u32 {
    env.storage()
        .persistent()
        .get::<(Symbol, Address), u32>(&ckpt_count_key(env, account))
        .unwrap_or(0)
}

fn ckpt_at(env: &Env, account: &Address, index: u32) -> VotingCheckpoint {
    env.storage()
        .persistent()
        .get::<(Symbol, Address, u32), VotingCheckpoint>(&ckpt_key(env, account, index))
        .expect("Checkpoint missing")
}

/// Record `votes` as `account`'s power from the current ledger onwards.
/// Multiple changes within one ledger collapse into a single checkpoint.
fn write_checkpoint(env: &Env, account: &Address, votes: i128) {
    let ledger = env.ledger().sequence();
    let n = ckpt_count(env, account);
    let cp = VotingCheckpoint { ledger, votes };

    if n > 0 && ckpt_at(env, account, n - 1).ledger == ledger {
        let key = ckpt_key(env, account, n - 1);
        env.storage().persistent().set(&key, &cp);
        env.storage().persistent().extend_ttl(&key, 4096, LEDGER_TTL);
        return;
    }

    let key = ckpt_key(env, account, n);
    let count_key = ckpt_count_key(env, account);
    env.storage().persistent().set(&key, &cp);
    env.storage().persistent().set(&count_key, &(n + 1));
    env.storage().persistent().extend_ttl(&key, 4096, LEDGER_TTL);
    env.storage().persistent().extend_ttl(&count_key, 4096, LEDGER_TTL);
}

/// Voting power of `account` as of the end of `ledger` (binary search over
/// checkpoints). Returns 0 if the account had no deposit by then.
fn votes_at(env: &Env, account: &Address, ledger: u32) -> i128 {
    let n = ckpt_count(env, account);
    if n == 0 {
        return 0;
    }
    let last = ckpt_at(env, account, n - 1);
    if last.ledger <= ledger {
        return last.votes;
    }
    if ckpt_at(env, account, 0).ledger > ledger {
        return 0;
    }
    // Largest index whose checkpoint ledger is <= `ledger`.
    let (mut lo, mut hi) = (0u32, n - 1);
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if ckpt_at(env, account, mid).ledger <= ledger {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    ckpt_at(env, account, lo).votes
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    /// One-time constructor: sets the external admin and default governance parameters.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        let config_key = Symbol::new(&env, "governance_config");
        assert!(
            !env.storage().persistent().has(&config_key),
            "Already initialized"
        );

        let config = GovernanceConfig {
            platform_fee_percent: 50, // 5%
            min_bounty_budget: 100,
            max_bounty_budget: 1_000_000,
            dispute_resolution_period: 7 * 24 * 3600, // 7 days
            admin_address: admin,
            last_updated: 0,
        };
        env.storage().persistent().set(&config_key, &config);
    }

    pub fn get_config(env: Env) -> GovernanceConfig {
        let config_key = Symbol::new(&env, "governance_config");
        env.storage()
            .persistent()
            .get::<Symbol, GovernanceConfig>(&config_key)
            .expect("Not initialized")
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
            proposer: proposer.clone(),
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

        // Issue #1565: freeze voting power at the ledger *before* creation so
        // deposits made in the same ledger as the proposal (e.g. bundled with a
        // borrow) carry no weight. Stored beside the proposal rather than in it
        // so the `Proposal` storage shape is unchanged.
        let snapshot_ledger = env.ledger().sequence().saturating_sub(1);
        let snapshot_key = (Symbol::new(&env, "snapshot"), proposal_id);
        env.storage().persistent().set(&snapshot_key, &snapshot_ledger);
        env.storage().persistent().extend_ttl(&snapshot_key, 4096, ledger_ttl);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("snapshot")),
            (proposal_id, snapshot_ledger),
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
    /// The vote weight is the voter's checkpointed voting power at the
    /// proposal's snapshot ledger (Issue #1565) — tokens deposited or
    /// transferred in after the proposal was created carry no weight on it.
    /// Previously the caller supplied the weight directly, which let anyone
    /// claim arbitrary power or vote with briefly borrowed tokens.
    pub fn vote_weighted(
        env: Env,
        voter: Address,
        proposal_id: u64,
        vote_yes: bool,
    ) -> bool {
        voter.require_auth();

        // Deny-by-default: proposals created before snapshots existed have no
        // snapshot ledger and cannot take weighted votes.
        let snapshot_key = (Symbol::new(&env, "snapshot"), proposal_id);
        let snapshot_ledger: u32 = env
            .storage()
            .persistent()
            .get::<(Symbol, u64), u32>(&snapshot_key)
            .expect("Proposal has no voting snapshot");
        let power = votes_at(&env, &voter, snapshot_ledger);
        assert!(power > 0, "No voting power at snapshot");
        let token_weight: u64 = u64::try_from(power).expect("Voting power overflow");

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

    // ── Issue #1565: Checkpointed voting power ───────────────────────────────

    /// Set the governance token whose deposits confer voting power. Admin-only
    /// and set-once: swapping the token would invalidate existing checkpoints.
    pub fn set_voting_token(env: Env, admin: Address, token: Address) {
        admin.require_auth();
        let config = Self::get_config(env.clone());
        assert_eq!(admin, config.admin_address, "Only admin can set voting token");
        let key = Symbol::new(&env, "vote_token");
        assert!(!env.storage().persistent().has(&key), "Voting token already set");
        env.storage().persistent().set(&key, &token);
        env.storage().persistent().extend_ttl(&key, 4096, LEDGER_TTL);
        env.events().publish(
            (symbol_short!("gov"), symbol_short!("vp_token")),
            (token,),
        );
    }

    /// The governance token, if configured.
    pub fn get_voting_token(env: Env) -> Option<Address> {
        env.storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "vote_token"))
    }

    /// Lock `amount` governance tokens in this contract to gain voting power.
    /// Power counts only for proposals created in a later ledger.
    pub fn deposit_votes(env: Env, account: Address, amount: i128) -> i128 {
        account.require_auth();
        assert!(amount > 0, "Amount must be positive");
        let token = Self::get_voting_token(env.clone()).expect("Voting token not set");

        soroban_sdk::token::Client::new(&env, &token).transfer(
            &account,
            env.current_contract_address(),
            &amount,
        );

        let current = votes_at(&env, &account, env.ledger().sequence());
        let updated = current.checked_add(amount).expect("Voting power overflow");
        write_checkpoint(&env, &account, updated);

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("vp_dep")),
            (account, amount, updated),
        );
        updated
    }

    /// Unlock `amount` governance tokens. Votes already cast are unaffected
    /// (they used the snapshot), and the withdrawn tokens can't be re-used on
    /// any proposal whose snapshot predates a later re-deposit.
    pub fn withdraw_votes(env: Env, account: Address, amount: i128) -> i128 {
        account.require_auth();
        assert!(amount > 0, "Amount must be positive");
        let token = Self::get_voting_token(env.clone()).expect("Voting token not set");

        let current = votes_at(&env, &account, env.ledger().sequence());
        assert!(current >= amount, "Insufficient voting power");
        let updated = current - amount;
        write_checkpoint(&env, &account, updated);

        soroban_sdk::token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &account,
            &amount,
        );

        env.events().publish(
            (symbol_short!("gov"), symbol_short!("vp_wd")),
            (account, amount, updated),
        );
        updated
    }

    /// Current voting power of `account`.
    pub fn get_votes(env: Env, account: Address) -> i128 {
        votes_at(&env, &account, env.ledger().sequence())
    }

    /// Voting power of `account` as of the end of `ledger`.
    pub fn get_past_votes(env: Env, account: Address, ledger: u32) -> i128 {
        votes_at(&env, &account, ledger)
    }

    /// Ledger at which voting power is measured for `proposal_id`.
    pub fn get_proposal_snapshot(env: Env, proposal_id: u64) -> u32 {
        env.storage()
            .persistent()
            .get::<(Symbol, u64), u32>(&(Symbol::new(&env, "snapshot"), proposal_id))
            .expect("Proposal has no voting snapshot")
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

    // ── Issue #1564: Timelocked upgrade + two-step admin transfer ─────────────
    //
    // Replaces the old instant `upgrade` entrypoint. Shared logic lives in
    // `stellar-upgradeable`; see docs/contracts.md (Upgrading a live contract).

    /// Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
    /// which `execute_upgrade` may be called (now + 48h). Emits
    /// `(upgrade, proposed)`.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> u64 {
        let stored_admin: Address = Self::get_config(env.clone()).admin_address;
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = Self::get_config(env.clone()).admin_address;
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = Self::get_config(env.clone()).admin_address;
        stellar_upgradeable::cancel_upgrade(&env, &admin, &stored_admin);
    }

    /// The upgrade currently waiting out its timelock, if any.
    pub fn get_pending_upgrade(env: Env) -> Option<stellar_upgradeable::PendingUpgrade> {
        stellar_upgradeable::pending_upgrade(&env)
    }

    /// Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = Self::get_config(env.clone()).admin_address;
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let mut config = Self::get_config(env.clone());
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &config.admin_address);
        config.admin_address = accepted;
        env.storage()
            .persistent()
            .set(&Symbol::new(&env, "governance_config"), &config);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = Self::get_config(env.clone()).admin_address;
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }
}

mod tests;
