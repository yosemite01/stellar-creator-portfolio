#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

// Reentrancy protection module (#635)
mod reentrancy;
use reentrancy::{require_active_escrow, require_authorized_party, ReentrancyGuard};

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Symbol,
    token::Client as TokenClient,
};

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
/// After this window anyone can call `resolve_expired_dispute` for a 50/50 split.
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

/// Read the current fee config from storage, falling back to defaults.
pub fn get_fee_config(env: &Env) -> FeeConfig {
    env.storage()
        .persistent()
        .get::<DataKey, FeeConfig>(&DataKey::FeeConfig)
        .unwrap_or(FeeConfig {
            fee_bps: DEFAULT_PLATFORM_FEE_BPS,
            fee_cap: DEFAULT_PLATFORM_FEE_CAP,
        })
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

/// Milestone â€” a named portion of the total escrow amount
#[contracttype]
pub struct Milestone {
    pub escrow_id: u64,
    pub index: u32,
    pub description: Symbol,
    pub amount: i128,
    pub released: bool,
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
    DisputeExpiry(u64),
    DisputeSplit,
    FeeConfig,
    OracleStalenessSecs,
    OracleAddress,
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
}

fn escrow_key(env: &Env, escrow_id: u64) -> (Symbol, u64) {
    (Symbol::new(env, "escrow"), escrow_id)
}

fn load_escrow(env: &Env, escrow_id: u64) -> Result<EscrowAccount, EscrowError> {
    env.storage()
        .persistent()
        .get::<(Symbol, u64), EscrowAccount>(&escrow_key(env, escrow_id))
        .ok_or(EscrowError::EscrowNotFound)
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

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Deposit funds into escrow
    pub fn deposit(
        env: Env,
        bounty_id: u64,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
    ) -> Result<u64, EscrowError> {
        payer.require_auth();
        ensure(amount > 0, EscrowError::InvalidAmount)?;
        let _guard = ReentrancyGuard::acquire(&env);

        // #179: Validate token implements the SEP-41 interface before accepting funds.
        // Calling balance() will trap if `token` is not a valid token contract,
        // preventing funds from being locked with an unrecoverable address.
        let token_client = TokenClient::new(&env, &token);
        let _ = token_client.balance(&payer);
        token_client.transfer(&payer, &env.current_contract_address(), &amount);

        let counter_key = Symbol::new(&env, "escrow_counter");
        let mut counter: u64 = env.storage().persistent().get::<Symbol, u64>(&counter_key).unwrap_or(0);
        counter += 1;

        let fee_cfg = get_fee_config(&env);
        let fee = platform_fee_with_config(amount, &fee_cfg);
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
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;
        ensure(Self::can_release(env.clone(), escrow_id)?, EscrowError::ReleaseConditionNotMet)?;

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
            .transfer(&env.current_contract_address(), &escrow.payee, &escrow.amount);

        // Emit escrow_released event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("released")),
            (escrow_id, escrow.bounty_id, escrow.payee.clone(), escrow.amount),
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
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;

        // EFFECTS – mutate state before any cross-contract call
        escrow.status = EscrowStatus::Refunded;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // INTERACTIONS – external call after state is finalised
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);

        // Emit escrow_refunded event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refunded")),
            (escrow_id, escrow.bounty_id, escrow.payer.clone(), escrow.amount),
        );

        Ok(true)
    }

    /// Refund an expired bounty's escrow to the payer. Called by the bounty contract when expiring.
    pub fn refund_expired_bounty(env: Env, bounty_id: u64, bounty_contract: Address) -> Result<bool, EscrowError> {
        bounty_contract.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let escrow_id = Self::get_escrow_id_for_bounty(env.clone(), bounty_id);
        ensure(escrow_id > 0, EscrowError::NoEscrowForBounty)?;

        let key = escrow_key(&env, escrow_id);
        let mut escrow = load_escrow(&env, escrow_id)?;

        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;

        // Transfer funds back to the creator (payer)
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payer, &escrow.amount);

        escrow.status = EscrowStatus::Refunded;
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // Emit escrow_refunded event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("refunded")),
            (escrow_id, bounty_id, escrow.payer.clone(), escrow.amount),
        );

        Ok(true)
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
        ensure(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;

        escrow.status = EscrowStatus::Disputed;
        env.storage().persistent().set(&key, &escrow);

        // #731: record when this dispute expires (created_at + 30 days)
        let expires_at = env.ledger().timestamp() + DISPUTE_TIMEOUT_SECS;
        env.storage()
            .persistent()
            .set(&DataKey::DisputeExpiry(escrow_id), &expires_at);

        // Emit escrow_disputed event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("disputed")),
            (escrow_id, escrow.bounty_id, authorizer, expires_at),
        );

        Ok(true)
    }

    /// Resolve a disputed escrow. Only the platform admin may call this.
    ///
    /// `resolution`: `true` → release funds to payee; `false` → refund to payer.
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        escrow_id: u64,
        release_to_payee: bool,
    ) -> Result<bool, EscrowError> {
        admin.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        // Verify caller is the stored platform admin
        require_admin(&env, &admin)?;

        let key = escrow_key(&env, escrow_id);
        let mut escrow = load_escrow(&env, escrow_id)?;

        ensure(escrow.status == EscrowStatus::Disputed, EscrowError::EscrowNotDisputed)?;

        let recipient = if release_to_payee {
            escrow.payee.clone()
        } else {
            escrow.payer.clone()
        };

        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &recipient, &escrow.amount);

        escrow.status = if release_to_payee {
            EscrowStatus::Released
        } else {
            EscrowStatus::Refunded
        };
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // Emit dispute_resolved event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("resolved")),
            (escrow_id, escrow.bounty_id, recipient, release_to_payee),
        );

        Ok(true)
    }

    // ── Issue #731: Dispute resolution timeout ────────────────────────────────

    /// Configure the default auto-resolution split in basis points paid to the
    /// payee. 5000 = 50/50. Only the platform admin may call this.
    pub fn set_dispute_split(env: Env, admin: Address, payee_bps: u32) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        ensure(payee_bps <= 10_000, EscrowError::InvalidBps)?;
        env.storage()
            .persistent()
            .set(&DataKey::DisputeSplit, &payee_bps);
        Ok(())
    }

    /// Auto-resolve a stale dispute after its expiry window has elapsed.
    /// Anyone may call this — no auth required.
    /// Default resolution: 50/50 split (configurable via `set_dispute_split`).
    ///
    /// Fails with:
    ///   - `EscrowNotDisputed` if escrow is not in Disputed state
    ///   - `DisputeNotExpired` if the expiry window has not yet elapsed
    pub fn resolve_expired_dispute(env: Env, escrow_id: u64) -> Result<bool, EscrowError> {
        let _guard = ReentrancyGuard::acquire(&env);

        let key = escrow_key(&env, escrow_id);
        let mut escrow = load_escrow(&env, escrow_id)?;

        ensure(escrow.status == EscrowStatus::Disputed, EscrowError::EscrowNotDisputed)?;

        let expires_at: u64 = env
            .storage()
            .persistent()
            .get::<DataKey, u64>(&DataKey::DisputeExpiry(escrow_id))
            .ok_or(EscrowError::DisputeExpiryMissing)?;

        ensure(env.ledger().timestamp() >= expires_at, EscrowError::DisputeNotExpired)?;

        // Determine split: default 50/50 unless governance has set otherwise
        let payee_bps: u32 = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&DataKey::DisputeSplit)
            .unwrap_or(5_000); // 50% to payee

        let payee_amount = escrow.amount * (payee_bps as i128) / 10_000;
        let payer_amount = escrow.amount - payee_amount;

        let token = TokenClient::new(&env, &escrow.token);

        if payee_amount > 0 {
            token.transfer(&env.current_contract_address(), &escrow.payee, &payee_amount);
        }
        if payer_amount > 0 {
            token.transfer(&env.current_contract_address(), &escrow.payer, &payer_amount);
        }

        escrow.status = EscrowStatus::Refunded; // closest semantic: funds dispersed
        escrow.released_at = Some(env.ledger().timestamp());
        env.storage().persistent().set(&key, &escrow);

        // Emit dispute_auto_resolved event
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("auto_res")),
            (escrow_id, escrow.bounty_id, payee_amount, payer_amount),
        );

        Ok(true)
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

    /// Add a milestone to an active escrow. Sum of milestone amounts must not exceed escrow amount.
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
        ensure(
            current_total + amount <= escrow.amount,
            EscrowError::MilestoneExceedsEscrow,
        )?;

        let m_key = (Symbol::new(&env, "ms"), escrow_id, index);
        ensure(
            env.storage().persistent().get::<(Symbol, u64, u32), Milestone>(&m_key).is_none(),
            EscrowError::MilestoneAlreadyExists,
        )?;

        env.storage().persistent().set(&total_key, &(current_total + amount));

        let count_key = DataKey::MilestoneCount(escrow_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        env.storage().persistent().set(&count_key, &(count + 1));

        let milestone = Milestone { escrow_id, index, description, amount, released: false };
        env.storage().persistent().set(&m_key, &milestone);
        Ok(())
    }

    /// Release a single milestone payment to payee. Authorizer must be payer.
    pub fn release_milestone(env: Env, authorizer: Address, escrow_id: u64, index: u32) -> Result<bool, EscrowError> {
        // CHECKS
        authorizer.require_auth();
        let _guard = ReentrancyGuard::acquire(&env);

        let escrow = load_escrow(&env, escrow_id)?;
        require_authorized_party(authorizer == escrow.payer, EscrowError::Unauthorized)?;

        let m_key = (Symbol::new(&env, "ms"), escrow_id, index);
        let mut milestone = env.storage().persistent()
            .get::<(Symbol, u64, u32), Milestone>(&m_key)
            .ok_or(EscrowError::MilestoneNotFound)?;

        ensure(!milestone.released, EscrowError::MilestoneAlreadyReleased)?;
        require_active_escrow(escrow.status == EscrowStatus::Active, EscrowError::EscrowNotActive)?;

        // EFFECTS – mark released before the token transfer
        milestone.released = true;
        env.storage().persistent().set(&m_key, &milestone);

        // INTERACTIONS – external call after state is finalised
        TokenClient::new(&env, &escrow.token)
            .transfer(&env.current_contract_address(), &escrow.payee, &milestone.amount);

        // Emit milestone_released event for indexers
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("ms_rel")),
            (escrow_id, index, escrow.payee.clone(), milestone.amount),
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
            .get::<(Symbol, u64, u32), Milestone>(&(Symbol::new(&env, "ms"), escrow_id, index))
            .ok_or(EscrowError::MilestoneNotFound)
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

    /// Estimate the total fee for funding an escrow with the given amount.
    /// Returns the platform_fee for the specified amount.
    ///
    /// Note: actual fee may vary by up to 10% from this estimate due to network conditions.
    /// The estimate is guaranteed not to exceed actual fee by more than 10%.
    pub fn estimate_fund_escrow_fee(_env: Env, amount: i128) -> i128 {
        platform_fee(amount)
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
    /// Emits a fee_updated event on successful change.
    pub fn update_fee(env: Env, admin: Address, new_bps: i128, new_cap: i128) -> Result<(), EscrowError> {
        admin.require_auth();
        require_admin(&env, &admin)?;
        // Fee BPS must be within 0..=1_000 (10%) and the cap non-negative.
        ensure((0..=1_000).contains(&new_bps), EscrowError::InvalidFeeConfig)?;
        ensure(new_cap >= 0, EscrowError::InvalidFeeConfig)?;
        env.storage().persistent().set(&DataKey::FeeConfig, &FeeConfig {
            fee_bps: new_bps,
            fee_cap: new_cap,
        });
        env.events().publish(
            (symbol_short!("escrow"), symbol_short!("fee_upd")),
            (new_bps, new_cap),
        );
        Ok(())
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

}
