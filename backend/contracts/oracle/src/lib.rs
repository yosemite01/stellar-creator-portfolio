#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

//! Decentralized Oracle integration for fiat-pegged bounties (#634).
//!
//! Provides:
//! - A standardised `PriceFeed` trait consumed by the bounty contract.
//! - An `OracleClient` that reads price data from a registered oracle contract.
//! - Explicit staleness handling: `get_price` returns `Err(OracleError::Stale)`
//!   instead of a hardcoded fallback quote (#1709).
//! - Multi-reporter median aggregation with a minimum quorum (#1709).
//! - A Reflector (SEP-40) adapter used as a secondary source (#1709).
//! - Atomic valuation helpers used at exact execution time.
//!
//! ## Price resolution order (`get_price`)
//!
//! 1. Reporter quorum: when a quorum is configured and at least `quorum`
//!    reporters have a fresh report, the median of the fresh reports.
//! 2. The registered oracle's last price (`update_price`), if fresh.
//! 3. The Reflector secondary source, if configured and fresh.
//! 4. Otherwise `Err(OracleError::Stale)` (some data exists but none is fresh)
//!    or `Err(OracleError::NoPrice)` (nothing was ever recorded).
//!
//! There is no hardcoded fallback price any more: a cross-contract caller that
//! receives an error reverts, so payouts never execute at an arbitrary rate.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec,
};

#[cfg(test)]
mod test;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum age of a price feed entry before it is considered stale (5 minutes).
pub const MAX_PRICE_AGE_SECS: u64 = 300;

/// Allowed deviation from the last accepted price before triggering fallback (10 %).
pub const MAX_PRICE_DEVIATION_BPS: i128 = 1_000;

/// Upper bound on the reporter set so median aggregation stays O(1) in cost.
pub const MAX_REPORTERS: u32 = 15;

/// Micro-USD precision used for every price this contract returns.
pub const PRICE_DECIMALS: u32 = 6;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Typed errors returned by the price read paths.
///
/// Codes are part of the public interface — append only, never renumber.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum OracleError {
    /// Price data exists but none of it is younger than `MAX_PRICE_AGE_SECS`
    /// (or the reporter quorum is not met with fresh reports).
    Stale = 1,
    /// No price has ever been recorded from any source.
    NoPrice = 2,
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// A single price observation from the oracle network.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceData {
    /// Asset price in micro-USD (6 decimal places, e.g. 1 USD = 1_000_000).
    pub price_micro_usd: i128,
    /// Ledger timestamp when this price was recorded.
    pub timestamp: u64,
    /// Number of oracle sources that agreed on this price.
    pub sources: u32,
}

/// Result of an atomic valuation at execution time.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ValuationResult {
    /// USD amount requested (micro-USD).
    pub usd_amount_micro: i128,
    /// Equivalent token amount at the locked-in price.
    pub token_amount: i128,
    /// Price used for the conversion (micro-USD per token).
    pub price_used: i128,
    /// Whether the secondary (Reflector) source supplied the price instead of
    /// the primary reporters / registered oracle. Never a hardcoded rate.
    pub used_fallback: bool,
}

/// Price for display purposes, returned even when stale (`get_price_unchecked`).
#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceView {
    pub price: PriceData,
    /// `true` when the price is older than `MAX_PRICE_AGE_SECS` and would be
    /// rejected by `get_price`.
    pub is_stale: bool,
}

/// Reflector (SEP-40) asset identifier.
#[contracttype]
#[derive(Clone, Debug)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

/// Reflector (SEP-40) price record. Field names match Reflector's `PriceData`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ReflectorPriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Secondary-source configuration.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ReflectorConfig {
    pub contract: Address,
    pub asset: Asset,
}

/// Subset of the Reflector oracle interface used by the adapter.
/// See <https://reflector.network/docs>.
#[contractclient(name = "ReflectorClient")]
pub trait ReflectorInterface {
    fn lastprice(env: Env, asset: Asset) -> Option<ReflectorPriceData>;
    fn decimals(env: Env) -> u32;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
enum DataKey {
    /// Contract administrator, set once by `initialize`.
    Admin,
    /// Address of the registered oracle contract.
    OracleAddress,
    /// Last accepted price snapshot.
    LastPrice,
    /// Authorised price reporters (bounded by `MAX_REPORTERS`).
    Reporters,
    /// Minimum number of fresh reports required for a median price.
    Quorum,
    /// Latest report per reporter.
    Report(Address),
    /// Reflector secondary-source configuration.
    Reflector,
}

// ---------------------------------------------------------------------------
// Oracle contract
// ---------------------------------------------------------------------------

#[contract]
pub struct OracleContract;

#[contractimpl]
impl OracleContract {
    // ── Admin ────────────────────────────────────────────────────────────────

