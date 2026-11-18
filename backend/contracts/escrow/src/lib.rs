#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

// Reentrancy protection module (#635)
mod reentrancy;

#[cfg(test)]
mod milestone_tests;
#[cfg(test)]
mod invariant_fuzz;
use reentrancy::{require_active_escrow, require_authorized_party, ReentrancyGuard};

// Per-dispute arbitration (#1713)
pub mod arbitration;
pub use arbitration::{
    vote_commitment, ArbitrationConfig, Arbiter, CasePhase, DisputeCase, Evidence,
};

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Symbol, Vec,
    token::Client as TokenClient,
};
use stellar_contract_ttl::{self as ttl, TtlPolicy};

/// Escrow Status
#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum EscrowStatus {
    Active = 0,
    Released = 1,
    Refunded = 2,
    Disputed = 3,
    Complete = 4,
}

/// Release Condition
#[derive(Clone, Debug)]
#[contracttype]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

// ---- Fee constants (#344/#722) --------------------------------------------------

/// Default platform fee in basis points (2.5 %).
pub const DEFAULT_PLATFORM_FEE_BPS: i128 = 250;

/// Default maximum platform fee in token units (500 USDC-equivalent).
pub const DEFAULT_PLATFORM_FEE_CAP: i128 = 500;

/// Dispute timeout: 30 days in ledger seconds (#731).
/// If no arbiter panel could be drawn for a dispute within this window, anyone
/// can call `resolve_expired_dispute` for a fixed 50/50 split (#1713). The
/// split is a constant: there is no admin-settable dispute outcome any more.
pub const DISPUTE_TIMEOUT_SECS: u64 = 30 * 24 * 3600;

/// Bounds for the governance-configurable oracle freshness threshold (#1110).
/// A value of 0 would mark every recorded price stale immediately, while an
/// unbounded value would defeat the freshness guard entirely.
pub const MIN_ORACLE_STALENESS_SECS: u64 = 60;
pub const MAX_ORACLE_STALENESS_SECS: u64 = 86_400;

/// Governance-configurable fee configuration stored on-chain (#722).
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeConfig {
    pub fee_bps: i128,
    pub fee_cap: i128,
}

/// Delay before a fee *increase* takes effect (#1724): 48 hours.
///
/// Decreases apply immediately because they can only help users; increases are
/// announced with a `(escrow, fee_prop)` event and only become effective once
/// this window has elapsed, so a transaction quoted under the old fee can be
/// submitted (or abandoned) before the new fee bites.
pub const FEE_CHANGE_DELAY_SECS: u64 = 48 * 3600;

/// A scheduled fee increase waiting out `FEE_CHANGE_DELAY_SECS` (#1724).
#[contracttype]
#[derive(Clone, Debug)]
pub struct PendingFeeConfig {
    pub config: FeeConfig,
    pub effective_at: u64,
}

fn stored_fee_config(env: &Env) -> FeeConfig {
    env.storage()
        .persistent()
        .get::<DataKey, FeeConfig>(&DataKey::FeeConfig)
        .unwrap_or(FeeConfig {
            fee_bps: DEFAULT_PLATFORM_FEE_BPS,
            fee_cap: DEFAULT_PLATFORM_FEE_CAP,
        })
}

/// Read the *effective* fee config: the stored config, or a pending increase
/// whose timelock has elapsed (activated lazily, so no keeper is required).
pub fn get_fee_config(env: &Env) -> FeeConfig {
    if let Some(p) = env
        .storage()
        .persistent()
        .get::<DataKey, PendingFeeConfig>(&DataKey::PendingFeeConfig)
    {
        if env.ledger().timestamp() >= p.effective_at {
            return p.config;
        }
    }
    stored_fee_config(env)
}

/// Compute the platform fee for a given gross amount using the current config.
/// Fee = min(amount * fee_bps / 10_000, fee_cap)
pub fn platform_fee(amount: i128) -> i128 {
    // When called from storage-aware code use platform_fee_with_config instead.
    let raw = amount * DEFAULT_PLATFORM_FEE_BPS / 10_000;
    if raw > DEFAULT_PLATFORM_FEE_CAP { DEFAULT_PLATFORM_FEE_CAP } else { raw }
}

/// Compute platform fee using a specific FeeConfig (snapshot on deposit).
pub fn platform_fee_with_config(amount: i128, config: &FeeConfig) -> i128 {
    let raw = amount * config.fee_bps / 10_000;
    if raw > config.fee_cap { config.fee_cap } else { raw }
}

/// Escrow Account
#[contracttype]
pub struct EscrowAccount {
    pub id: u64,
    pub bounty_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub token: Address,
    pub status: EscrowStatus,
    pub release_condition: ReleaseCondition,
    pub created_at: u64,
    pub released_at: Option<u64>,
    pub fee_collected: i128,
}

/// Maximum milestones per escrow. Bounds the fee-allocation loop (#1712).
pub const MAX_MILESTONES: u32 = 50;

/// Milestone — a named portion of the total escrow amount.
///
/// `amount` is the **net** payout to the payee (escrow amounts are already net
/// of the platform fee). `fee_share` is this milestone's share of the fee that
/// was charged once, on the total, at deposit. It is allocated with
/// largest-remainder rounding as soon as the milestone plan sums to the escrow
/// amount, so `sum(amount) + sum(fee_share) == deposited` exactly (#1712).
#[contracttype]
pub struct Milestone {
    pub escrow_id: u64,
    pub index: u32,
    pub description: Symbol,
    pub amount: i128,
    pub released: bool,
    pub fee_share: i128,
}

/// Split `total_fee` across `weights` proportionally, using largest-remainder
/// rounding so the shares sum to exactly `total_fee` (#1712).
///
/// Ties on the remainder go to the earlier position, so the result is
/// deterministic. `weights` must be non-empty with a positive sum.
pub fn allocate_largest_remainder(env: &Env, total_fee: i128, weights: &soroban_sdk::Vec<i128>) -> soroban_sdk::Vec<i128> {
    let n = weights.len();
    let mut shares = soroban_sdk::Vec::new(env);
    let mut remainders = soroban_sdk::Vec::new(env);
    let mut sum_w: i128 = 0;
    for w in weights.iter() {
        sum_w += w;
    }
    if n == 0 || sum_w <= 0 {
        return shares;
    }
    let mut allocated: i128 = 0;
    for w in weights.iter() {
        let base = total_fee * w / sum_w;
        shares.push_back(base);
        remainders.push_back(total_fee * w % sum_w);
        allocated += base;
    }
    let mut leftover = total_fee - allocated; // 0 <= leftover < n
    while leftover > 0 {
        let mut best: u32 = 0;
        let mut best_rem: i128 = -1;
        for i in 0..n {
            let r = remainders.get_unchecked(i);
            if r > best_rem {
                best_rem = r;
                best = i;
            }
        }
        shares.set(best, shares.get_unchecked(best) + 1);
        remainders.set(best, -1); // each position receives at most one unit
        leftover -= 1;
    }
    shares
}

/// DataKey for typed persistent storage lookups.
#[contracttype]
pub enum DataKey {
    Escrow(u64),
    EscrowCounter,
    Yield(u64),
    YieldCfg,
    YieldPaused,
    MilestoneCount(u64),
    MilestoneTotal(u64),
    MilestoneReleasedCount(u64),
    MilestoneReleasedAmount(u64),
    /// Ordered milestone indices for an escrow (bounded by `MAX_MILESTONES`).
    MilestoneIndices(u64),
    DisputeExpiry(u64),
    FeeConfig,
    OracleStalenessSecs,
    OracleAddress,
    /// #1715: token contract accepted by `deposit` (admin-managed allowlist).
    AllowedToken(Address),
    /// #1714: the bounty contract trusted to drive bound escrows.
    BountyContract,
    /// #1714: bounty_id -> escrow_id bound by the bounty contract.
    BoundEscrow(u64),
    /// #1714: escrow_id -> bounty_id for escrows bound to a bounty.
    EscrowBound(u64),
}

// ── Issue #631: Yield Farming for Unwithdrawn Escrow Funds ───────────────────

/// Default maximum acceptable slippage (bps) for yield-protocol deposits,
/// applied until governance explicitly sets one via `configure_slippage`.
const DEFAULT_MAX_SLIPPAGE_BPS: u32 = 100; // 1 %

/// Platform-level yield configuration set by the admin.
///
/// `rate_bps`           — annual yield rate in basis points (e.g. 300 = 3 %)
/// `max_yield_ratio`    — maximum yield as a fraction of principal in bps
///                        (e.g. 500 = 5 % cap; protects against runaway accrual)
/// `min_liquidity_bps`  — minimum principal that must remain liquid, in bps of
///                        total locked (e.g. 9000 = 90 % must stay withdrawable)
/// `max_slippage_bps`   — maximum acceptable slippage for yield-protocol
///                        deposits, in bps (e.g. 100 = 1 %); governance-
///                        configurable via `configure_slippage`
#[contracttype]
pub struct YieldConfig {
    pub rate_bps: u32,
    pub max_yield_ratio: u32,
    pub min_liquidity_bps: u32,
    pub max_slippage_bps: u32,
}

/// Per-escrow yield accrual tracking.  Yield is held internally in the
/// contract and never credited to either party's off-chain ledger.
#[contracttype]
pub struct YieldAccrual {
    pub escrow_id: u64,
    pub principal: i128,
    pub accrued: i128,
    pub last_updated: u64,
}



/// Mirrors `oracle::PriceData` field-for-field so the cross-contract call in
/// `release_funds` can decode the oracle's return value without a crate
/// dependency on the oracle contract itself.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OraclePriceData {
    pub price_micro_usd: i128,
    pub timestamp: u64,
    pub sources: u32,
}

