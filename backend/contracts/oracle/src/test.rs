#![cfg(test)]

//! Access-control tests for the oracle price feed (issue #1111).
//!
//! The contract's purpose is to be a trustworthy price source for fiat-pegged
//! bounties. Before this fix `update_price` checked only that the caller had
//! signed for itself, never that it was the registered oracle — so these tests
//! are mostly about proving the door is now shut, from each direction it was
//! previously open.

use super::*;
use soroban_sdk::testutils::Address as _;

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

fn setup_with_price(micro_usd: i128) -> (Env, OracleContractClient<'static>) {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);
    client.update_price(&oracle, &price(&env, micro_usd));
    (env, client)
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

// ── #1709: no silent fallback pricing ───────────────────────────────────────

extern crate std;

use soroban_sdk::testutils::Ledger;
use soroban_sdk::{contract, contractimpl, symbol_short};

fn advance(env: &Env, secs: u64) {
    let now = env.ledger().timestamp();
    env.ledger().set_timestamp(now + secs);
}

fn ready(env: &Env, client: &OracleContractClient, admin: &Address, oracle: &Address) {
    env.ledger().set_timestamp(10_000);
    client.initialize(admin);
    client.set_oracle(admin, oracle);
}

#[test]
fn get_price_without_any_data_is_no_price() {
    let (_env, client, admin, _oracle) = setup();
    client.initialize(&admin);
    assert_eq!(client.try_get_price(), Err(Ok(OracleError::NoPrice)));
    assert!(client.get_price_unchecked().is_none());
}

#[test]
fn stale_price_is_an_error_not_a_fallback() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.update_price(&oracle, &price(&env, 130_000));

    advance(&env, MAX_PRICE_AGE_SECS + 1);

    // Regression: this used to return FALLBACK_PRICE_MICRO_USD (120_000).
    assert_eq!(client.try_get_price(), Err(Ok(OracleError::Stale)));
    assert_eq!(
        client.try_value_in_tokens(&1_000_000, &0, &Rounding::Down),
        Err(Ok(ConversionError::StaleOrFallbackPrice))
    );
}

#[test]
fn price_at_exact_max_age_is_still_fresh() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.update_price(&oracle, &price(&env, 130_000));
    advance(&env, MAX_PRICE_AGE_SECS);
    assert_eq!(client.get_price().price_micro_usd, 130_000);
}

#[test]
fn unchecked_price_flags_staleness() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.update_price(&oracle, &price(&env, 130_000));

    let fresh = client.get_price_unchecked().unwrap();
    assert!(!fresh.is_stale);
    assert_eq!(fresh.price.price_micro_usd, 130_000);

    advance(&env, MAX_PRICE_AGE_SECS + 1);
    let stale = client.get_price_unchecked().unwrap();
    assert!(stale.is_stale);
    assert_eq!(stale.price.price_micro_usd, 130_000);
}

#[test]
#[should_panic(expected = "Price timestamp is in the future")]
fn future_dated_price_is_rejected() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    let mut p = price(&env, 130_000);
    p.timestamp += 1_000_000;
    client.update_price(&oracle, &p);
}

#[test]
fn value_in_tokens_uses_live_price() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.update_price(&oracle, &price(&env, 100_000));
    let v = client.value_in_tokens(&1_000_000, &0, &Rounding::Down);
    assert_eq!(v.token_amount, 10);
    assert_eq!(v.price_used, 100_000);
    assert!(!v.used_fallback);
}

// ── Multi-reporter median ───────────────────────────────────────────────────

fn with_reporters(env: &Env, client: &OracleContractClient, admin: &Address, n: u32) -> std::vec::Vec<Address> {
    let mut out = std::vec::Vec::new();
    for _ in 0..n {
        let r = Address::generate(env);
        client.add_reporter(admin, &r);
        out.push(r);
    }
    out
}

#[test]
fn median_of_three_ignores_outlier() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    let reps = with_reporters(&env, &client, &admin, 3);
    client.set_quorum(&admin, &3);

    client.submit_report(&reps[0], &100_000);
    client.submit_report(&reps[1], &101_000);
    client.submit_report(&reps[2], &9_000_000); // manipulated outlier

    let p = client.get_price();
    assert_eq!(p.price_micro_usd, 101_000);
    assert_eq!(p.sources, 3);
}

#[test]
fn median_of_even_count_averages_middle_pair() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    let reps = with_reporters(&env, &client, &admin, 4);
    client.set_quorum(&admin, &2);
    client.submit_report(&reps[0], &100);
    client.submit_report(&reps[1], &300);
    client.submit_report(&reps[2], &200);
    client.submit_report(&reps[3], &1_000);
    assert_eq!(client.get_price().price_micro_usd, 250);
}

