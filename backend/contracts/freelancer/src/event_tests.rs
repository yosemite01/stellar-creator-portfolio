#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    vec, Address, Env, IntoVal, String,
};

use crate::{FreelancerContract, FreelancerContractClient};

// ---------------------------------------------------------------------------
// Registration event
// ---------------------------------------------------------------------------

#[test]
fn test_registration_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FreelancerContract, ());
    let client = FreelancerContractClient::new(&env, &contract_id);

    let freelancer = Address::generate(&env);
    let name = String::from_str(&env, "Alice");

    client.register_freelancer(
        &freelancer,
        &name,
        &String::from_str(&env, "UI/UX Design"),
        &String::from_str(&env, "5 years experience"),
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (_, topics, _) = events.get(0).unwrap();
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("freelancer").into_val(&env),
            symbol_short!("registered").into_val(&env),
            freelancer.into_val(&env),
        ]
    );
}

#[test]
fn test_registration_event_data_matches_storage() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FreelancerContract, ());
    let client = FreelancerContractClient::new(&env, &contract_id);

    let freelancer = Address::generate(&env);
    client.register_freelancer(
        &freelancer,
        &String::from_str(&env, "Bob"),
        &String::from_str(&env, "Writing"),
        &String::from_str(&env, "Content writer"),
    );

    let profile = client.get_profile(&freelancer);
    let events = env.events().all();
    let (_, _, data) = events.get(0).unwrap();
    let (emitted_name, emitted_ts): (String, u64) = data.into_val(&env);

    assert_eq!(emitted_name, profile.name);
    assert_eq!(emitted_ts, profile.created_at);
}

// ---------------------------------------------------------------------------
// Rating event
// ---------------------------------------------------------------------------

#[test]
fn test_rating_emits_event_with_correct_topics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FreelancerContract, ());
    let client = FreelancerContractClient::new(&env, &contract_id);

    let freelancer = Address::generate(&env);
    client.register_freelancer(
        &freelancer,
        &String::from_str(&env, "Carol"),
        &String::from_str(&env, "Marketing"),
        &String::from_str(&env, "Growth marketer"),
    );

    client.update_rating(&freelancer, &80);

    let events = env.events().all();
    // events[0] = registered, events[1] = rated
    assert_eq!(events.len(), 2);

    let (_, topics, _) = events.get(1).unwrap();
    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("freelancer").into_val(&env),
            symbol_short!("rated").into_val(&env),
            freelancer.into_val(&env),
        ]
    );
}

#[test]
fn test_rating_event_data_matches_aggregate() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FreelancerContract, ());
    let client = FreelancerContractClient::new(&env, &contract_id);

    let freelancer = Address::generate(&env);
    client.register_freelancer(
        &freelancer,
        &String::from_str(&env, "Dave"),
        &String::from_str(&env, "Product"),
        &String::from_str(&env, "PM"),
    );

    // Two ratings: 60 and 100 → aggregate = (60+100)/2 = 80
    client.update_rating(&freelancer, &60);
    client.update_rating(&freelancer, &100);

    let events = env.events().all();
    let (_, _, data) = events.last().unwrap();
    let (emitted_rating, emitted_reviews): (u32, u32) = data.into_val(&env);

    let profile = client.get_profile(&freelancer);
    assert_eq!(emitted_rating, profile.rating);
    assert_eq!(emitted_reviews, profile.total_rating_count);
    assert_eq!(emitted_reviews, 2);
}

// ---------------------------------------------------------------------------
// Verification event
// ---------------------------------------------------------------------------

#[test]
fn test_verification_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(FreelancerContract, ());
    let client = FreelancerContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.register_freelancer(
        &freelancer,
        &String::from_str(&env, "Eve"),
        &String::from_str(&env, "Legal"),
        &String::from_str(&env, "Compliance specialist"),
    );

    client.verify_freelancer(&admin, &freelancer);

    let events = env.events().all();
    // events[0] = registered, events[1] = verified
    assert_eq!(events.len(), 2);

    let (_, topics, data) = events.get(1).unwrap();

    assert_eq!(
        topics,
        vec![
            &env,
            symbol_short!("freelancer").into_val(&env),
            symbol_short!("verified").into_val(&env),
            freelancer.clone().into_val(&env),
        ]
    );

    let (emitted_verifier, emitted_status): (Address, bool) = data.into_val(&env);
    assert_eq!(emitted_verifier, admin);
    assert!(emitted_status);
    assert!(client.is_verified(&freelancer));
}