/// Typed errors returned by escrow entrypoints (#1562).
///
/// Codes are part of the contract's public interface: clients and the
/// indexer map them to messages, so never renumber an existing variant —
/// only append new ones. See docs/contracts.md for the full table.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    EscrowNotFound = 1,
    AdminNotSet = 2,
    AdminAlreadySet = 3,
    Unauthorized = 4,
    EscrowNotActive = 5,
    ReleaseConditionNotMet = 6,
    OraclePriceStale = 7,
    InvalidAmount = 8,
    NoEscrowForBounty = 9,
    EscrowNotDisputed = 10,
    DisputeNotExpired = 11,
    DisputeExpiryMissing = 12,
    InvalidBps = 13,
    MilestoneNotFound = 14,
    MilestoneAlreadyExists = 15,
    MilestoneAlreadyReleased = 16,
    MilestoneExceedsEscrow = 17,
    UnsupportedOperation = 18,
    YieldPaused = 19,
    YieldNotConfigured = 20,
    YieldAccrualNotFound = 21,
    NoYieldToWithdraw = 22,
    InsufficientLiquidity = 23,
    InvalidFeeConfig = 24,
    InvalidStaleness = 25,
    /// #1715: `deposit` with a token that is not on the admin allowlist.
    TokenNotAllowed = 26,
    /// #1715: the token moved a different amount than requested
    /// (fee-on-transfer, rebasing or no-op `transfer`).
    TokenTransferMismatch = 27,
    /// #1714: a bounty-driven call before `set_bounty_contract`.
    BountyContractNotSet = 28,
    /// #1714: caller is not the registered bounty contract.
    NotBountyContract = 29,
    /// #1714: escrow is bound to a bounty; drive it through the bounty contract.
    ManagedByBounty = 30,
    /// #1714: escrow or bounty is already bound.
    EscrowAlreadyBound = 31,
    /// #1714: escrow belongs to another bounty or payer.
    BountyMismatch = 32,
}

fn escrow_key(env: &Env, escrow_id: u64) -> (Symbol, u64) {
    (Symbol::new(env, "escrow"), escrow_id)
}

/// Loads an escrow and extends its TTL (#1720): every read and every write
/// path goes through here, so an escrow that is touched stays live.
fn load_escrow(env: &Env, escrow_id: u64) -> Result<EscrowAccount, EscrowError> {
    let key = escrow_key(env, escrow_id);
    let escrow = env
        .storage()
        .persistent()
        .get::<(Symbol, u64), EscrowAccount>(&key)
        .ok_or(EscrowError::EscrowNotFound)?;
    ttl::extend(env, &key, TtlPolicy::UserEntry);
    Ok(escrow)
}

fn stored_admin(env: &Env) -> Result<Address, EscrowError> {
    env.storage()
        .persistent()
        .get::<Symbol, Address>(&Symbol::new(env, "platform_admin"))
        .ok_or(EscrowError::AdminNotSet)
}

/// Fails with `AdminNotSet` / `Unauthorized` unless `admin` is the stored platform admin.
fn require_admin(env: &Env, admin: &Address) -> Result<(), EscrowError> {
    if *admin != stored_admin(env)? {
        return Err(EscrowError::Unauthorized);
    }
    Ok(())
}

fn ensure(cond: bool, err: EscrowError) -> Result<(), EscrowError> {
    if cond { Ok(()) } else { Err(err) }
}

/// #1714: authenticates `caller` and checks it is the registered bounty contract.
fn require_bounty_contract(env: &Env, caller: &Address) -> Result<(), EscrowError> {
    caller.require_auth();
    let registered: Address = env
        .storage()
        .persistent()
        .get::<DataKey, Address>(&DataKey::BountyContract)
        .ok_or(EscrowError::BountyContractNotSet)?;
    ensure(*caller == registered, EscrowError::NotBountyContract)
}

/// #1714: true when the escrow is bound to a bounty and may only be moved by
/// the bounty contract.
fn is_bound(env: &Env, escrow_id: u64) -> bool {
    env.storage().persistent().has(&DataKey::EscrowBound(escrow_id))
}

fn bound_escrow_id(env: &Env, bounty_id: u64) -> Result<u64, EscrowError> {
    env.storage()
        .persistent()
        .get::<DataKey, u64>(&DataKey::BoundEscrow(bounty_id))
        .ok_or(EscrowError::NoEscrowForBounty)
}