#[test]
fn quorum_not_met_with_fresh_reports_is_stale() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    let reps = with_reporters(&env, &client, &admin, 3);
    client.set_quorum(&admin, &2);

    client.submit_report(&reps[0], &100_000);
    advance(&env, MAX_PRICE_AGE_SECS + 1);
    client.submit_report(&reps[1], &100_000); // only one fresh report

    assert_eq!(client.try_get_price(), Err(Ok(OracleError::Stale)));
}

#[test]
fn quorum_falls_back_to_registered_oracle_only_if_fresh() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    let reps = with_reporters(&env, &client, &admin, 2);
    client.set_quorum(&admin, &2);
    client.submit_report(&reps[0], &100_000);
    client.update_price(&oracle, &price(&env, 120_000));
    // Quorum not met, primary oracle is fresh.
    assert_eq!(client.get_price().price_micro_usd, 120_000);
}

#[test]
#[should_panic(expected = "Caller is not a reporter")]
fn non_reporter_cannot_submit_report() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.submit_report(&Address::generate(&env), &100_000);
}

#[test]
#[should_panic(expected = "Caller is not the admin")]
fn non_admin_cannot_add_reporter() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.add_reporter(&Address::generate(&env), &Address::generate(&env));
}

#[test]
#[should_panic(expected = "Caller is not the admin")]
fn non_admin_cannot_set_quorum() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.set_quorum(&Address::generate(&env), &0);
}

#[test]
#[should_panic(expected = "Quorum exceeds reporter count")]
fn quorum_cannot_exceed_reporters() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    with_reporters(&env, &client, &admin, 1);
    client.set_quorum(&admin, &2);
}

#[test]
#[should_panic(expected = "Removal would break the quorum")]
fn removing_reporter_cannot_break_quorum() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    let reps = with_reporters(&env, &client, &admin, 2);
    client.set_quorum(&admin, &2);
    client.remove_reporter(&admin, &reps[0]);
}

#[test]
#[should_panic(expected = "Caller is not a reporter")]
fn removed_reporter_is_revoked() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    let reps = with_reporters(&env, &client, &admin, 2);
    client.remove_reporter(&admin, &reps[0]);
    assert_eq!(client.get_reporters().len(), 1);
    client.submit_report(&reps[0], &1);
}

// ── Reflector secondary source ──────────────────────────────────────────────

#[contract]
pub struct MockReflector;

#[contractimpl]
impl MockReflector {
    pub fn set(env: Env, price: i128, timestamp: u64, decimals: u32) {
        env.storage().instance().set(&symbol_short!("p"), &price);
        env.storage().instance().set(&symbol_short!("t"), &timestamp);
        env.storage().instance().set(&symbol_short!("d"), &decimals);
    }

    pub fn lastprice(env: Env, _asset: Asset) -> Option<ReflectorPriceData> {
        let price: Option<i128> = env.storage().instance().get(&symbol_short!("p"));
        price.map(|price| ReflectorPriceData {
            price,
            timestamp: env.storage().instance().get(&symbol_short!("t")).unwrap(),
        })
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage().instance().get(&symbol_short!("d")).unwrap_or(14)
    }
}

fn reflector(env: &Env, client: &OracleContractClient, admin: &Address) -> MockReflectorClient<'static> {
    let id = env.register(MockReflector, ());
    client.set_reflector(admin, &id, &Asset::Other(symbol_short!("XLM")));
    MockReflectorClient::new(env, &id)
}

#[test]
fn reflector_is_used_when_primary_is_stale() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.update_price(&oracle, &price(&env, 100_000));
    advance(&env, MAX_PRICE_AGE_SECS + 1);

    let r = reflector(&env, &client, &admin);
    // 0.11 USD with 14 decimals.
    r.set(&11_000_000_000_000, &env.ledger().timestamp(), &14);

    let p = client.get_price();
    assert_eq!(p.price_micro_usd, 110_000);
    assert!(client.value_in_tokens(&1_100_000, &0, &Rounding::Down).used_fallback);
}

#[test]
fn stale_reflector_does_not_rescue_a_stale_primary() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    let r = reflector(&env, &client, &admin);
    r.set(&110_000, &env.ledger().timestamp(), &6);
    advance(&env, MAX_PRICE_AGE_SECS + 1);
    assert_eq!(client.try_get_price(), Err(Ok(OracleError::Stale)));
}

#[test]
#[should_panic(expected = "Caller is not the admin")]
fn non_admin_cannot_set_reflector() {
    let (env, client, admin, oracle) = setup();
    ready(&env, &client, &admin, &oracle);
    client.set_reflector(&Address::generate(&env), &Address::generate(&env), &Asset::Other(symbol_short!("XLM")));
}

