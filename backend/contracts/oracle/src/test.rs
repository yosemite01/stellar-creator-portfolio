#![cfg(test)]



//! Oracle tests: access-control (#1111) and valuation/decimals (#1829).



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



// тФАтФА Access control (#1111) тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА



#[test]

#[should_panic(expected = "Caller is not the registered oracle")]

fn arbitrary_address_cannot_push_a_price() {

    let (env, client, admin, oracle) = setup();

    client.initialize(&admin);

    client.set_oracle(&admin, &oracle);

    let attacker = Address::generate(&env);

    client.update_price(&attacker, &price(&env, 999_999));

}



#[test]

#[should_panic(expected = "No oracle registered")]

fn price_cannot_be_set_before_an_oracle_is_registered() {

    let (env, client, admin, _oracle) = setup();

    client.initialize(&admin);

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

    let new_oracle = Address::generate(&env);

    client.set_oracle(&admin, &new_oracle);

    client.update_price(&oracle, &price(&env, 121_000));

}



#[test]

#[should_panic(expected = "Caller is not the admin")]

fn non_admin_cannot_register_an_oracle() {

    let (env, client, admin, oracle) = setup();

    client.initialize(&admin);

    let impostor = Address::generate(&env);

    client.set_oracle(&impostor, &oracle);

}



#[test]

#[should_panic(expected = "Contract not initialized")]

fn set_oracle_fails_before_initialize() {

    let (_env, client, admin, oracle) = setup();

    client.set_oracle(&admin, &oracle);

}



#[test]

#[should_panic(expected = "Contract already initialized")]

fn initialize_is_once_only() {

    let (env, client, admin, _oracle) = setup();

    client.initialize(&admin);

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

    client.update_price(&oracle, &price(&env, 150_000));

}



#[test]

fn deviation_within_bound_is_accepted() {

    let (env, client, admin, oracle) = setup();

    client.initialize(&admin);

    client.set_oracle(&admin, &oracle);

    client.update_price(&oracle, &price(&env, 100_000));

    client.update_price(&oracle, &price(&env, 105_000));

    assert_eq!(client.get_price().price_micro_usd, 105_000);

}



// тФАтФА value_in_tokens (#1829): decimals, rounding, safety тФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФАтФА



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

