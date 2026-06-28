#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

fn setup() -> (Env, GovernanceContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);

    // Bootstrap: set admin via initial config storage
    let admin = Address::generate(&env);
    let config_key = soroban_sdk::Symbol::new(&env, "governance_config");
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(
            &config_key,
            &GovernanceConfig {
                platform_fee_percent: 50,
                min_bounty_budget: 100,
                max_bounty_budget: 1_000_000,
                dispute_resolution_period: 604_800,
                admin_address: admin.clone(),
                last_updated: 0,
            },
        );
    });

    (env, client, admin)
}

fn create_and_close_voting(
    env: &Env,
    client: &GovernanceContractClient,
    proposer: &Address,
) -> u64 {
    let id = client.create_proposal(
        proposer,
        &String::from_str(env, "Test proposal"),
        &String::from_str(env, "Description"),
        &1_u64, // 1-second voting period
    );
    // Advance ledger past deadline
    env.ledger().with_mut(|l| l.timestamp += 10);
    id
}

#[test]
fn test_quorum_met_passes() {
    let (env, client, admin) = setup();
    let proposer = Address::generate(&env);

    // 1000 total VP, need 10% = 100 votes participating
    client.set_total_voting_power(&admin, &1000_u64);
    // Default quorum is 10%

    let proposal_id = create_and_close_voting(&env, &client, &proposer);

    // Cast 200 yes-votes (20% participation — quorum met)
    // We reuse the same address but in a real scenario these would differ;
    // for the quorum test what matters is the accumulated yes_votes value.
    env.as_contract(client.address.as_ref().unwrap_or(&client.address), || {
        let key = (soroban_sdk::Symbol::new(&env, "proposal"), proposal_id);
        let mut p: Proposal = env.storage().persistent().get(&key).unwrap();
        p.yes_votes = 200;
        p.no_votes = 0;
        env.storage().persistent().set(&key, &p);
    });

    let result = client.finalize_proposal(&proposal_id);
    assert!(result);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, String::from_str(&env, "approved"));
}

#[test]
#[should_panic(expected = "QuorumNotMet")]
fn test_quorum_not_met_panics() {
    let (env, client, admin) = setup();
    let proposer = Address::generate(&env);

    // 1000 total VP, 10% quorum = 100 votes needed
    client.set_total_voting_power(&admin, &1000_u64);

    let proposal_id = create_and_close_voting(&env, &client, &proposer);

    // Only 50 votes cast (5% participation — below quorum)
    env.as_contract(client.address.as_ref().unwrap_or(&client.address), || {
        let key = (soroban_sdk::Symbol::new(&env, "proposal"), proposal_id);
        let mut p: Proposal = env.storage().persistent().get(&key).unwrap();
        p.yes_votes = 30;
        p.no_votes = 20;
        env.storage().persistent().set(&key, &p);
    });

    // Should panic: QuorumNotMet
    client.finalize_proposal(&proposal_id);
}

#[test]
fn test_quorum_threshold_is_governance_updatable() {
    let (env, client, admin) = setup();

    // Default is 10%
    assert_eq!(client.get_quorum_percent(), 10_u64);

    // Admin bumps it to 20%
    client.set_quorum_percent(&admin, &20_u64);
    assert_eq!(client.get_quorum_percent(), 20_u64);

    // Admin lowers it back to 5%
    client.set_quorum_percent(&admin, &5_u64);
    assert_eq!(client.get_quorum_percent(), 5_u64);
}
