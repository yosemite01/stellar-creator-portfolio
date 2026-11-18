#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{Env, String};
use stellar_contract_test_utils::{assert_requires_auth, new_address, setup_funded_token, test_env, unauthorized_env};

fn setup() -> (Env, GovernanceContractClient<'static>, Address) {
    let env = test_env();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);

    let admin = new_address(&env);
    client.initialize(&admin);

    (env, client, admin)
}

/// Register a voting token, deposit `amount` for each holder, then move to a
/// later ledger so the deposits are visible at the next proposal's snapshot.
fn fund_voters(env: &Env, client: &GovernanceContractClient, admin: &Address, holders: &[(Address, i128)]) {
    let minter = new_address(env);
    let token = setup_funded_token(env, &minter, 1);
    client.set_voting_token(admin, &token);
    let sac = soroban_sdk::token::StellarAssetClient::new(env, &token);
    for (holder, amount) in holders {
        sac.mint(holder, amount);
        client.deposit_votes(holder, amount);
    }
    env.ledger().with_mut(|l| l.sequence_number += 1);
}

fn open_proposal(env: &Env, client: &GovernanceContractClient, proposer: &Address) -> u64 {
    client.create_proposal(
        proposer,
        &String::from_str(env, "Test proposal"),
        &String::from_str(env, "Description"),
        &100_u64,
    )
}

fn close_voting(env: &Env) {
    env.ledger().with_mut(|l| l.timestamp += 1_000);
}

#[test]
fn test_quorum_met_passes() {
    let (env, client, admin) = setup();
    let whale = new_address(&env);
    let small = new_address(&env);
    fund_voters(&env, &client, &admin, &[(whale.clone(), 900), (small.clone(), 100)]);

    let id = open_proposal(&env, &client, &new_address(&env));
    client.vote_weighted(&whale, &id, &true);
    close_voting(&env);

    assert!(client.finalize_proposal(&id));
    assert_eq!(client.get_proposal(&id).status, String::from_str(&env, "approved"));
}

#[test]
#[should_panic(expected = "QuorumNotMet")]
fn test_quorum_not_met_panics() {
    let (env, client, admin) = setup();
    let whale = new_address(&env);
    let small = new_address(&env);
    // 50 / 1050 ≈ 4.7% participation, below the default 10%.
    fund_voters(&env, &client, &admin, &[(whale, 1_000), (small.clone(), 50)]);

    let id = open_proposal(&env, &client, &new_address(&env));
    client.vote_weighted(&small, &id, &true);
    close_voting(&env);

    client.finalize_proposal(&id);
}

#[test]
fn test_quorum_denominator_is_snapshot_supply() {
    let (env, client, admin) = setup();
    let a = new_address(&env);
    let b = new_address(&env);
    fund_voters(&env, &client, &admin, &[(a.clone(), 600), (b.clone(), 400)]);
    assert_eq!(client.get_total_voting_power(), 1_000);

    let id = open_proposal(&env, &client, &new_address(&env));
    let snapshot = client.get_proposal_snapshot(&id);
    assert_eq!(client.get_past_total_voting_power(&snapshot), 1_000);
    assert_eq!(client.get_proposal_quorum(&id), (1_000_i128, 10_u64));
}

#[test]
fn test_supply_changes_after_creation_do_not_move_quorum() {
    let (env, client, admin) = setup();
    let voter = new_address(&env);
    let late = new_address(&env);
    fund_voters(&env, &client, &admin, &[(voter.clone(), 200), (late.clone(), 800)]);

    let id = open_proposal(&env, &client, &new_address(&env));

    // A huge deposit after creation would push participation under 10% if the
    // denominator were live supply; a withdrawal would inflate it.
    let token = client.get_voting_token().unwrap();
    let whale = new_address(&env);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&whale, &1_000_000);
    client.deposit_votes(&whale, &1_000_000);
    client.withdraw_votes(&late, &800);
    assert_eq!(client.get_total_voting_power(), 1_000_200);
    assert_eq!(client.get_proposal_quorum(&id).0, 1_000);

    client.vote_weighted(&voter, &id, &true);
    close_voting(&env);
    assert!(client.finalize_proposal(&id)); // 200 / 1000 = 20%
}

#[test]
fn test_admin_cannot_alter_quorum_of_open_proposal() {
    let (env, client, admin) = setup();
    let voter = new_address(&env);
    fund_voters(&env, &client, &admin, &[(voter.clone(), 150), (new_address(&env), 850)]);

    let id = open_proposal(&env, &client, &new_address(&env));
    // Admin raises the global quorum to 90% while the proposal is open.
    client.set_quorum_percent(&admin, &90_u64);
    assert_eq!(client.get_proposal_quorum(&id).1, 10);

    client.vote_weighted(&voter, &id, &true);
    close_voting(&env);
    assert!(client.finalize_proposal(&id)); // 15% >= frozen 10%

    // New proposals pick up the new threshold.
    let next = open_proposal(&env, &client, &new_address(&env));
    assert_eq!(client.get_proposal_quorum(&next).1, 90);
}