    /// Set the contract administrator. Callable once.
    ///
    /// Without this, `set_oracle`'s `admin` parameter was self-asserted: the
    /// caller passed whichever address they controlled, `require_auth()`
    /// confirmed only that they controlled *that* address, and nothing tied it
    /// to any privileged role. Anyone could re-point the oracle.
    pub fn initialize(env: Env, admin: Address) {
        assert!(
            !env.storage().persistent().has(&DataKey::Admin),
            "Contract already initialized"
        );
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
    }

    /// Register the address of the upstream oracle contract. Admin-only.
    pub fn set_oracle(env: Env, admin: Address, oracle: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::OracleAddress, &oracle);

        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "oracle_set")),
            oracle,
        );
    }

    /// Return the registered oracle address, if one has been set.
    pub fn get_oracle(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::OracleAddress)
    }

    /// Return the administrator, if the contract has been initialized.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Admin)
    }

    // ── Price feed ───────────────────────────────────────────────────────────

    /// Push a new price observation. Callable only by the registered oracle.
    pub fn update_price(env: Env, caller: Address, price_data: PriceData) {
        caller.require_auth();

        // The check this contract is named for, and previously did not perform.
        //
        // `require_auth()` alone proves only that `caller` authorised the call —
        // it says nothing about *who* `caller` is. Any address could satisfy it
        // with its own signature and write the authoritative price.
        //
        // Rejecting when no oracle is registered matters as much as the
        // comparison: with an empty LastPrice there is nothing to deviate from,
        // so the first writer could set any positive price at all, and every
        // subsequent update would then be anchored to that value.
        let registered: Address = env
            .storage()
            .persistent()
            .get(&DataKey::OracleAddress)
            .expect("No oracle registered; call set_oracle first");
        assert!(caller == registered, "Caller is not the registered oracle");

        // Reject obviously anomalous prices (zero or negative).
        assert!(price_data.price_micro_usd > 0, "Price must be positive");
        // A future-dated price would never become stale.
        assert!(
            price_data.timestamp <= env.ledger().timestamp(),
            "Price timestamp is in the future"
        );

        // Check deviation against last accepted price.
        if let Some(last) = env
            .storage()
            .persistent()
            .get::<DataKey, PriceData>(&DataKey::LastPrice)
        {
            let deviation = deviation_bps(last.price_micro_usd, price_data.price_micro_usd);
            assert!(
                deviation <= MAX_PRICE_DEVIATION_BPS,
                "Price deviation exceeds allowed threshold"
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::LastPrice, &price_data);

        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "price_updated")),
            (price_data.price_micro_usd, price_data.timestamp),
        );
    }

    /// Return the current price, or an error when no fresh price is available.
    ///
    /// Never returns a hardcoded fallback. A contract that invokes this across
    /// contracts reverts when it returns `Err`, which is the intended outcome
    /// for payouts and fee conversions during an oracle outage.
    pub fn get_price(env: Env) -> Result<PriceData, OracleError> {
        resolve_fresh(&env).map(|(data, _secondary)| data)
    }

    /// Return the best known price for UI display, flagged when stale.
    ///
    /// Must not be used for value transfer: use `get_price` / `value_in_tokens`.
    pub fn get_price_unchecked(env: Env) -> Option<PriceView> {
        if let Ok((price, _)) = resolve_fresh(&env) {
            return Some(PriceView { price, is_stale: false });
        }
        latest_known(&env).map(|price| PriceView { price, is_stale: true })
    }

    // ── Multi-reporter aggregation ───────────────────────────────────────────

    /// Authorise a price reporter. Admin-only. Emits `(oracle, rep_added)`.
    pub fn add_reporter(env: Env, admin: Address, reporter: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        let mut reporters = reporters(&env);
        assert!(!reporters.contains(&reporter), "Reporter already registered");
        assert!(reporters.len() < MAX_REPORTERS, "Too many reporters");
        reporters.push_back(reporter.clone());
        env.storage().persistent().set(&DataKey::Reporters, &reporters);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "rep_added")),
            reporter,
        );
    }

    /// Revoke a price reporter and drop its last report. Admin-only.
    /// Fails if the removal would leave fewer reporters than the quorum.
    /// Emits `(oracle, rep_removed)`.
    pub fn remove_reporter(env: Env, admin: Address, reporter: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        let mut reporters = reporters(&env);
        let idx = reporters
            .first_index_of(&reporter)
            .expect("Reporter not registered");
        reporters.remove(idx);
        assert!(
            quorum(&env) <= reporters.len(),
            "Removal would break the quorum"
        );
        env.storage().persistent().set(&DataKey::Reporters, &reporters);
        env.storage().persistent().remove(&DataKey::Report(reporter.clone()));
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "rep_removed")),
            reporter,
        );
    }

    /// Set the minimum number of fresh reports required for a median price.
    /// `0` disables reporter aggregation. Admin-only. Emits `(oracle, quorum_set)`.
    pub fn set_quorum(env: Env, admin: Address, quorum: u32) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        assert!(quorum <= reporters(&env).len(), "Quorum exceeds reporter count");
        env.storage().persistent().set(&DataKey::Quorum, &quorum);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "quorum_set")),
            quorum,
        );
    }

    /// Submit a price report. Callable only by an authorised reporter.
    /// The report is timestamped with the current ledger time.
    /// Emits `(oracle, reported)`.
    pub fn submit_report(env: Env, reporter: Address, price_micro_usd: i128) {
        reporter.require_auth();
        assert!(reporters(&env).contains(&reporter), "Caller is not a reporter");
        assert!(price_micro_usd > 0, "Price must be positive");
        let now = env.ledger().timestamp();
        let report = PriceData { price_micro_usd, timestamp: now, sources: 1 };
        env.storage()
            .persistent()
            .set(&DataKey::Report(reporter.clone()), &report);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "reported")),
            (reporter, price_micro_usd, now),
        );
    }

    pub fn get_reporters(env: Env) -> Vec<Address> {
        reporters(&env)
    }

    pub fn get_quorum(env: Env) -> u32 {
        quorum(&env)
    }

    // ── Reflector secondary source ───────────────────────────────────────────

    /// Configure the Reflector (SEP-40) contract used as secondary source.
    /// Admin-only. Emits `(oracle, reflector_set)`.
    pub fn set_reflector(env: Env, admin: Address, contract: Address, asset: Asset) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        let cfg = ReflectorConfig { contract: contract.clone(), asset };
        env.storage().persistent().set(&DataKey::Reflector, &cfg);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "reflector_set")),
            contract,
        );
    }

    /// Remove the secondary source. Admin-only. Emits `(oracle, reflector_clr)`.
    pub fn clear_reflector(env: Env, admin: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage().persistent().remove(&DataKey::Reflector);
        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "reflector_clr")),
            (),
        );
    }

    pub fn get_reflector(env: Env) -> Option<ReflectorConfig> {
        env.storage().persistent().get(&DataKey::Reflector)
    }

    // ── Atomic valuation ─────────────────────────────────────────────────────

    /// Convert a USD-denominated bounty amount to tokens at the current oracle
    /// price, atomically at the moment of execution.
    ///
    /// `usd_amount_micro` – the bounty value in micro-USD (e.g. $100 = 100_000_000).
    ///
    /// Returns `Err(OracleError::Stale | NoPrice)` rather than converting at a
    /// made-up rate.
    pub fn value_in_tokens(env: Env, usd_amount_micro: i128) -> Result<ValuationResult, OracleError> {
        assert!(usd_amount_micro > 0, "Amount must be positive");

        let (price_data, used_fallback) = resolve_fresh(&env)?;

        // token_amount = usd_amount_micro / price_micro_usd
        // Both values are in micro-units so the result is in whole tokens.
        let token_amount = usd_amount_micro
            .checked_div(price_data.price_micro_usd)
            .expect("Division by zero in price conversion");

        Ok(ValuationResult {
            usd_amount_micro,
            token_amount,
            price_used: price_data.price_micro_usd,
            used_fallback,
        })
    }

    // ── Internal ─────────────────────────────────────────────────────────────

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
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Contract not initialized; call initialize first");
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Contract not initialized; call initialize first");
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Contract not initialized; call initialize first");
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
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Contract not initialized; call initialize first");
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Contract not initialized; call initialize first");
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &stored_admin);
        env.storage().persistent().set(&DataKey::Admin, &accepted);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Contract not initialized; call initialize first");
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }

    /// Assert that `caller` is the stored administrator.
    ///
    /// Panics when the contract has not been initialized, rather than treating
    /// an absent admin as "anyone may proceed" — an uninitialized contract must
    /// be closed, not open.
    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized; call initialize first");
        assert!(*caller == admin, "Caller is not the admin");
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn reporters(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Reporters)
        .unwrap_or_else(|| Vec::new(env))
}

