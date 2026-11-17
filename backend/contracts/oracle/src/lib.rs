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

//! - Fallback logic when the oracle reports anomalous (stale or out-of-band) prices.

//! - Atomic valuation helpers used at exact execution time.



use soroban_sdk::{

    contract, contracterror, contractimpl, contracttype, Address, Env, Symbol,

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



/// Fallback USD/XLM rate in micro-units (1 XLM = $0.12 тЖТ 120_000 micro-USD).

/// Used only when the oracle is unavailable or reports anomalous data.

pub const FALLBACK_PRICE_MICRO_USD: i128 = 120_000;



// ---------------------------------------------------------------------------

// Data types

// ---------------------------------------------------------------------------



/// A single price observation from the oracle network.

#[contracttype]

#[derive(Clone, Debug)]

pub struct PriceData {

    /// Asset price in micro-USD (6 decimal places, e.g. 1 USD = 1_000_000).

    pub price_micro_usd: i128,

    /// Ledger timestamp when this price was recorded.

    pub timestamp: u64,

    /// Number of oracle sources that agreed on this price.

    pub sources: u32,

}



/// Rounding direction for token conversions.

///

/// - `Down`: round in favour of the protocol (e.g. fees charged, minimum

///   tokens debited).

/// - `Up`: round in favour of the user (e.g. payouts/credits).

#[contracttype]

#[derive(Clone, Copy, Debug, Eq, PartialEq)]

pub enum Rounding {

    Down = 0,

    Up = 1,

}



/// Errors returned by oracle conversions.

#[contracterror]

#[derive(Clone, Copy, Debug, Eq, PartialEq)]

#[repr(u32)]

pub enum ConversionError {

    /// USD amount must be greater than zero.

    InvalidAmount = 1,

    /// Oracle price is stale/unavailable (fallback would be used).

    StaleOrFallbackPrice = 2,

    /// Arithmetic overflow while converting.

    Overflow = 3,

    /// Token decimals are unsupported for i128 math.

    InvalidDecimals = 4,

    /// Division by zero / non-positive price.

    InvalidPrice = 5,

}



/// Result of an atomic valuation at execution time.

#[contracttype]

#[derive(Clone, Debug, Eq, PartialEq)]

pub struct ValuationResult {

    /// USD amount requested (micro-USD).

    pub usd_amount_micro: i128,

    /// Equivalent token amount in the token's smallest unit (e.g. stroops).

    pub token_amount: i128,

    /// Price used for the conversion (micro-USD per token).

    pub price_used: i128,

    /// Whether the fallback price was used instead of the live oracle price.

    pub used_fallback: bool,

    /// Token decimals used for conversion.

    pub token_decimals: u32,

    /// Rounding direction applied.

    pub rounding: Rounding,

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

}



// ---------------------------------------------------------------------------

// Oracle contract

// ---------------------------------------------------------------------------



#[contract]

pub struct OracleContract;



#[contractimpl]

impl OracleContract {

    // тФАтФА Admin тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА



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



    // тФАтФА Price feed тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА



    /// Push a new price observation. Callable only by the registered oracle.

    pub fn update_price(env: Env, caller: Address, price_data: PriceData) {

        caller.require_auth();



        // The check this contract is named for, and previously did not perform.

        //

        // `require_auth()` alone proves only that `caller` authorised the call тАФ

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



    /// Return the current price, falling back to the hardcoded rate if the

    /// oracle data is stale or unavailable.

    pub fn get_price(env: Env) -> PriceData {

        let now = env.ledger().timestamp();



        if let Some(data) = env

            .storage()

            .persistent()

            .get::<DataKey, PriceData>(&DataKey::LastPrice)

        {

            if now.saturating_sub(data.timestamp) <= MAX_PRICE_AGE_SECS {

                return data;

            }

        }



        // Fallback: return the hardcoded conservative price.

        PriceData {

            price_micro_usd: FALLBACK_PRICE_MICRO_USD,

            timestamp: now,

            sources: 0,

        }

    }



    // тФАтФА Atomic valuation тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА





    /// Convert a USD-denominated amount to token smallest units at the current

    /// live oracle price, atomically at the moment of execution.

    ///

    /// - `usd_amount_micro`: amount in micro-USD (6 decimals, e.g. $100 = 100_000_000).

    /// - `token_decimals`: token smallest-unit decimals (Stellar assets use 7).

    /// - `rounding`: `Down` favours the protocol (fees/debits), `Up` favours the

    ///   user (payouts/credits).

    ///

    /// Formula (overflow-safe): `usd_amount_micro * 10^token_decimals / price_micro_usd`.

    ///

    /// Returns `Err(StaleOrFallbackPrice)` when oracle data is stale/unavailable,

    /// refusing conversions on fallback prices.

    pub fn value_in_tokens(

        env: Env,

        usd_amount_micro: i128,

        token_decimals: u32,

        rounding: Rounding,

    ) -> Result<ValuationResult, ConversionError> {

        if usd_amount_micro <= 0 {

            return Err(ConversionError::InvalidAmount);

        }



        let price_data = Self::get_price(env.clone());

        let used_fallback = price_data.sources == 0;

        if used_fallback || price_data.price_micro_usd <= 0 {

            return Err(ConversionError::StaleOrFallbackPrice);

        }



        let token_amount = convert_usd_micro_to_token_units(

            usd_amount_micro,

            price_data.price_micro_usd,

            token_decimals,

            rounding,

        )?;



        Ok(ValuationResult {

            usd_amount_micro,

            token_amount,

            price_used: price_data.price_micro_usd,

            used_fallback,

            token_decimals,

            rounding,

        })

    }





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

    /// an absent admin as "anyone may proceed" тАФ an uninitialized contract must

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



/// Compute the absolute deviation between two prices in basis points.

fn deviation_bps(old: i128, new: i128) -> i128 {

    if old == 0 {

        return 0;

    }

    let diff = if new > old { new - old } else { old - new };

    diff * 10_000 / old

}



/// `10^decimals` as i128, or overflow/invalid-decimals error.

fn pow10_i128(decimals: u32) -> Result<i128, ConversionError> {

    if decimals > 38 {

        return Err(ConversionError::InvalidDecimals);

    }

    let mut value: i128 = 1;

    let mut i = 0u32;

    while i < decimals {

        value = value.checked_mul(10).ok_or(ConversionError::Overflow)?;

        i += 1;

    }

    Ok(value)

}



/// Convert micro-USD to token smallest units with explicit rounding.

///

/// `token_units = usd_amount_micro * 10^token_decimals / price_micro_usd`

fn convert_usd_micro_to_token_units(

    usd_amount_micro: i128,

    price_micro_usd: i128,

    token_decimals: u32,

    rounding: Rounding,

) -> Result<i128, ConversionError> {

    if usd_amount_micro <= 0 {

        return Err(ConversionError::InvalidAmount);

    }

    if price_micro_usd <= 0 {

        return Err(ConversionError::InvalidPrice);

    }

    let scale = pow10_i128(token_decimals)?;

    let numerator = usd_amount_micro

        .checked_mul(scale)

        .ok_or(ConversionError::Overflow)?;

    let base = numerator

        .checked_div(price_micro_usd)

        .ok_or(ConversionError::InvalidPrice)?;

    let remainder = numerator

        .checked_rem(price_micro_usd)

        .ok_or(ConversionError::InvalidPrice)?;

    let result = match rounding {

        Rounding::Down => base,

        Rounding::Up if remainder == 0 => base,

        Rounding::Up => base.checked_add(1).ok_or(ConversionError::Overflow)?,

    };

    Ok(result)

}