/// #1715: the allowlist is enforced once a platform admin exists (every
/// deployed instance sets one). Without an admin nobody could manage the
/// list, so only the balance-delta check applies.
fn require_token_allowed(env: &Env, token: &Address) -> Result<(), EscrowError> {
    if stored_admin(env).is_ok() {
        ensure(
            env.storage().persistent().has(&DataKey::AllowedToken(token.clone())),
            EscrowError::TokenNotAllowed,
        )?;
    }
    Ok(())
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Deposit funds into escrow
    ///
    /// Charges whatever fee is effective at execution time. Wallet-facing
    /// flows should prefer [`Self::deposit_with_max_fee`], which reverts if the
    /// fee rose after the user was quoted (#1724).
    pub fn deposit(
        env: Env,
        bounty_id: u64,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
    ) -> Result<u64, EscrowError> {
        Self::deposit_inner(env, bounty_id, payer, payee, amount, token, release_condition, None)
    }

    /// Deposit funds into escrow, reverting with `FeeExceedsMax` if the
    /// platform fee charged would exceed `max_fee` token units (#1724).
    ///
    /// Clients obtain `max_fee` from `estimate_fund_escrow_fee` at quote time
    /// (optionally plus a tolerance the user accepted) and pass it here, so a
    /// fee change between quote and execution can never over-charge the user.
    #[allow(clippy::too_many_arguments)]
    pub fn deposit_with_max_fee(
        env: Env,
        bounty_id: u64,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
        max_fee: i128,
    ) -> Result<u64, EscrowError> {
        ensure(max_fee >= 0, EscrowError::InvalidAmount)?;
        Self::deposit_inner(env, bounty_id, payer, payee, amount, token, release_condition, Some(max_fee))
    }

    #[allow(clippy::too_many_arguments)]
    fn deposit_inner(
        env: Env,
        bounty_id: u64,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
        max_fee: Option<i128>,
    ) -> Result<u64, EscrowError> {
        payer.require_auth();
        ensure(amount > 0, EscrowError::InvalidAmount)?;
        let _guard = ReentrancyGuard::acquire(&env);

        // #1724: enforce the user's fee cap before any funds move.
        let fee_cfg = get_fee_config(&env);
        let fee = platform_fee_with_config(amount, &fee_cfg);
        if let Some(max) = max_fee {
            ensure(fee <= max, EscrowError::FeeExceedsMax)?;
        }

        // #179: Validate token implements the SEP-41 interface before accepting funds.
        // Calling balance() will trap if `token` is not a valid token contract,
        // preventing funds from being locked with an unrecoverable address.
        // #1715: only admin-allowlisted tokens are accepted.
        require_token_allowed(&env, &token)?;
        let token_client = TokenClient::new(&env, &token);
        let _ = token_client.balance(&payer);
        // #1715: verify the contract actually received `amount`. Fee-on-
        // transfer, rebasing or no-op tokens fail here instead of leaving the
        // escrow accounting ahead of the real balance.
        let before = token_client.balance(&env.current_contract_address());
        token_client.transfer(&payer, env.current_contract_address(), &amount);
        let after = token_client.balance(&env.current_contract_address());
        ensure(after - before == amount, EscrowError::TokenTransferMismatch)?;

        let counter_key = Symbol::new(&env, "escrow_counter");
        let mut counter: u64 = env.storage().persistent().get::<Symbol, u64>(&counter_key).unwrap_or(0);
        counter += 1;

        let net_amount = amount - fee;

        // Collect platform fee to admin if set, otherwise hold in contract
        let admin_key = Symbol::new(&env, "platform_admin");
        if let Some(admin_addr) = env.storage().persistent().get::<Symbol, Address>(&admin_key) {
            if fee > 0 {
                TokenClient::new(&env, &token)
                    .transfer(&env.current_contract_address(), &admin_addr, &fee);
            }
        }

        let escrow = EscrowAccount {
            id: counter,
            bounty_id,
            payer,
            payee,
            amount: net_amount,
            token,
            status: EscrowStatus::Active,
            release_condition,
            created_at: env.ledger().timestamp(),
            released_at: None,
            fee_collected: fee,
        };

        env.storage()
            .persistent()
            .set(&escrow_key(&env, counter), &escrow);
        env.storage()
            .persistent()
            .set(&(Symbol::new(&env, "b_esc"), bounty_id), &counter);
        env.storage().persistent().set(&counter_key, &counter);
        ttl::extend(&env, &escrow_key(&env, counter), TtlPolicy::UserEntry);
        ttl::extend(&env, &(Symbol::new(&env, "b_esc"), bounty_id), TtlPolicy::UserEntry);
        ttl::extend(&env, &counter_key, TtlPolicy::Config);

        // Emit escrow_deposited event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("deposited")),
            (counter, bounty_id, escrow.payer.clone(), escrow.payee.clone(), net_amount, fee),
        );

        Ok(counter)
    }

    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<EscrowAccount, EscrowError> {
        load_escrow(&env, escrow_id)
    }

    /// Release funds to payee. Authorizer must be payer or payee.
    pub fn release_funds(env: Env, authorizer: Address, escrow_id: u64) -> Result<bool, EscrowError> {
        // CHECKS
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let key = escrow_key(&env, escrow_id);
        let mut escrow = load_escrow(&env, escrow_id)?;

        ensure(
            authorizer == escrow.payer || authorizer == escrow.payee,
            EscrowError::Unauthorized,
        )?;
        ensure(!is_bound(&env, escrow_id), EscrowError::ManagedByBounty)?;
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;
        ensure(Self::can_release(env.clone(), escrow_id)?, EscrowError::ReleaseConditionNotMet)?;
        // #1712: never pay out amounts already released through milestones.
        let remaining = remaining_amount(&env, &escrow);

        // EFFECTS – mutate state before any cross-contract call

        // Issue #725: Oracle price freshness check before release
        if let Some(oracle_addr) = env.storage().persistent().get::<DataKey, Address>(&DataKey::OracleAddress) {
            let max_staleness = Self::get_oracle_staleness_secs(&env);
            let price_data: OraclePriceData = env.invoke_contract(
                &oracle_addr,
                &Symbol::new(&env, "get_price"),
                soroban_sdk::Vec::new(&env),
            );
            let age_secs = env.ledger().timestamp().saturating_sub(price_data.timestamp);
            ensure(age_secs <= max_staleness, EscrowError::OraclePriceStale)?;
        }

        escrow.status = EscrowStatus::Released;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // INTERACTIONS – external call after state is finalised
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &remaining);

        // Emit escrow_released event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("released")),
            (escrow_id, escrow.bounty_id, escrow.payee.clone(), remaining),
        );

        Ok(true)
    }

    /// Refund escrow to payer. Only payer may call.
    pub fn refund_escrow(env: Env, authorizer: Address, escrow_id: u64) -> Result<bool, EscrowError> {
        // CHECKS
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let key = escrow_key(&env, escrow_id);
        let mut escrow = load_escrow(&env, escrow_id)?;

        ensure(authorizer == escrow.payer, EscrowError::Unauthorized)?;
        ensure(!is_bound(&env, escrow_id), EscrowError::ManagedByBounty)?;
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;
        // #1712: never pay out amounts already released through milestones.
        let remaining = remaining_amount(&env, &escrow);

        // EFFECTS – mutate state before any cross-contract call
        escrow.status = EscrowStatus::Refunded;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // INTERACTIONS – external call after state is finalised
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payer, &remaining);

        // Emit escrow_refunded event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refunded")),
            (escrow_id, escrow.bounty_id, escrow.payer.clone(), remaining),
        );

        Ok(true)
    }

    /// Refund an expired bounty's escrow to the payer. Called by the bounty
    /// contract when expiring. #1714: `bounty_contract` must be the contract
    /// registered via `set_bounty_contract` (any contract used to be able to
    /// refund any bounty's escrow). Kept for older bounty deployments; new
    /// ones call `refund_for_bounty`.
    pub fn refund_expired_bounty(env: Env, bounty_id: u64, bounty_contract: Address) -> Result<bool, EscrowError> {
        require_bounty_contract(&env, &bounty_contract)?;
        Self::refund_bound(&env, bounty_id)
    }

    // ── Issue #1714: bounty × escrow joint state machine ─────────────────────
    //
    // An escrow bound to a bounty can only leave `Active` through the bounty
    // contract, in the same transaction as the bounty transition:
    //
    //   bounty complete_bounty         -> escrow release_for_bounty (Released)
    //   bounty cancel / expire         -> escrow refund_for_bounty  (Refunded)
    //
    // Direct `release_funds`, `refund_escrow`, `dispute_escrow` and
    // `submit_transaction` calls on a bound escrow fail with `ManagedByBounty`.

    /// Register the bounty contract trusted to drive bound escrows. Admin-only.
    pub fn set_bounty_contract(env: Env, admin: Address, bounty_contract: Address) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        env.storage().persistent().set(&DataKey::BountyContract, &bounty_contract);
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("bnty_set")),
            bounty_contract,
        );
        Ok(())
    }

    pub fn get_bounty_contract(env: Env) -> Option<Address> {
        env.storage().persistent().get::<DataKey, Address>(&DataKey::BountyContract)
    }

    /// Bind an Active escrow to a bounty. Only the bounty contract may call;
    /// the escrow must have been deposited for `bounty_id` by `creator`, and
    /// neither side may already be bound.
    pub fn bind_bounty(
        env: Env,
        bounty_contract: Address,
        bounty_id: u64,
        escrow_id: u64,
        creator: Address,
    ) -> Result<bool, EscrowError> {
        require_bounty_contract(&env, &bounty_contract)?;
        let escrow = load_escrow(&env, escrow_id)?;
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;
        ensure(
            escrow.bounty_id == bounty_id && escrow.payer == creator,
            EscrowError::BountyMismatch,
        )?;
        ensure(
            !is_bound(&env, escrow_id)
                && !env.storage().persistent().has(&DataKey::BoundEscrow(bounty_id)),
            EscrowError::EscrowAlreadyBound,
        )?;

        env.storage().persistent().set(&DataKey::BoundEscrow(bounty_id), &escrow_id);
        env.storage().persistent().set(&DataKey::EscrowBound(escrow_id), &bounty_id);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("bound")),
            (escrow_id, bounty_id),
        );
        Ok(true)
    }

    /// Escrow id bound to `bounty_id`, or 0.
    pub fn get_bound_escrow(env: Env, bounty_id: u64) -> u64 {
        env.storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::BoundEscrow(bounty_id))
            .unwrap_or(0)
    }

    /// Status of an escrow (cheap view used by the bounty contract's
    /// joint-state invariant check).
    pub fn get_escrow_status(env: Env, escrow_id: u64) -> Result<EscrowStatus, EscrowError> {
        Ok(load_escrow(&env, escrow_id)?.status)
    }

    /// Pay a bound escrow out to `payee` (the selected freelancer). Called by
    /// the bounty contract from `complete_bounty`.
    pub fn release_for_bounty(
        env: Env,
        bounty_contract: Address,
        bounty_id: u64,
        payee: Address,
    ) -> Result<bool, EscrowError> {
        require_bounty_contract(&env, &bounty_contract)?;
        let _guard = ReentrancyGuard::acquire(&env);

        let escrow_id = bound_escrow_id(&env, bounty_id)?;
        let key = escrow_key(&env, escrow_id);
        let mut escrow = load_escrow(&env, escrow_id)?;
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;
        ensure(Self::can_release(env.clone(), escrow_id)?, EscrowError::ReleaseConditionNotMet)?;

        // EFFECTS
        escrow.payee = payee;
        escrow.status = EscrowStatus::Released;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // INTERACTIONS
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &escrow.amount);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("released")),
            (escrow_id, bounty_id, escrow.payee.clone(), escrow.amount),
        );
        Ok(true)
    }

    /// Refund a bound escrow to the payer. Called by the bounty contract from
    /// `cancel_bounty` / `check_and_expire_bounty`.
    pub fn refund_for_bounty(env: Env, bounty_contract: Address, bounty_id: u64) -> Result<bool, EscrowError> {
        require_bounty_contract(&env, &bounty_contract)?;
        Self::refund_bound(&env, bounty_id)
    }

    fn refund_bound(env: &Env, bounty_id: u64) -> Result<bool, EscrowError> {
        let _guard = ReentrancyGuard::acquire(env);

        let escrow_id = match env.storage().persistent().get::<DataKey, u64>(&DataKey::BoundEscrow(bounty_id)) {
            Some(id) => id,
            None => Self::get_escrow_id_for_bounty(env.clone(), bounty_id),
        };
        ensure(escrow_id > 0, EscrowError::NoEscrowForBounty)?;

        let key = escrow_key(env, escrow_id);
        let mut escrow = load_escrow(env, escrow_id)?;
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;

        // EFFECTS – state first, then the transfer.
        escrow.status = EscrowStatus::Refunded;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        TokenClient::new(env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refunded")),
            (escrow_id, bounty_id, escrow.payer.clone(), remaining),
        );
        Ok(true)
    }

    // ── Issue #1715: token allowlist ──────────────────────────────────────────

    /// Add `token` to the deposit allowlist. Admin-only.
    pub fn allow_token(env: Env, admin: Address, token: Address) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        env.storage().persistent().set(&DataKey::AllowedToken(token.clone()), &true);
        env.events().publish((symbol_short!("token"), symbol_short!("allowed")), token);
        Ok(())
    }

    /// Remove `token` from the deposit allowlist. Existing escrows in that
    /// token can still be released or refunded. Admin-only.
    pub fn disallow_token(env: Env, admin: Address, token: Address) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        env.storage().persistent().remove(&DataKey::AllowedToken(token.clone()));
        env.events().publish((symbol_short!("token"), symbol_short!("removed")), token);
        Ok(())
    }

    pub fn is_token_allowed(env: Env, token: Address) -> bool {
        env.storage().persistent().has(&DataKey::AllowedToken(token))
    }

    /// Mark escrow as disputed. Either party may raise a dispute.
    pub fn dispute_escrow(env: Env, authorizer: Address, escrow_id: u64) -> Result<bool, EscrowError> {
        authorizer.require_auth();

        let key = escrow_key(&env, escrow_id);
        let mut escrow = load_escrow(&env, escrow_id)?;

        ensure(
            authorizer == escrow.payer || authorizer == escrow.payee,
            EscrowError::Unauthorized,
        )?;
        // #1714: a bound escrow's lifecycle follows its bounty.
        ensure(!is_bound(&env, escrow_id), EscrowError::ManagedByBounty)?;
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &escrow);

        // #731: record when this dispute expires (created_at + 30 days)
        let expires_at = env.ledger().timestamp() + DISPUTE_TIMEOUT_SECS;
        env.storage()
            .persistent()
            .set(&DataKey::DisputeExpiry(escrow_id), &expires_at);
        ttl::extend(&env, &DataKey::DisputeExpiry(escrow_id), TtlPolicy::UserEntry);

        // Emit escrow_disputed event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("disputed")),
            (escrow_id, escrow.bounty_id, authorizer, expires_at),
        );

        // #1713: draw an arbiter panel right away when the pool allows it.
        // If it doesn't, `open_dispute_case` can be called later, and
        // `resolve_expired_dispute` is the fallback after the expiry window.
        if arbitration::load_config(&env).is_ok() {
            let _ = arbitration::open_case(&env, &escrow);
        }

        Ok(true)
    }

    // ── Issue #1713: per-dispute arbitration ─────────────────────────────────
    //
    // The admin-only `resolve_dispute` and the global `set_dispute_split` are
    // gone. Outcomes are decided per dispute by a randomly drawn, staked
    // arbiter panel using commit-reveal voting, with one appeal to a larger
    // panel. See docs/escrow-arbitration.md.

    /// One-time setup of the arbiter stake token and minimum stake. The admin
    /// cannot change it later and has no say in any outcome.
    pub fn configure_arbitration(env: Env, admin: Address, stake_token: Address, min_stake: i128) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        arbitration::configure(&env, stake_token, min_stake)
    }

    pub fn get_arbitration_config(env: Env) -> Result<ArbitrationConfig, EscrowError> {
        arbitration::load_config(&env)
    }

    /// Stake `amount` of the stake token to join (or top up in) the arbiter pool.
    pub fn register_arbiter(env: Env, arbiter: Address, amount: i128) -> Result<Arbiter, EscrowError> {
        arbiter.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);
        arbitration::register(&env, arbiter, amount)
    }

    /// Withdraw stake. Not allowed while the arbiter sits on an open panel.
    pub fn withdraw_arbiter_stake(env: Env, arbiter: Address, amount: i128) -> Result<i128, EscrowError> {
        arbiter.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);
        arbitration::withdraw(&env, arbiter, amount)
    }

    pub fn get_arbiter(env: Env, arbiter: Address) -> Result<Arbiter, EscrowError> {
        arbitration::load_arbiter(&env, &arbiter)
    }

    /// Draw a panel for a disputed escrow that has none yet (e.g. the pool was
    /// too small when the dispute was raised). Anyone may call.
    pub fn open_dispute_case(env: Env, escrow_id: u64) -> Result<DisputeCase, EscrowError> {
        let escrow = load_escrow(&env, escrow_id)?;
        ensure(escrow.status == EscrowStatus::Disputed, EscrowError::EscrowNotDisputed)?;
        arbitration::open_case(&env, &escrow)
    }

    pub fn get_dispute_case(env: Env, escrow_id: u64) -> Result<DisputeCase, EscrowError> {
        arbitration::load_case(&env, escrow_id)
    }

    /// Anchor an evidence hash on-chain. `hash` is the sha256 returned by
    /// `POST /api/disputes/:id/evidence` (`evidenceHash`). Payer or payee only.
    pub fn submit_evidence(env: Env, party: Address, escrow_id: u64, hash: BytesN<32>) -> Result<u32, EscrowError> {
        party.require_auth();
        let escrow = load_escrow(&env, escrow_id)?;
        ensure(party == escrow.payer || party == escrow.payee, EscrowError::Unauthorized)?;
        ensure(escrow.status == EscrowStatus::Disputed, EscrowError::EscrowNotDisputed)?;
        arbitration::submit_evidence(&env, escrow_id, party, hash)
    }

    pub fn get_evidence(env: Env, escrow_id: u64) -> Vec<Evidence> {
        arbitration::load_evidence(&env, escrow_id)
    }

        // #1711: record the verified outcome for insurance claims.
        let (payer_amount, payee_amount) = if release_to_payee {
            (0, escrow.amount)
        } else {
            (escrow.amount, 0)
        };
        record_dispute_outcome(&env, &escrow, payer_amount, payee_amount);

        // Emit dispute_resolved event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("resolved")),
            (escrow_id, escrow.bounty_id, recipient, release_to_payee),
        );

    /// Reveal a committed vote between the commit and reveal deadlines.
    pub fn reveal_vote(env: Env, arbiter: Address, escrow_id: u64, payee_bps: u32, salt: BytesN<32>) -> Result<(), EscrowError> {
        arbiter.require_auth();
        arbitration::reveal(&env, escrow_id, arbiter, payee_bps, salt)
    }

    /// Close the current round after its reveal deadline. Anyone may call.
    /// Round 0 produces an appealable ruling; an appeal round's ruling is
    /// final and paid out immediately.
    pub fn tally_dispute(env: Env, escrow_id: u64) -> Result<DisputeCase, EscrowError> {
        let _guard = ReentrancyGuard::acquire(&env);
        let mut escrow = load_escrow(&env, escrow_id)?;
        ensure(escrow.status == EscrowStatus::Disputed, EscrowError::EscrowNotDisputed)?;
        let case = arbitration::tally(&env, &escrow)?;
        if case.phase == CasePhase::Final {
            if let Some(bps) = case.ruling_bps {
                settle_dispute(&env, &mut escrow, bps);
            }
        }
        Ok(case)
    }

    /// Appeal a round-0 ruling within the appeal window. Payer or payee only.
    /// Draws a fresh, larger panel that excludes the first panel.
    pub fn appeal_ruling(env: Env, party: Address, escrow_id: u64) -> Result<DisputeCase, EscrowError> {
        party.require_auth();
        let escrow = load_escrow(&env, escrow_id)?;
        ensure(party == escrow.payer || party == escrow.payee, EscrowError::Unauthorized)?;
        ensure(escrow.status == EscrowStatus::Disputed, EscrowError::EscrowNotDisputed)?;
        arbitration::appeal(&env, &escrow, party)
    }

    /// Pay out an unappealed round-0 ruling once the appeal window closes.
    /// Anyone may call.
    pub fn execute_ruling(env: Env, escrow_id: u64) -> Result<bool, EscrowError> {
        let _guard = ReentrancyGuard::acquire(&env);
        let mut escrow = load_escrow(&env, escrow_id)?;
        ensure(escrow.status == EscrowStatus::Disputed, EscrowError::EscrowNotDisputed)?;
        let bps = arbitration::finalize_unappealed(&env, escrow_id)?;
        settle_dispute(&env, &mut escrow, bps);
        Ok(true)
    }

    /// Fallback for a dispute that never got a panel (no or too few arbiters)
    /// once its expiry window has elapsed: fixed 50/50 split. Anyone may call.
    ///
    /// Fails with:
    ///   - `EscrowNotDisputed` if escrow is not in Disputed state
    ///   - `CaseAlreadyOpen` if an arbiter panel is handling the dispute
    ///   - `DisputeNotExpired` if the expiry window has not yet elapsed
    pub fn resolve_expired_dispute(env: Env, escrow_id: u64) -> Result<bool, EscrowError> {
        let _guard = ReentrancyGuard::acquire(&env);

        let mut escrow = load_escrow(&env, escrow_id)?;

        ensure(escrow.status == EscrowStatus::Disputed, EscrowError::EscrowNotDisputed)?;
        ensure(!arbitration::has_case(&env, escrow_id), EscrowError::CaseAlreadyOpen)?;

        let expires_at: u64 = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::DisputeExpiry(escrow_id))
            .ok_or(EscrowError::DisputeExpiryMissing)?;

        ensure(env.ledger().timestamp() >= expires_at, EscrowError::DisputeNotExpired)?;

        let (payee_amount, payer_amount) = settle_dispute(&env, &mut escrow, arbitration::DEFAULT_PAYEE_BPS);

        escrow.status = EscrowStatus::Refunded; // closest semantic: funds dispersed
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);
        record_dispute_outcome(&env, &escrow, payer_amount, payee_amount);

        // Emit dispute_auto_resolved event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("auto_res")),
            (escrow_id, escrow.bounty_id, payee_amount, payer_amount),
        );

        Ok(true)
    }

    /// Verified outcome of a resolved dispute, if the escrow was disputed and
    /// settled (#1711). `None` for escrows that were never disputed or are
    /// still in dispute.
    pub fn get_dispute_outcome(env: Env, escrow_id: u64) -> Option<DisputeOutcome> {
        env.storage()
            .persistent()
            .get::<DataKey, DisputeOutcome>(&DataKey::DisputeOutcome(escrow_id))
    }

    /// Set the platform admin address. Can only be called once (bootstrap).
    pub fn set_admin(env: Env, admin: Address) -> Result<(), EscrowError> {
        admin.require_auth();
        let admin_key = Symbol::new(&env, "platform_admin");
        ensure(
            env.storage().persistent().get::<Symbol, Address>(&admin_key).is_none(),
            EscrowError::AdminAlreadySet,
        )?;
        env.storage().persistent().set(&admin_key, &admin);
        Ok(())
    }

    /// Get the current platform admin address.
    pub fn get_admin(env: Env) -> Result<Address, EscrowError> {
        stored_admin(&env)
    }

    /// Add a milestone to an active escrow.
    ///
    /// The running total may not exceed the escrow amount. Milestones cannot
    /// be released until the plan sums to the escrow amount exactly; when the
    /// last milestone brings the total to the escrow amount the deposit fee is
    /// allocated across milestones and `(escrow, ms_plan)` is emitted (#1712).
    pub fn add_milestone(
        env: Env,
        authorizer: Address,
        escrow_id: u64,
        index: u32,
        description: Symbol,
        amount: i128,
    ) -> Result<(), EscrowError> {
        authorizer.require_auth();

        let escrow = load_escrow(&env, escrow_id)?;
        ensure(authorizer == escrow.payer, EscrowError::Unauthorized)?;
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;
        ensure(amount > 0, EscrowError::InvalidAmount)?;
        ensure(amount <= escrow.amount, EscrowError::MilestoneExceedsEscrow)?;

        let total_key = DataKey::MilestoneTotal(escrow_id);
        let current_total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
        let new_total = current_total
            .checked_add(amount)
            .ok_or(EscrowError::InvalidAmount)?;
        ensure(new_total <= escrow.amount, EscrowError::MilestoneExceedsEscrow)?;

        let m_key = milestone_key(&env, escrow_id, index);
        ensure(
            env.storage().persistent().get::<(Symbol, u64, u32), Milestone>(&m_key).is_none(),
            EscrowError::MilestoneAlreadyExists,
        )?;

        let mut indices = milestone_indices(&env, escrow_id);
        ensure(indices.len() < MAX_MILESTONES, EscrowError::TooManyMilestones)?;
        indices.push_back(index);
        env.storage().persistent().set(&DataKey::MilestoneIndices(escrow_id), &indices);

        env.storage().persistent().set(&total_key, &new_total);

        let count_key = DataKey::MilestoneCount(escrow_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        env.storage().persistent().set(&count_key, &(count + 1));

        let milestone = Milestone { escrow_id, index, description, amount, released: false, fee_share: 0 };
        env.storage().persistent().set(&m_key, &milestone);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("ms_add")),
            (escrow_id, index, amount, new_total),
        );

        if new_total == escrow.amount {
            allocate_milestone_fees(&env, &escrow);
        }
        Ok(())
    }

    /// Re-split the milestone plan before any milestone is released.
    ///
    /// `indices[i]` gets `amounts[i]`. Every listed index must exist; the plan
    /// total after the amendment must equal the escrow amount exactly, and the
    /// fee is re-allocated. Payer-only. Emits `(escrow, ms_amend)` (#1712).
    pub fn amend_milestones(
        env: Env,
        authorizer: Address,
        escrow_id: u64,
        indices: soroban_sdk::Vec<u32>,
        amounts: soroban_sdk::Vec<i128>,
    ) -> Result<(), EscrowError> {
        authorizer.require_auth();

        let escrow = load_escrow(&env, escrow_id)?;
        ensure(authorizer == escrow.payer, EscrowError::Unauthorized)?;
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;
        ensure(indices.len() == amounts.len(), EscrowError::InvalidAmount)?;
        let released: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneReleasedCount(escrow_id))
            .unwrap_or(0);
        ensure(released == 0, EscrowError::MilestoneAmendLocked)?;

        for (pos, index) in indices.iter().enumerate() {
            let amount = amounts.get_unchecked(pos as u32);
            ensure(amount > 0, EscrowError::InvalidAmount)?;
            let key = milestone_key(&env, escrow_id, index);
            let mut m: Milestone = env
                .storage()
                .persistent()
                .get(&key)
                .ok_or(EscrowError::MilestoneNotFound)?;
            m.amount = amount;
            env.storage().persistent().set(&key, &m);
        }

        let mut total: i128 = 0;
        for index in milestone_indices(&env, escrow_id).iter() {
            let m: Milestone = env.storage().persistent().get(&milestone_key(&env, escrow_id, index)).unwrap();
            total = total.checked_add(m.amount).ok_or(EscrowError::InvalidAmount)?;
        }
        // Any failure here reverts every write above.
        ensure(total == escrow.amount, EscrowError::MilestoneSumMismatch)?;
        env.storage().persistent().set(&DataKey::MilestoneTotal(escrow_id), &total);

        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("ms_amend")),
            (escrow_id, indices.len(), total),
        );
        allocate_milestone_fees(&env, &escrow);
        Ok(())
    }

    /// Release a single milestone payment to payee. Authorizer must be payer.
    ///
    /// Requires the milestone plan to sum to the escrow amount
    /// (`MilestoneSumMismatch` otherwise). Emits `(escrow, ms_rel)` with
    /// `(escrow_id, index, payee, gross, fee, net)` where `net` is the amount
    /// transferred and `fee` the milestone's share of the deposit fee.
    pub fn release_milestone(env: Env, authorizer: Address, escrow_id: u64, index: u32) -> Result<bool, EscrowError> {
        // CHECKS
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let escrow = load_escrow(&env, escrow_id)?;
        require_authorized_party(authorizer == escrow.payer, EscrowError::Unauthorized)?;
        ensure(!is_bound(&env, escrow_id), EscrowError::ManagedByBounty)?;

        let m_key = milestone_key(&env, escrow_id, index);
        let mut milestone = env.storage().persistent()
            .get::<(Symbol, u64, u32), Milestone>(&m_key)
            .ok_or(EscrowError::MilestoneNotFound)?;

        ensure(!milestone.released, EscrowError::MilestoneAlreadyReleased)?;
        require_active_escrow(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;

        let plan_total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneTotal(escrow_id))
            .unwrap_or(0);
        ensure(plan_total == escrow.amount, EscrowError::MilestoneSumMismatch)?;

        // EFFECTS – mark released before the token transfer
        milestone.released = true;
        env.storage().persistent().set(&m_key, &milestone);

        // INTERACTIONS – external call after state is finalised
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &milestone.amount);

        // Emit milestone_released event for indexers: gross / fee / net.
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("ms_rel")),
            (
                escrow_id,
                index,
                escrow.payee.clone(),
                milestone.amount + milestone.fee_share,
                milestone.fee_share,
                milestone.amount,
            ),
        );

        let released_key = DataKey::MilestoneReleasedCount(escrow_id);
        let released_count: u32 = env.storage().persistent().get(&released_key).unwrap_or(0) + 1;
        env.storage().persistent().set(&released_key, &released_count);

        let released_amt_key = DataKey::MilestoneReleasedAmount(escrow_id);
        let released_amount: i128 = env
            .storage()
            .persistent()
            .get(&released_amt_key)
            .unwrap_or(0)
            + milestone.amount;
        env.storage().persistent().set(&released_amt_key, &released_amount);

        let milestone_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneCount(escrow_id))
            .unwrap_or(0);

        if milestone_count > 0 && released_count >= milestone_count {
            let mut updated_escrow = load_escrow(&env, escrow_id)?;
            updated_escrow.status = EscrowStatus::Complete;
            updated_escrow.released_at = Some(env.ledger().timestamp());
            env.storage().persistent().set(&escrow_key(&env, escrow_id), &updated_escrow);

            env.events().publish(
                (symbol_short!("escrow"), symbol_short!("complete")),
                (escrow_id, updated_escrow.bounty_id),
            );
        }

        Ok(true)
    }

    /// Returns milestone progress for an escrow: (released_count, milestone_count, released_amount, total_amount).
    pub fn get_milestone_progress(env: Env, escrow_id: u64) -> (u32, u32, i128, i128) {
        let released_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneReleasedCount(escrow_id))
            .unwrap_or(0);
        let milestone_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneCount(escrow_id))
            .unwrap_or(0);
        let total_amount: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneTotal(escrow_id))
            .unwrap_or(0);
        let released_amount: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::MilestoneReleasedAmount(escrow_id))
            .unwrap_or(0);

        (released_count, milestone_count, released_amount, total_amount)
    }

    pub fn get_milestone(env: Env, escrow_id: u64, index: u32) -> Result<Milestone, EscrowError> {
        env.storage()
            .persistent()
            .get::<(Symbol, u64, u32), Milestone>(&milestone_key(&env, escrow_id, index))
            .ok_or(EscrowError::MilestoneNotFound)
    }

    /// Milestone indices of an escrow, in creation order.
    pub fn get_milestone_indices(env: Env, escrow_id: u64) -> soroban_sdk::Vec<u32> {
        milestone_indices(&env, escrow_id)
    }

    pub fn can_release(env: Env, escrow_id: u64) -> Result<bool, EscrowError> {
        let escrow = load_escrow(&env, escrow_id)?;
        Ok(match escrow.release_condition {
            ReleaseCondition::OnCompletion => true,
            ReleaseCondition::Timelock(deadline) => env.ledger().timestamp() >= deadline,
        })
    }

    /// Return the platform fee that would be charged for a given gross amount.
    /// Mirrors the `platform_fee` free function for on-chain queries.
    pub fn calculate_fee(_env: Env, gross_amount: i128) -> i128 {
        platform_fee(gross_amount)
    }

    pub fn get_active_escrows_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get::<Symbol, u64>(&Symbol::new(&env, "escrow_counter"))
            .unwrap_or(0)
    }

    /// Get the latest escrow ID for a specific bounty.
    pub fn get_escrow_id_for_bounty(env: Env, bounty_id: u64) -> u64 {
        env.storage()
            .persistent()
            .get::<(Symbol, u64), u64>(&(Symbol::new(&env, "b_esc"), bounty_id))
            .unwrap_or(0)
    }

    /// Submit a Stellar transaction for an escrow operation.
    ///
    /// This is the on-chain entry point called by the backend Stellar SDK
    /// after building and signing a transaction envelope. It validates the
    /// operation type and delegates to the appropriate escrow function.
    ///
    /// `operation`: one of "release", "refund", "dispute". "deposit" and any
    /// other value fail with `UnsupportedOperation` (use `deposit()` directly).
    /// `escrow_id`: target escrow
    /// Returns the escrow_id that was acted upon.
    pub fn submit_transaction(
        env: Env,
        caller: Address,
        operation: Symbol,
        escrow_id: u64,
    ) -> Result<u64, EscrowError> {
        caller.require_auth();

        let op_release = Symbol::new(&env, "release");
        let op_refund = Symbol::new(&env, "refund");
        let op_dispute = Symbol::new(&env, "dispute");

        if operation == op_release {
            Self::release_funds(env.clone(), caller.clone(), escrow_id)?;
        } else if operation == op_refund {
            Self::refund_escrow(env.clone(), caller.clone(), escrow_id)?;
        } else if operation == op_dispute {
            Self::dispute_escrow(env.clone(), caller.clone(), escrow_id)?;
        } else {
            // Deny-by-default: "deposit" needs more params than this entrypoint
            // takes, and anything else is unknown.
            return Err(EscrowError::UnsupportedOperation);
        }

        // Emit a generic transaction_submitted event for the indexer
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("tx_sub")),
            (escrow_id, operation, caller),
        );

        Ok(escrow_id)
    }

    // ── Issue #754: Yield Farming Pause ────────────────────────────────────────

    pub fn pause_yield(env: Env, admin: Address) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;

        env.storage().persistent().set(&DataKey::YieldPaused, &true);

        env.events().publish(
            (symbol_short!("yield"), symbol_short!("paused")),
            (),
        );
        Ok(())
    }

    pub fn unpause_yield(env: Env, admin: Address) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;

        env.storage().persistent().set(&DataKey::YieldPaused, &false);

        env.events().publish(
            (symbol_short!("yield"), symbol_short!("resumed")),
            (),
        );
        Ok(())
    }

    pub fn is_yield_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::YieldPaused)
            .unwrap_or(false)
    }

    // ── Issue #631: Yield Farming ─────────────────────────────────────────────

    /// Set yield configuration.  Only the platform admin may call this.
    pub fn configure_yield(
        env: Env,
        admin: Address,
        rate_bps: u32,
        max_yield_ratio: u32,
        min_liquidity_bps: u32,
    ) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        ensure(rate_bps <= 10_000, EscrowError::InvalidBps)?;
        ensure(max_yield_ratio <= 10_000, EscrowError::InvalidBps)?;
        ensure(min_liquidity_bps <= 10_000, EscrowError::InvalidBps)?;

        // Preserve any existing slippage tolerance rather than resetting it —
        // slippage is configured independently via `configure_slippage`.
        let max_slippage_bps = env
            .storage()
            .persistent()
            .get::<DataKey, YieldConfig>(&DataKey::YieldCfg)
            .map(|c| c.max_slippage_bps)
            .unwrap_or(DEFAULT_MAX_SLIPPAGE_BPS);

        env.storage().persistent().set(&DataKey::YieldCfg, &YieldConfig {
            rate_bps,
            max_yield_ratio,
            min_liquidity_bps,
            max_slippage_bps,
        });
        Ok(())
    }

    /// Update the maximum acceptable slippage (bps) for yield-protocol
    /// deposits. Only the platform admin may call this. Defaults to
    /// `DEFAULT_MAX_SLIPPAGE_BPS` (1 %) until explicitly configured.
    pub fn configure_slippage(env: Env, admin: Address, max_slippage_bps: u32) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        ensure(max_slippage_bps <= 10_000, EscrowError::InvalidBps)?;

        let mut cfg: YieldConfig = env
            .storage()
            .persistent()
            .get::<DataKey, YieldConfig>(&DataKey::YieldCfg)
            .unwrap_or(YieldConfig {
                rate_bps: 0,
                max_yield_ratio: 0,
                min_liquidity_bps: 0,
                max_slippage_bps: DEFAULT_MAX_SLIPPAGE_BPS,
            });
        cfg.max_slippage_bps = max_slippage_bps;
        env.storage().persistent().set(&DataKey::YieldCfg, &cfg);

        env.events().publish(
            (symbol_short!("yield"), symbol_short!("slippage")),
            max_slippage_bps,
        );
        Ok(())
    }

    /// Accrue yield for an active escrow strictly within the contract.
    ///
    /// Yield is calculated as a pro-rata share of the annual rate scaled to the
    /// elapsed seconds since `last_updated`.  The accrual is capped at
    /// `max_yield_ratio` of the principal to prevent unbounded growth.
    ///
    /// No tokens move during accrual — the number is a credit held internally.
    pub fn accrue_yield(env: Env, escrow_id: u64) -> Result<(), EscrowError> {
        ensure(!Self::is_yield_paused(env.clone()), EscrowError::YieldPaused)?;

        let cfg: YieldConfig = env
            .storage()
            .persistent()
            .get::<DataKey, YieldConfig>(&DataKey::YieldCfg)
            .ok_or(EscrowError::YieldNotConfigured)?;

        let escrow = load_escrow(&env, escrow_id)?;

        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;

        let now = env.ledger().timestamp();
        let yield_key = DataKey::Yield(escrow_id);

        let mut accrual: YieldAccrual = env
            .storage()
            .persistent()
            .get::<DataKey, YieldAccrual>(&yield_key)
            .unwrap_or(YieldAccrual {
                escrow_id,
                principal: escrow.amount,
                accrued: 0,
                last_updated: escrow.created_at,
            });

        let elapsed = now.saturating_sub(accrual.last_updated);
        if elapsed == 0 {
            return Ok(());
        }

        // new_yield = principal * rate_bps * elapsed / (10_000 * SECONDS_PER_YEAR)
        const SECONDS_PER_YEAR: u64 = 365 * 24 * 3600;
        let new_yield = accrual.principal
            * (cfg.rate_bps as i128)
            * (elapsed as i128)
            / (10_000_i128 * SECONDS_PER_YEAR as i128);

        accrual.accrued = accrual.accrued.saturating_add(new_yield);

        // Apply max yield cap: accrued must not exceed max_yield_ratio of principal
        let yield_cap = accrual.principal * (cfg.max_yield_ratio as i128) / 10_000;
        if accrual.accrued > yield_cap {
            accrual.accrued = yield_cap;
        }

        accrual.last_updated = now;
        env.storage().persistent().set(&yield_key, &accrual);

        env.events().publish(
            (symbol_short!("yield"), symbol_short!("accrued")),
            (escrow_id, new_yield, accrual.accrued),
        );
        Ok(())
    }

    /// Read the currently accrued yield for an escrow without modifying state.
    pub fn get_accrued_yield(env: Env, escrow_id: u64) -> i128 {
        env.storage()
            .persistent()
            .get::<DataKey, YieldAccrual>(&DataKey::Yield(escrow_id))
            .map(|a| a.accrued)
            .unwrap_or(0)
    }

    /// Withdraw accrued yield to the platform admin.
    ///
    /// Slashing protection: the withdrawal is rejected if it would leave the
    /// contract holding less than `min_liquidity_bps` of the escrow principal,
    /// ensuring payers can always retrieve their funds.
    pub fn withdraw_yield(env: Env, admin: Address, escrow_id: u64) -> Result<i128, EscrowError> {
        admin.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        require_admin(&env, &admin)?;

        let cfg: YieldConfig = env
            .storage()
            .persistent()
            .get::<DataKey, YieldConfig>(&DataKey::YieldCfg)
            .ok_or(EscrowError::YieldNotConfigured)?;

        let yield_key = DataKey::Yield(escrow_id);
        let mut accrual: YieldAccrual = env
            .storage()
            .persistent()
            .get::<DataKey, YieldAccrual>(&yield_key)
            .ok_or(EscrowError::YieldAccrualNotFound)?;

        ensure(accrual.accrued > 0, EscrowError::NoYieldToWithdraw)?;

        // Liquidity guarantee: after withdrawal, at least min_liquidity_bps of
        // the principal must remain available in the contract.
        let min_liquidity = accrual.principal * (cfg.min_liquidity_bps as i128) / 10_000;
        let escrow = load_escrow(&env, escrow_id)?;

        ensure(escrow.amount >= min_liquidity, EscrowError::InsufficientLiquidity)?;

        let to_withdraw = accrual.accrued;
        accrual.accrued = 0;
        env.storage().persistent().set(&yield_key, &accrual);

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &admin, &to_withdraw);

        env.events().publish(
            (symbol_short!("yield"), symbol_short!("withdrawn")),
            (escrow_id, to_withdraw, admin),
        );

        Ok(to_withdraw)
    }

    /// Quote the platform fee for funding an escrow with `amount`.
    ///
    /// Uses the fee config effective *now*. Pass the result (plus any
    /// tolerance the user accepts) as `max_fee` to `deposit_with_max_fee`: if
    /// governance raises the fee before the transaction lands, the deposit
    /// reverts instead of over-charging (#1724). Fee increases are also
    /// timelocked by `FEE_CHANGE_DELAY_SECS`; see `get_pending_fee_config`.
    pub fn estimate_fund_escrow_fee(env: Env, amount: i128) -> i128 {
        platform_fee_with_config(amount, &get_fee_config(&env))
    }

    // ── Issue #1564: Timelocked upgrade + two-step admin transfer ─────────────
    //
    // Replaces the old instant `upgrade` entrypoint. Shared logic lives in
    // `stellar-upgradeable`; see docs/contracts.md (Upgrading a live contract).

    /// Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
    /// which `execute_upgrade` may be called (now + 48h). Emits
    /// `(upgrade, proposed)`.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> u64 {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set");
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set");
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set");
        stellar_upgradeable::cancel_upgrade(&env, &admin, &stored_admin);
    }

    /// The upgrade currently waiting out its timelock, if any.
    pub fn get_pending_upgrade(env: Env) -> Option<stellar_upgradeable::PendingUpgrade> {
        stellar_upgradeable::pending_upgrade(&env)
    }

    /// Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set");
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set");
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &stored_admin);
        env.storage().persistent().set(&Symbol::new(&env, "platform_admin"), &accepted);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<Symbol, Address>(&Symbol::new(&env, "platform_admin"))
            .expect("Platform admin not set");
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }

    // ---- Issue #722: Governance-controlled platform fee update ----

    /// Update the platform fee configuration. Only the governance multisig
    /// (platform admin) may call this.
    ///
    /// #1724: a change that lowers (or keeps) both the rate and the cap applies
    /// immediately and emits `(escrow, fee_upd)`. A change that raises either
    /// is scheduled for `now + FEE_CHANGE_DELAY_SECS` and announced with
    /// `(escrow, fee_prop)`; it becomes effective automatically once the delay
    /// elapses (and can be persisted with `apply_fee_update`). A new call
    /// replaces any pending change.
    pub fn update_fee(env: Env, admin: Address, new_bps: i128, new_cap: i128) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        // Fee BPS must be within 0..=1_000 (10%) and the cap non-negative.
        ensure((0..=1_000).contains(&new_bps), EscrowError::InvalidFeeConfig)?;
        ensure(new_cap >= 0, EscrowError::InvalidFeeConfig)?;
        let current = get_fee_config(&env);
        let new_cfg = FeeConfig { fee_bps: new_bps, fee_cap: new_cap };
        let store = env.storage().persistent();
        if new_bps <= current.fee_bps && new_cap <= current.fee_cap {
            store.set(&DataKey::FeeConfig, &new_cfg);
            store.remove(&DataKey::PendingFeeConfig);
            env.events().publish(
                (symbol_short!("escrow"), symbol_short!("fee_upd")),
                (new_bps, new_cap),
            );
        } else {
            // Persist the currently effective config so a matured pending
            // change is not lost when it is replaced.
            store.set(&DataKey::FeeConfig, &current);
            let effective_at = env.ledger().timestamp() + FEE_CHANGE_DELAY_SECS;
            store.set(
                &DataKey::PendingFeeConfig,
                &PendingFeeConfig { config: new_cfg, effective_at },
            );
            env.events().publish(
                (symbol_short!("escrow"), symbol_short!("fee_prop")),
                (current.fee_bps, current.fee_cap, new_bps, new_cap, effective_at),
            );
        }
        Ok(())
    }

    /// Persist a pending fee increase whose timelock has elapsed. Anyone may
    /// call this; it only writes what `get_fee_config` already treats as
    /// effective. Emits `(escrow, fee_upd)`.
    pub fn apply_fee_update(env: Env) -> Result<(), EscrowError> {
        let pending: PendingFeeConfig = env
            .storage()
            .persistent()
            .get(&DataKey::PendingFeeConfig)
            .ok_or(EscrowError::NoPendingFeeUpdate)?;
        ensure(env.ledger().timestamp() >= pending.effective_at, EscrowError::FeeTimelockActive)?;
        env.storage().persistent().set(&DataKey::FeeConfig, &pending.config);
        env.storage().persistent().remove(&DataKey::PendingFeeConfig);
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("fee_upd")),
            (pending.config.fee_bps, pending.config.fee_cap),
        );
        Ok(())
    }

    /// Withdraw a scheduled fee increase before it takes effect. Admin-only.
    /// Emits `(escrow, fee_cncl)`.
    pub fn cancel_fee_update(env: Env, admin: Address) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        let pending: PendingFeeConfig = env
            .storage()
            .persistent()
            .get(&DataKey::PendingFeeConfig)
            .ok_or(EscrowError::NoPendingFeeUpdate)?;
        ensure(env.ledger().timestamp() < pending.effective_at, EscrowError::NoPendingFeeUpdate)?;
        env.storage().persistent().remove(&DataKey::PendingFeeConfig);
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("fee_cncl")),
            (pending.config.fee_bps, pending.config.fee_cap),
        );
        Ok(())
    }

    /// The fee config currently in effect (including a matured increase).
    pub fn get_effective_fee_config(env: Env) -> FeeConfig {
        get_fee_config(&env)
    }

    /// The scheduled fee increase still waiting out its timelock, if any.
    pub fn get_pending_fee_config(env: Env) -> Option<PendingFeeConfig> {
        env.storage()
            .persistent()
            .get::<DataKey, PendingFeeConfig>(&DataKey::PendingFeeConfig)
            .filter(|p| env.ledger().timestamp() < p.effective_at)
    }

    // ---- Issue #725: Oracle price freshness check ----

    /// Return the oracle staleness threshold in seconds (governance-configurable).
    /// Defaults to 3600 (1 hour).
    pub fn get_oracle_staleness_secs(env: &Env) -> u64 {
        env.storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::OracleStalenessSecs)
            .unwrap_or(3600)
    }

    /// Set the oracle staleness threshold. Only governance multisig may call this.
    pub fn set_oracle_staleness_secs(env: Env, admin: Address, staleness_secs: u64) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        ensure(
            (MIN_ORACLE_STALENESS_SECS..=MAX_ORACLE_STALENESS_SECS).contains(&staleness_secs),
            EscrowError::InvalidStaleness,
        )?;
        env.storage().persistent().set(&DataKey::OracleStalenessSecs, &staleness_secs);
        Ok(())
    }

    /// Set the oracle contract address. Only governance multisig may call this.
    pub fn set_oracle_address(env: Env, admin: Address, oracle: Address) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        env.storage().persistent().set(&DataKey::OracleAddress, &oracle);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    fn setup(env: &Env, amount: i128) -> (Address, Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token = sac.address();
        let payer = Address::generate(env);
        let payee = Address::generate(env);
        StellarAssetClient::new(env, &token).mint(&payer, &amount);
        (admin, token, payer, payee)
    }

    // fee calculation (#344)
    #[test]
    fn fee_is_2_5_percent_of_amount() {
        assert_eq!(platform_fee(1000), 25);
        assert_eq!(platform_fee(400), 10);
    }

    #[test]
    fn fee_is_capped_at_500() {
        assert_eq!(platform_fee(30_000), 500);
        assert_eq!(platform_fee(1_000_000), 500);
    }

    #[test]
    fn fee_at_exact_cap_boundary() {
        assert_eq!(platform_fee(20_000), 500);
    }

    #[test]
    fn fee_is_zero_for_zero_amount() {
        assert_eq!(platform_fee(0), 0);
    }

    #[test]
    fn deposit_net_amount_reflects_fee_deduction() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let escrow = contract.get_escrow(&id);
        assert_eq!(escrow.amount, 975);
        assert_eq!(escrow.fee_collected, 25);
    }

    #[test]
    fn calculate_fee_public_fn_matches_platform_fee() {
        let env = Env::default();
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        assert_eq!(contract.calculate_fee(&1000), 25);
        assert_eq!(contract.calculate_fee(&30_000), 500);
    }
    // â”€â”€ deposit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn test_deposit_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(id, 1);
        let e = contract.get_escrow(&id);
        assert_eq!(e.bounty_id, 1);
        assert_eq!(e.payer, payer);
        assert_eq!(e.amount, 975);
        assert!(e.status == EscrowStatus::Active);
        assert!(e.released_at.is_none());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn deposit_zero_amount_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 0);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        contract.deposit(&1u64, &payer, &payee, &0, &token, &ReleaseCondition::OnCompletion);
    }

    // â”€â”€ release â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn release_moves_balance_once_to_payee() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(TokenClient::new(&env, &token).balance(&cid), 1000);

        contract.release_funds(&payee, &id);

        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 975);
        assert_eq!(TokenClient::new(&env, &token).balance(&cid), 25);
        let e = contract.get_escrow(&id);
        assert!(e.status == EscrowStatus::Released);
        assert!(e.released_at.is_some());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn double_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payer, &id);
        contract.release_funds(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn release_rejects_non_party_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&Address::generate(&env), &id);
    }

    // â”€â”€ refund â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn refund_returns_funds_to_payer_and_sets_released_at() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 800);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &800, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);

        assert_eq!(TokenClient::new(&env, &token).balance(&payer), 780);
        let e = contract.get_escrow(&id);
        assert!(e.status == EscrowStatus::Refunded);
        assert!(e.released_at.is_some());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn refund_rejects_payee_authorizer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payee, &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn double_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn refund_after_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payee, &id);
        contract.refund_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn release_after_refund_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    // â”€â”€ dispute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn payer_can_dispute_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
    }

    #[test]
    fn payee_can_dispute_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payee, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn stranger_cannot_dispute() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&Address::generate(&env), &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn cannot_dispute_released_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.release_funds(&payer, &id);
        contract.dispute_escrow(&payer, &id);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn cannot_release_disputed_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        contract.release_funds(&payee, &id);
    }

    // â”€â”€ resolve_dispute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn admin_can_resolve_dispute_to_payee() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.allow_token(&admin, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&admin, &id, &true);

        assert_eq!(tc.balance(&payee), 975);
        assert_eq!(tc.balance(&cid), 0);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
    }

    #[test]
    fn admin_can_resolve_dispute_to_payer() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.allow_token(&admin, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payee, &id);
        contract.resolve_dispute(&admin, &id, &false);

        assert_eq!(tc.balance(&payer), 975);
        assert_eq!(tc.balance(&cid), 0);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Refunded);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn non_admin_cannot_resolve_dispute() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.allow_token(&admin, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        contract.resolve_dispute(&payer, &id, &true); // payer is not admin
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #10)")]
    fn cannot_resolve_active_escrow() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.allow_token(&admin, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.resolve_dispute(&admin, &id, &true); // not disputed yet
    }

    // ── dispute expiry (#731) ─────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Error(Contract, #11)")]
    fn resolve_expired_dispute_panics_before_expiry() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);
        // Timestamp is still 0 — expiry has not elapsed
        contract.resolve_expired_dispute(&id);
    }

    #[test]
    fn resolve_expired_dispute_succeeds_after_expiry() {
        let env = Env::default();
        env.mock_all_auths();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = soroban_sdk::token::Client::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);

        // Advance ledger time past the 30-day window
        env.ledger().set_timestamp(DISPUTE_TIMEOUT_SECS + 1);
        contract.resolve_expired_dispute(&id);

        // 50/50 split: net escrow = 975 (fee already deducted on deposit)
        // payee gets 487, payer gets 488 (integer division)
        let payee_bal = tc.balance(&payee);
        let payer_bal = tc.balance(&payer);
        assert!(payee_bal > 0, "payee should receive funds");
        assert!(payer_bal > 0, "payer should receive funds");
        assert_eq!(payee_bal + payer_bal, 975, "total must equal net escrow amount");

        let escrow = contract.get_escrow(&id);
        assert!(escrow.status == EscrowStatus::Refunded);
        assert!(escrow.released_at.is_some());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn set_admin_can_only_be_called_once() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let _ = (token, payer, payee); // suppress unused warnings

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.set_admin(&admin); // second call must panic
    }

    // ── timelock ──────────────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn release_before_timelock_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));
        contract.release_funds(&payer, &id);
    }

    #[test]
    fn release_after_timelock_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));
        env.ledger().set_timestamp(250);
        contract.release_funds(&payee, &id);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
    }

    // ── milestones ──────────────────────────────────────────────────────────────────

    #[test]
    fn milestone_release_transfers_partial_amount() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let desc = Symbol::new(&env, "phase1");
        contract.add_milestone(&payer, &id, &0, &desc, &400);
        contract.add_milestone(&payer, &id, &1, &Symbol::new(&env, "phase2"), &575);
        contract.release_milestone(&payer, &id, &0);

        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 400);
        assert!(contract.get_milestone(&id, &0).released);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #16)")]
    fn double_milestone_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let desc = Symbol::new(&env, "phase1");
        contract.add_milestone(&payer, &id, &0, &desc, &400);
        contract.add_milestone(&payer, &id, &1, &Symbol::new(&env, "phase2"), &575);
        contract.release_milestone(&payer, &id, &0);
        contract.release_milestone(&payer, &id, &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn payee_cannot_add_milestone() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payee, &id, &0, &Symbol::new(&env, "x"), &400);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn payee_cannot_release_milestone() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "x"), &400);
        contract.release_milestone(&payee, &id, &0);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #17)")]
    fn milestone_exceeding_escrow_amount_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "x"), &1001);
    }

    // ── balance conservation ──────────────────────────────────────────────────

    /// Total tokens out (payee + payer) must equal total tokens deposited.
    #[test]
    fn balance_conservation_release() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 2500);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &2500, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(tc.balance(&cid), 2500);
        assert_eq!(tc.balance(&payer), 0);

        contract.release_funds(&payer, &id);

        assert_eq!(tc.balance(&payee), 2438);  // payee received all (2500 - 62 fee)
        assert_eq!(tc.balance(&cid), 62);        // contract holds the fee
        assert_eq!(tc.balance(&payer), 0);      // payer gave it all
    }

    #[test]
    fn balance_conservation_refund() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1800);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        let id = contract.deposit(&1u64, &payer, &payee, &1800, &token, &ReleaseCondition::OnCompletion);
        contract.refund_escrow(&payer, &id);

        assert_eq!(tc.balance(&payer), 1755);
        assert_eq!(tc.balance(&payee), 0);
        assert_eq!(tc.balance(&cid), 45);
    }

    // ── multi-escrow isolation ────────────────────────────────────────────────
    
    /// Releasing escrow A must not affect escrow B's locked balance.
    #[test]
    fn releasing_one_escrow_does_not_drain_another() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 3000);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);
        let tc = TokenClient::new(&env, &token);

        // Deposit two separate escrows from the same payer
        let id_a = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let id_b = contract.deposit(&2u64, &payer, &payee, &2000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(tc.balance(&cid), 3000);

        contract.release_funds(&payer, &id_a);

        // Only escrow B's amount + fee from A left in contract
        assert_eq!(tc.balance(&cid), 2025);
        assert_eq!(tc.balance(&payee), 975);

        // Escrow B is still active and untouched
        assert!(contract.get_escrow(&id_b).status == EscrowStatus::Active);
    }

    #[test]
    fn test_get_escrow_id_for_bounty() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        let b_id = 99u64;
        let e_id = contract.deposit(&b_id, &payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        
        assert_eq!(contract.get_escrow_id_for_bounty(&b_id), e_id);
        assert_eq!(contract.get_escrow_id_for_bounty(&100u64), 0);
    }

    /// IDs are monotonically increasing and never reused.
    #[test]
    fn escrow_ids_are_monotonically_increasing() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 3000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        let id1 = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let id2 = contract.deposit(&2u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let id3 = contract.deposit(&3u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
        assert_eq!(id3, 3);
        assert!(id2 > id1 && id3 > id2);
    }

    // ── double-spend prevention ────────────────────────────────────────────────

    /// Funds locked in a disputed escrow must remain in the contract.
    #[test]
    fn disputed_escrow_funds_stay_locked() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract_id = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &contract_id);

        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.dispute_escrow(&payer, &id);

        // Balance unchanged — funds are locked
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&payee), 0i128);
        assert_eq!(token_client.balance(&contract_id), 1000i128);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #17)")]
    fn cumulative_milestone_sum_exceeding_escrow_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &975, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "p1"), &600);
        contract.add_milestone(&payer, &id, &1, &Symbol::new(&env, "p2"), &600);
    }

    #[test]
    fn releasing_all_milestones_marks_escrow_complete() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &id, &0, &Symbol::new(&env, "p1"), &600);
        contract.add_milestone(&payer, &id, &1, &Symbol::new(&env, "p2"), &375);

        contract.release_milestone(&payer, &id, &0);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Active);

        contract.release_milestone(&payer, &id, &1);
        assert!(contract.get_escrow(&id).status == EscrowStatus::Complete);
    }

    /// Two milestones whose combined amount equals the escrow can both be released
    /// but the total payout must not exceed the deposited amount.
    #[test]
    fn two_milestones_total_payout_equals_deposit() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract_id = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &contract_id);
        let token_client = TokenClient::new(&env, &token);

        let escrow_id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.add_milestone(&payer, &escrow_id, &0, &Symbol::new(&env, "p1"), &600);
        contract.add_milestone(&payer, &escrow_id, &1, &Symbol::new(&env, "p2"), &375);

        contract.release_milestone(&payer, &escrow_id, &0);
        contract.release_milestone(&payer, &escrow_id, &1);
        assert_eq!(token_client.balance(&payee), 975);
        assert_eq!(token_client.balance(&contract_id), 25);
    }

    /// A milestone from escrow A cannot be released against escrow B.
    #[test]
    #[should_panic(expected = "Error(Contract, #14)")]
    fn milestone_cross_escrow_release_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 2000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        let id_a = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let id_b = contract.deposit(&2u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);

        contract.add_milestone(&payer, &id_a, &0, &Symbol::new(&env, "m"), &500);

        // Attempt to release escrow A's milestone index 0 against escrow B
        contract.release_milestone(&payer, &id_b, &0);
    }

    /// Depositing a negative amount must be rejected.
    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn deposit_negative_amount_panics() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        contract.deposit(&1u64, &payer, &payee, &-1, &token, &ReleaseCondition::OnCompletion);
    }

    // â”€â”€ timelock boundary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Release at exactly the deadline timestamp must succeed.
    #[test]
    fn release_at_exact_timelock_boundary_succeeds() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);

        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));

        // Set timestamp to exactly the deadline
        env.ledger().set_timestamp(200);
        contract.release_funds(&payer, &id);

        assert!(contract.get_escrow(&id).status == EscrowStatus::Released);
        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 488);
    }

    /// Release one second before the deadline must be rejected.
    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn release_one_second_before_timelock_is_rejected() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 500);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &500, &token, &ReleaseCondition::Timelock(200));

        env.ledger().set_timestamp(199);
        contract.release_funds(&payer, &id);
    }

    // ── yield pause (#754) ──────────────────────────────────────────────────

    #[test]
    fn admin_can_pause_and_unpause_yield() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let _ = (token, payer, payee);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        assert!(!contract.is_yield_paused());

        contract.pause_yield(&admin);
        assert!(contract.is_yield_paused());

        contract.unpause_yield(&admin);
        assert!(!contract.is_yield_paused());
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")]
    fn non_admin_cannot_pause_yield() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let _ = (token, payer, payee);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let stranger = Address::generate(&env);
        contract.pause_yield(&stranger);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #19)")]
    fn accrue_yield_blocked_when_paused() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.allow_token(&admin, &token);
        contract.configure_yield(&admin, &300, &500, &9000);

        env.ledger().set_timestamp(100);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);

        contract.pause_yield(&admin);
        env.ledger().set_timestamp(200);
        contract.accrue_yield(&id);
    }

    #[test]
    fn withdraw_yield_allowed_when_paused() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 10_000);
        let cid = env.register(EscrowContract, ());
        let contract = EscrowContractClient::new(&env, &cid);

        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.allow_token(&admin, &token);
        contract.configure_yield(&admin, &300, &500, &9000);

        env.ledger().set_timestamp(1000);
        let id = contract.deposit(&1u64, &payer, &payee, &10_000, &token, &ReleaseCondition::OnCompletion);

        env.ledger().set_timestamp(1000 + 365 * 24 * 3600);
        contract.accrue_yield(&id);
        let accrued = contract.get_accrued_yield(&id);
        assert!(accrued > 0);

        contract.pause_yield(&admin);
        let withdrawn = contract.withdraw_yield(&admin, &id);
        assert_eq!(withdrawn, accrued);
    }


    // ── #1715: token allowlist + balance-delta check ────────────────────────

    mod mock_tokens {
        use soroban_sdk::{contract, contractimpl, Address, Env};

        /// Fee-on-transfer token: credits the recipient 1 % less than sent.
        #[contract]
        pub struct FeeOnTransferToken;

        #[contractimpl]
        impl FeeOnTransferToken {
            pub fn mint(env: Env, to: Address, amount: i128) {
                let bal: i128 = env.storage().persistent().get(&to).unwrap_or(0);
                env.storage().persistent().set(&to, &(bal + amount));
            }
            pub fn balance(env: Env, id: Address) -> i128 {
                env.storage().persistent().get(&id).unwrap_or(0)
            }
            pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
                let from_bal: i128 = env.storage().persistent().get(&from).unwrap_or(0);
                let to_bal: i128 = env.storage().persistent().get(&to).unwrap_or(0);
                env.storage().persistent().set(&from, &(from_bal - amount));
                env.storage().persistent().set(&to, &(to_bal + amount * 99 / 100));
            }
        }

        /// Lying token: `transfer` succeeds but moves nothing.
        #[contract]
        pub struct NoopToken;

        #[contractimpl]
        impl NoopToken {
            pub fn balance(_env: Env, _id: Address) -> i128 {
                1_000_000
            }
            pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
        }
    }

    #[test]
    fn deposit_rejects_fee_on_transfer_token() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let token = env.register(mock_tokens::FeeOnTransferToken, ());
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        mock_tokens::FeeOnTransferTokenClient::new(&env, &token).mint(&payer, &10_000);

        let res = contract.try_deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(res, Err(Ok(EscrowError::TokenTransferMismatch)));
        assert_eq!(contract.get_active_escrows_count(), 0);
    }

    #[test]
    fn deposit_rejects_noop_transfer_token() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let token = env.register(mock_tokens::NoopToken, ());
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);

        let res = contract.try_deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(res, Err(Ok(EscrowError::TokenTransferMismatch)));
    }

    #[test]
    fn deposit_rejects_fee_on_transfer_token_even_if_allowlisted() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        let token = env.register(mock_tokens::FeeOnTransferToken, ());
        contract.allow_token(&admin, &token);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        mock_tokens::FeeOnTransferTokenClient::new(&env, &token).mint(&payer, &10_000);

        let res = contract.try_deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(res, Err(Ok(EscrowError::TokenTransferMismatch)));
    }

    #[test]
    fn deposit_rejects_token_not_on_allowlist() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 1000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);

        let res = contract.try_deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(res, Err(Ok(EscrowError::TokenNotAllowed)));

        contract.allow_token(&admin, &token);
        assert!(contract.is_token_allowed(&token));
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(contract.get_escrow(&id).amount, 975);
    }

    #[test]
    fn disallowed_token_is_rejected_again() {
        let env = Env::default();
        let (_, token, payer, payee) = setup(&env, 2000);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let admin = Address::generate(&env);
        contract.set_admin(&admin);
        contract.allow_token(&admin, &token);
        let id = contract.deposit(&1u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);

        contract.disallow_token(&admin, &token);
        assert!(!contract.is_token_allowed(&token));
        let res = contract.try_deposit(&2u64, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(res, Err(Ok(EscrowError::TokenNotAllowed)));
        // Existing escrows in a delisted token can still settle.
        assert!(contract.release_funds(&payer, &id));
    }

    #[test]
    fn allow_token_rejects_non_admin() {
        let env = Env::default();
        let (_, token, _, _) = setup(&env, 1);
        let contract = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        contract.set_admin(&admin);

        assert_eq!(contract.try_allow_token(&attacker, &token), Err(Ok(EscrowError::Unauthorized)));
        assert_eq!(contract.try_disallow_token(&attacker, &token), Err(Ok(EscrowError::Unauthorized)));
        assert!(!contract.is_token_allowed(&token));
    }

    // ── #1714: bound escrows are driven only by the bounty contract ─────────

    fn bound_setup(env: &Env) -> (EscrowContractClient<'_>, Address, Address, Address, Address, u64) {
        let (_, token, payer, payee) = setup(env, 1000);
        let contract = EscrowContractClient::new(env, &env.register(EscrowContract, ()));
        let admin = Address::generate(env);
        let bounty_contract = Address::generate(env);
        contract.set_admin(&admin);
        contract.allow_token(&admin, &token);
        contract.set_bounty_contract(&admin, &bounty_contract);
        let id = contract.deposit(&7u64, &payer, &payer, &1000, &token, &ReleaseCondition::OnCompletion);
        contract.bind_bounty(&bounty_contract, &7u64, &id, &payer);
        (contract, token, payer, payee, bounty_contract, id)
    }

    #[test]
    fn bound_escrow_rejects_direct_release_refund_and_dispute() {
        let env = Env::default();
        let (contract, _, payer, _, _, id) = bound_setup(&env);
        assert_eq!(contract.try_release_funds(&payer, &id), Err(Ok(EscrowError::ManagedByBounty)));
        assert_eq!(contract.try_refund_escrow(&payer, &id), Err(Ok(EscrowError::ManagedByBounty)));
        assert_eq!(contract.try_dispute_escrow(&payer, &id), Err(Ok(EscrowError::ManagedByBounty)));
        assert_eq!(contract.get_escrow(&id).status, EscrowStatus::Active);
    }

    #[test]
    fn release_for_bounty_pays_selected_payee() {
        let env = Env::default();
        let (contract, token, _, payee, bounty_contract, id) = bound_setup(&env);
        contract.release_for_bounty(&bounty_contract, &7u64, &payee);
        let e = contract.get_escrow(&id);
        assert_eq!(e.status, EscrowStatus::Released);
        assert_eq!(e.payee, payee);
        assert_eq!(TokenClient::new(&env, &token).balance(&payee), 975);
    }

    #[test]
    fn bounty_driven_calls_reject_other_callers() {
        let env = Env::default();
        let (contract, _, payer, payee, _, _) = bound_setup(&env);
        let impostor = Address::generate(&env);
        assert_eq!(
            contract.try_release_for_bounty(&impostor, &7u64, &payee),
            Err(Ok(EscrowError::NotBountyContract))
        );
        assert_eq!(contract.try_refund_for_bounty(&impostor, &7u64), Err(Ok(EscrowError::NotBountyContract)));
        assert_eq!(
            contract.try_refund_expired_bounty(&7u64, &impostor),
            Err(Ok(EscrowError::NotBountyContract))
        );
        assert_eq!(
            contract.try_bind_bounty(&impostor, &7u64, &1u64, &payer),
            Err(Ok(EscrowError::NotBountyContract))
        );
    }

    #[test]
    fn bind_bounty_rejects_mismatch_and_double_bind() {
        let env = Env::default();
        let (contract, _, payer, _, bounty_contract, id) = bound_setup(&env);
        assert_eq!(
            contract.try_bind_bounty(&bounty_contract, &7u64, &id, &payer),
            Err(Ok(EscrowError::EscrowAlreadyBound))
        );
        assert_eq!(
            contract.try_bind_bounty(&bounty_contract, &8u64, &id, &payer),
            Err(Ok(EscrowError::BountyMismatch))
        );
    }

    #[test]
    fn refund_for_bounty_is_single_shot() {
        let env = Env::default();
        let (contract, token, payer, _, bounty_contract, id) = bound_setup(&env);
        contract.refund_for_bounty(&bounty_contract, &7u64);
        assert_eq!(contract.get_escrow(&id).status, EscrowStatus::Refunded);
        assert_eq!(TokenClient::new(&env, &token).balance(&payer), 975);
        assert_eq!(
            contract.try_refund_for_bounty(&bounty_contract, &7u64),
            Err(Ok(EscrowError::EscrowNotActive))
        );
    }
}