fn quorum(env: &Env) -> u32 {
    env.storage().persistent().get(&DataKey::Quorum).unwrap_or(0)
}

fn is_fresh(env: &Env, timestamp: u64) -> bool {
    let now = env.ledger().timestamp();
    timestamp <= now && now - timestamp <= MAX_PRICE_AGE_SECS
}

/// Median of a non-empty list. For an even count the two middle values are
/// averaged (rounding toward zero).
pub fn median(values: &mut Vec<i128>) -> i128 {
    let n = values.len();
    assert!(n > 0, "median of empty set");
    // Insertion sort: n <= MAX_REPORTERS so this is bounded.
    for i in 1..n {
        let mut j = i;
        while j > 0 && values.get_unchecked(j - 1) > values.get_unchecked(j) {
            let a = values.get_unchecked(j - 1);
            let b = values.get_unchecked(j);
            values.set(j - 1, b);
            values.set(j, a);
            j -= 1;
        }
    }
    if n % 2 == 1 {
        values.get_unchecked(n / 2)
    } else {
        let lo = values.get_unchecked(n / 2 - 1);
        let hi = values.get_unchecked(n / 2);
        lo + (hi - lo) / 2
    }
}

/// Median over fresh reporter reports, if the quorum is met.
fn aggregate_reports(env: &Env) -> Option<PriceData> {
    let q = quorum(env);
    if q == 0 {
        return None;
    }
    let mut prices: Vec<i128> = Vec::new(env);
    let mut oldest = u64::MAX;
    for reporter in reporters(env).iter() {
        if let Some(r) = env
            .storage()
            .persistent()
            .get::<DataKey, PriceData>(&DataKey::Report(reporter))
        {
            if is_fresh(env, r.timestamp) {
                prices.push_back(r.price_micro_usd);
                oldest = oldest.min(r.timestamp);
            }
        }
    }
    if prices.len() < q {
        return None;
    }
    let sources = prices.len();
    Some(PriceData {
        price_micro_usd: median(&mut prices),
        timestamp: oldest,
        sources,
    })
}