#[test]
#[should_panic(expected = "No voting power at snapshot")]
fn test_finalize_without_deposits_panics() {
    let (env, client, _admin) = setup();
    let id = open_proposal(&env, &client, &new_address(&env));
    close_voting(&env);
    client.finalize_proposal(&id);
}

fn strip_quorum_snapshot(env: &Env, client: &GovernanceContractClient, id: u64) {
    env.as_contract(&client.address, || {
        env.storage().persistent().remove(&(soroban_sdk::Symbol::new(env, "snap_tvp"), id));
        env.storage().persistent().remove(&(soroban_sdk::Symbol::new(env, "snap_q"), id));
        env.storage().persistent().set(&soroban_sdk::Symbol::new(env, "total_vp"), &5_u64);
    });
}

#[test]
#[should_panic(expected = "Proposal has no quorum snapshot")]
fn test_legacy_proposal_requires_migration() {
    let (env, client, admin) = setup();
    let voter = new_address(&env);
    fund_voters(&env, &client, &admin, &[(voter.clone(), 1_000)]);
    let id = open_proposal(&env, &client, &new_address(&env));
    strip_quorum_snapshot(&env, &client, id);
    client.vote_weighted(&voter, &id, &true);
    close_voting(&env);
    client.finalize_proposal(&id);
}

#[test]
fn test_legacy_proposal_migration() {
    let (env, client, admin) = setup();
    let voter = new_address(&env);
    fund_voters(&env, &client, &admin, &[(voter.clone(), 1_000)]);
    let id = open_proposal(&env, &client, &new_address(&env));
    strip_quorum_snapshot(&env, &client, id);

    assert_eq!(client.migrate_proposal_quorum(&id), (1_000_i128, 10_u64));
    env.as_contract(&client.address, || {
        assert!(!env.storage().persistent().has(&soroban_sdk::Symbol::new(&env, "total_vp")));
    });

    client.vote_weighted(&voter, &id, &true);
    close_voting(&env);
    assert!(client.finalize_proposal(&id));
}

#[test]
#[should_panic(expected = "Quorum snapshot already set")]
fn test_migration_cannot_overwrite_snapshot() {
    let (env, client, admin) = setup();
    fund_voters(&env, &client, &admin, &[(new_address(&env), 1_000)]);
    let id = open_proposal(&env, &client, &new_address(&env));
    client.migrate_proposal_quorum(&id);
}

#[test]
fn test_keeper_extends_proposal_entries() {
    use soroban_sdk::testutils::storage::Persistent as _;
    let (env, client, admin) = setup();
    fund_voters(&env, &client, &admin, &[(new_address(&env), 1_000)]);
    let id = open_proposal(&env, &client, &new_address(&env));

    env.ledger().with_mut(|l| l.sequence_number += 100 * stellar_contract_ttl::LEDGERS_PER_DAY);
    let ids = soroban_sdk::vec![&env, id, 999_u64];
    assert_eq!(client.extend_proposal_ttl(&ids), 1);

    env.as_contract(&client.address, || {
        let ttl_left = env
            .storage()
            .persistent()
            .get_ttl(&(soroban_sdk::Symbol::new(&env, "proposal"), id));
        assert!(ttl_left >= stellar_contract_ttl::TtlPolicy::UserEntry.threshold());
    });
    env.ledger().with_mut(|l| l.sequence_number += 100 * stellar_contract_ttl::LEDGERS_PER_DAY);
    assert_eq!(client.get_proposal(&id).id, id);
}

#[test]
fn test_quorum_threshold_is_governance_updatable() {
    let (_env, client, admin) = setup();

    // Default is 10%
    assert_eq!(client.get_quorum_percent(), 10_u64);

    // Admin bumps it to 20%
    client.set_quorum_percent(&admin, &20_u64);
    assert_eq!(client.get_quorum_percent(), 20_u64);

    // Admin lowers it back to 5%
    client.set_quorum_percent(&admin, &5_u64);
    assert_eq!(client.get_quorum_percent(), 5_u64);
}

#[test]
fn test_set_quorum_percent_requires_auth() {
    let env = unauthorized_env();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);

    let admin = new_address(&env);
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

    assert_requires_auth(|| {
        client.set_quorum_percent(&admin, &20_u64);
    });
}

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin) = setup();
    let config = client.get_config();
    assert_eq!(config.admin_address, admin);
    assert_eq!(config.platform_fee_percent, 50);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_initialize_panics() {
    let env = test_env();
    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    let admin = new_address(&env);
    client.initialize(&admin);
    let other = new_address(&env);
    client.initialize(&other);
}
