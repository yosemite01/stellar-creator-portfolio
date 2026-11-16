#![cfg(test)]

//! Access-control tests for the oracle price feed (issue #1111).
//!
//! The contract's purpose is to be a trustworthy price source for fiat-pegged
//! bounties. Before this fix `update_price` checked only that the caller had
//! signed for itself, never that it was the registered oracle — so these tests
//! are mostly about proving the door is now shut, from each direction it was
//! previously open.

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};

fn setup() -> (Env, OracleContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(OracleContract, ());
    let client = OracleContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    (env, client, admin, oracle)
}

fn price(env: &Env, micro_usd: i128) -> PriceData {
    PriceData {
        price_micro_usd: micro_usd,
        timestamp: env.ledger().timestamp(),
        sources: 1,
    }
}

// ── The hole itself ──────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Caller is not the registered oracle")]
fn arbitrary_address_cannot_push_a_price() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);

    // Before the fix this succeeded: require_auth() proved only that the
    // attacker controlled its own address, which it always does.
    let attacker = Address::generate(&env);
    client.update_price(&attacker, &price(&env, 999_999));
}

#[test]
#[should_panic(expected = "No oracle registered")]
fn price_cannot_be_set_before_an_oracle_is_registered() {
    let (env, client, admin, _oracle) = setup();
    client.initialize(&admin);

    // The worst case previously: with no LastPrice there is nothing to deviate
    // from, so the first writer could set *any* positive price, and every later
    // update would be anchored to it — the deviation guard would then protect
    // the attacker's number rather than the real one.
    let attacker = Address::generate(&env);
    client.update_price(&attacker, &price(&env, 1));
}

#[test]
fn registered_oracle_can_push_a_price() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);

    client.update_price(&oracle, &price(&env, 120_000));

    assert_eq!(client.get_price().price_micro_usd, 120_000);
}

#[test]
#[should_panic(expected = "Caller is not the registered oracle")]
fn previous_oracle_cannot_push_after_being_replaced() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);
    client.update_price(&oracle, &price(&env, 120_000));

    // Rotating the oracle must actually revoke the old one.
    let new_oracle = Address::generate(&env);
    client.set_oracle(&admin, &new_oracle);
    client.update_price(&oracle, &price(&env, 121_000));
}

// ── Admin gating ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Caller is not the admin")]
fn non_admin_cannot_register_an_oracle() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);

    // Previously set_oracle's `admin` parameter was self-asserted — the caller
    // passed whichever address it controlled and require_auth() was satisfied.
    let impostor = Address::generate(&env);
    client.set_oracle(&impostor, &oracle);
}

#[test]
#[should_panic(expected = "Contract not initialized")]
fn set_oracle_fails_before_initialize() {
    let (_env, client, admin, oracle) = setup();

    // An uninitialized contract must be closed, not open — an absent admin is
    // not "anyone may proceed".
    client.set_oracle(&admin, &oracle);
}

#[test]
#[should_panic(expected = "Contract already initialized")]
fn initialize_is_once_only() {
    let (env, client, admin, _oracle) = setup();
    client.initialize(&admin);

    // Otherwise anyone could re-initialize and take over as admin.
    client.initialize(&Address::generate(&env));
}

#[test]
fn admin_can_rotate_the_oracle() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);

    let new_oracle = Address::generate(&env);
    client.set_oracle(&admin, &new_oracle);

    assert_eq!(client.get_oracle(), Some(new_oracle.clone()));
    client.update_price(&new_oracle, &price(&env, 120_000));
    assert_eq!(client.get_price().price_micro_usd, 120_000);
}

// ── Existing guards still apply to the registered oracle ─────────────────────

#[test]
#[should_panic(expected = "Price must be positive")]
fn registered_oracle_still_cannot_push_a_non_positive_price() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);

    client.update_price(&oracle, &price(&env, 0));
}

#[test]
#[should_panic(expected = "Price deviation exceeds allowed threshold")]
fn registered_oracle_still_cannot_exceed_the_deviation_bound() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);
    client.update_price(&oracle, &price(&env, 100_000));

    // +50%, well beyond MAX_PRICE_DEVIATION_BPS (10%). Authentication must not
    // become a bypass for the sanity checks.
    client.update_price(&oracle, &price(&env, 150_000));
}

#[test]
fn deviation_within_bound_is_accepted() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);
    client.update_price(&oracle, &price(&env, 100_000));

    // +5%, inside the bound.
    client.update_price(&oracle, &price(&env, 105_000));
    assert_eq!(client.get_price().price_micro_usd, 105_000);
}

// ── Value in tokens tests (Issue #1829) ──────────────────────────────────────

fn setup_active_oracle(price_micro_usd: i128) -> (Env, OracleContractClient<'static>) {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);
    client.update_price(&oracle, &price(&env, price_micro_usd));
    (env, client)
}

#[test]
fn value_in_tokens_rejects_fallback_price() {
    let (_env, client, admin, _oracle) = setup();
    client.initialize(&admin);

    // No live price pushed: get_price returns fallback (sources == 0).
    // Conversions must refuse fallback prices.
    let res = client.try_value_in_tokens(&100_000_000, &7, &Rounding::Floor);
    assert_eq!(res, Err(Ok(OracleError::PriceUnavailable)));
}

#[test]
fn value_in_tokens_rejects_stale_price() {
    let (env, client) = setup_active_oracle(1_000_000);

    // Fast-forward past MAX_PRICE_AGE_SECS (300 seconds)
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MAX_PRICE_AGE_SECS + 1);

    let res = client.try_value_in_tokens(&100_000_000, &7, &Rounding::Floor);
    assert_eq!(res, Err(Ok(OracleError::PriceUnavailable)));
}