/// Scale a Reflector price with `decimals` precision to micro-USD.
pub fn to_micro_usd(price: i128, decimals: u32) -> i128 {
    if decimals >= PRICE_DECIMALS {
        price / 10i128.pow(decimals - PRICE_DECIMALS)
    } else {
        price * 10i128.pow(PRICE_DECIMALS - decimals)
    }
}

/// Read the Reflector secondary source, regardless of freshness.
fn read_reflector(env: &Env) -> Option<PriceData> {
    let cfg: ReflectorConfig = env.storage().persistent().get(&DataKey::Reflector)?;
    let client = ReflectorClient::new(env, &cfg.contract);
    let raw = client.lastprice(&cfg.asset)?;
    let price_micro_usd = to_micro_usd(raw.price, client.decimals());
    if price_micro_usd <= 0 {
        return None;
    }
    Some(PriceData { price_micro_usd, timestamp: raw.timestamp, sources: 1 })
}

fn last_price(env: &Env) -> Option<PriceData> {
    env.storage().persistent().get(&DataKey::LastPrice)
}

/// Resolve a fresh price. The `bool` is `true` when the secondary source was used.
fn resolve_fresh(env: &Env) -> Result<(PriceData, bool), OracleError> {
    if let Some(p) = aggregate_reports(env) {
        return Ok((p, false));
    }
    if let Some(p) = last_price(env) {
        if is_fresh(env, p.timestamp) {
            return Ok((p, false));
        }
    }
    if let Some(p) = read_reflector(env) {
        if is_fresh(env, p.timestamp) {
            return Ok((p, true));
        }
    }
    if latest_known(env).is_some() {
        Err(OracleError::Stale)
    } else {
        Err(OracleError::NoPrice)
    }
}

/// The most recent observation from any source, fresh or not.
fn latest_known(env: &Env) -> Option<PriceData> {
    let mut best: Option<PriceData> = last_price(env);
    let mut consider = |p: PriceData| {
        if best.as_ref().map_or(true, |b| p.timestamp > b.timestamp) {
            best = Some(p);
        }
    };
    for reporter in reporters(env).iter() {
        if let Some(r) = env
            .storage()
            .persistent()
            .get::<DataKey, PriceData>(&DataKey::Report(reporter))
        {
            consider(r);
        }
    }
    if let Some(r) = read_reflector(env) {
        consider(r);
    }
    best
}

/// Compute the absolute deviation between two prices in basis points.
fn deviation_bps(old: i128, new: i128) -> i128 {
    if old == 0 {
        return 0;
    }
    let diff = if new > old { new - old } else { old - new };
    diff * 10_000 / old
}

// Issue #1719: shared upgrade-timelock conformance tests.
stellar_upgradeable::upgrade_timelock_tests!(
    upgrade_conformance,
    OracleContract,
    OracleContractClient,
    |env, id, admin| {
        OracleContractClient::new(&env, &id).initialize(&admin);
    }
);