#[test]
fn to_micro_usd_scales_both_directions() {
    assert_eq!(to_micro_usd(12_345_678, 8), 123_456);
    assert_eq!(to_micro_usd(12, 2), 120_000);
    assert_eq!(to_micro_usd(7, 6), 7);
}

#[test]
fn value_in_tokens_returns_smallest_units_at_7_decimals() {

    // $0.50 at $1.00/token, 7 decimals => 5_000_000 stroops

    let (_env, client) = setup_with_price(1_000_000);

    let res = client.value_in_tokens(&500_000, &7, &Rounding::Down);

    assert_eq!(res.token_amount, 5_000_000);

    assert_eq!(res.price_used, 1_000_000);

    assert_eq!(res.token_decimals, 7);

    assert_eq!(res.rounding, Rounding::Down);

    assert!(!res.used_fallback);

}

#[test]

fn value_in_tokens_no_truncation_to_whole_tokens() {

    // $149.99 at $1.00/token => 149_990_000 stroops (7 decimals)

    let (_env, client) = setup_with_price(1_000_000);

    let res = client.value_in_tokens(&149_990_000, &7, &Rounding::Down);

    assert_eq!(res.token_amount, 1_499_900_000);

}

#[test]

fn value_in_tokens_rounds_down_for_protocol_fees() {

    // 1 micro-USD at $3/token, 7 decimals => 3.333.. stroops -> 3 down

    let (_env, client) = setup_with_price(3_000_000);

    let res = client.value_in_tokens(&1, &7, &Rounding::Down);

    assert_eq!(res.token_amount, 3);

}

#[test]

fn value_in_tokens_rounds_up_for_user_payouts() {

    // 1 micro-USD at $3/token, 7 decimals => 3.333.. stroops -> 4 up

    let (_env, client) = setup_with_price(3_000_000);

    let res = client.value_in_tokens(&1, &7, &Rounding::Up);

    assert_eq!(res.token_amount, 4);

}

#[test]

fn value_in_tokens_table_large_amount_and_varied_decimals() {

    // $1e9 at $0.25/token (250_000 micro-USD), 7 decimals => 4e16 stroops

    let (_env, client) = setup_with_price(250_000);

    let res = client.value_in_tokens(&1_000_000_000_000_000, &7, &Rounding::Down);

    assert_eq!(res.token_amount, 40_000_000_000_000_000);

    // $10 at $2/token, 0 decimals => 5 whole units

    let (_env, client) = setup_with_price(2_000_000);

    let res = client.value_in_tokens(&10_000_000, &0, &Rounding::Down);

    assert_eq!(res.token_amount, 5);

}

#[test]

fn value_in_tokens_overflow_boundary_errors() {

    // i128::MAX / 10^7 scaled by large USD should overflow

    let (_env, client) = setup_with_price(1);

    let err = client.try_value_in_tokens(&i128::MAX, &7, &Rounding::Down).err().unwrap();

    assert_eq!(err, Ok(ConversionError::Overflow));

}

#[test]

fn value_in_tokens_rejects_stale_or_fallback_price() {

    // No live oracle price pushed => get_price returns fallback (sources=0)

    let (_env, client, admin, _oracle) = setup();

    client.initialize(&admin);

    let err = client.try_value_in_tokens(&1_000_000, &7, &Rounding::Down).err().unwrap();

    assert_eq!(err, Ok(ConversionError::StaleOrFallbackPrice));

}

#[test]

fn value_in_tokens_rejects_invalid_amount() {

    let (_env, client) = setup_with_price(1_000_000);

    let err = client.try_value_in_tokens(&0, &7, &Rounding::Down).err().unwrap();

    assert_eq!(err, Ok(ConversionError::InvalidAmount));

}

#[test]

fn value_in_tokens_roundtrip_within_one_stroop() {

    // Converting back (token_units * price / 10^decimals) is within 1 stroop for Down

    let cases: &[(i128, i128, u32)] = &[

        (500_000, 1_000_000, 7),      // $0.50 @ $1

        (149_990_000, 1_000_000, 7),  // $149.99 @ $1

        (1, 3_000_000, 7),            // tiny

    ];

    for &(usd, p, d) in cases {

        let (_env, client) = setup_with_price(p);

        let down = client.value_in_tokens(&usd, &d, &Rounding::Down).token_amount;

        let up = client.value_in_tokens(&usd, &d, &Rounding::Up).token_amount;

        assert!(up >= down && up - down <= 1, "rounding differs by >1 stroop");

        // back-convert in micro-USD-equivalent smallest units: down*price/10^d <= usd

        let scale = 10_i128.pow(d);

        let back_down = down.saturating_mul(p) / scale;

        let back_up = up.saturating_mul(p) / scale;

        assert!(back_down <= usd, "down roundtrip exceeded input");

        assert!(usd.saturating_sub(back_up) <= p / scale + 1, "up roundtrip too far below");

    }

}