#[test]
fn value_in_tokens_rejects_non_positive_amount() {
    let (_env, client) = setup_active_oracle(1_000_000);

    assert_eq!(
        client.try_value_in_tokens(&0, &7, &Rounding::Floor),
        Err(Ok(OracleError::AmountMustBePositive))
    );
    assert_eq!(
        client.try_value_in_tokens(&(-1_000_000), &7, &Rounding::Floor),
        Err(Ok(OracleError::AmountMustBePositive))
    );
}

#[test]
fn value_in_tokens_rejects_invalid_decimals() {
    let (_env, client) = setup_active_oracle(1_000_000);

    assert_eq!(
        client.try_value_in_tokens(&1_000_000, &19, &Rounding::Floor),
        Err(Ok(OracleError::InvalidDecimals))
    );
}

#[test]
fn value_in_tokens_table_values_no_truncation() {
    // $1.00 per token = 1_000_000 micro-USD
    let (_env, client) = setup_active_oracle(1_000_000);

    // Case 1: $0.50 (500_000 micro-USD) at $1.00/token with 7 decimals.
    // Previously truncated to 0 whole tokens. Now gives 5_000_000 stroops (0.5 XLM).
    let half_dollar = client.value_in_tokens(&500_000, &7, &Rounding::Floor);
    assert_eq!(half_dollar.usd_amount_micro, 500_000);
    assert_eq!(half_dollar.token_amount, 5_000_000);
    assert_eq!(half_dollar.price_used, 1_000_000);
    assert_eq!(half_dollar.decimals, 7);
    assert_eq!(half_dollar.rounding, Rounding::Floor);
    assert!(!half_dollar.used_fallback);

    // Case 2: $149.99 (149_990_000 micro-USD) at $1.00/token with 7 decimals.
    // Previously truncated to 149 whole tokens (losing 0.99 tokens).
    let fractional = client.value_in_tokens(&149_990_000, &7, &Rounding::Floor);
    assert_eq!(fractional.token_amount, 1_499_900_000);

    // Case 3: $1,000,000,000 ($1e9 = 1_000_000_000_000_000 micro-USD) with 7 decimals.
    // 1 billion tokens = 10_000_000_000_000_000 stroops.
    let one_billion_usd: i128 = 1_000_000_000_i128 * 1_000_000;
    let large_val = client.value_in_tokens(&one_billion_usd, &7, &Rounding::Floor);
    assert_eq!(large_val.token_amount, 10_000_000_000_000_000);

    // Case 4: 6 decimals (like USDC).
    let usdc_val = client.value_in_tokens(&500_000, &6, &Rounding::Floor);
    assert_eq!(usdc_val.token_amount, 500_000);

    // Case 5: 18 decimals (like ETH/EVM standard).
    let eth_val = client.value_in_tokens(&1_000_000, &18, &Rounding::Floor);
    assert_eq!(eth_val.token_amount, 1_000_000_000_000_000_000);
}

#[test]
fn value_in_tokens_rounding_direction_semantics() {
    // 1 token = $0.12 = 120_000 micro-USD
    let (_env, client) = setup_active_oracle(120_000);

    // Convert $1.00 = 1_000_000 micro-USD with 7 decimals:
    // numerator = 1_000_000 * 10^7 = 10_000_000_000_000
    // 10_000_000_000_000 / 120_000 = 83_333_333 remainder 40_000
    let floor_val = client.value_in_tokens(&1_000_000, &7, &Rounding::Floor);
    assert_eq!(floor_val.token_amount, 83_333_333);
    assert_eq!(floor_val.rounding, Rounding::Floor);

    let ceil_val = client.value_in_tokens(&1_000_000, &7, &Rounding::Ceil);
    assert_eq!(ceil_val.token_amount, 83_333_334);
    assert_eq!(ceil_val.rounding, Rounding::Ceil);

    // Exactly 1 stroop difference when remainder exists
    assert_eq!(ceil_val.token_amount - floor_val.token_amount, 1);
}

#[test]
fn value_in_tokens_round_trip_property() {
    // Test that converting USD -> token_amount and back preserves amount within 1 stroop
    let (_env, client) = setup_active_oracle(125_000); // $0.125 / token

    let test_cases = [
        100_000,       // $0.10
        500_000,       // $0.50
        1_000_000,     // $1.00
        12_345_678,    // $12.345678
        99_999_999,    // $99.999999
        1_000_000_000, // $1000.00
    ];

    let decimals = 7;
    let factor = 10_i128.pow(decimals);
    let price_micro = 125_000;

    for &usd in &test_cases {
        let val_floor = client.value_in_tokens(&usd, &decimals, &Rounding::Floor);
        // Recover USD from token amount: token_amount * price / factor
        let recovered_usd = (val_floor.token_amount * price_micro) / factor;
        // The difference in recovered USD must not exceed 1 token unit in micro-USD (price / factor + 1)
        let diff = usd - recovered_usd;
        assert!(
            diff >= 0,
            "Floor valuation must not over-credit token value"
        );
        assert!(
            diff <= (price_micro / factor) + 1,
            "Recovered USD delta must be within 1 token unit (diff={}, usd={})",
            diff,
            usd
        );
    }
}

#[test]
fn value_in_tokens_overflow_boundary() {
    let (_env, client) = setup_active_oracle(1_000_000);

    // Extremely huge USD value that overflows i128 when scaled by 10^18
    let huge_usd = i128::MAX / 10;
    let res = client.try_value_in_tokens(&huge_usd, &18, &Rounding::Floor);
    assert_eq!(res, Err(Ok(OracleError::Overflow)));
}
