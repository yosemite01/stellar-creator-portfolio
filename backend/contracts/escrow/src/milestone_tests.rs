//! Milestone sum invariant + per-milestone fee accounting (#1712), and the
//! oracle-staleness revert path (#1709).

extern crate std;

use crate::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{vec, Env};
use stellar_contract_test_utils::fuzz::{run_seeds, Rng};

fn setup(env: &Env, mint: i128) -> (EscrowContractClient<'static>, Address, Address, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let payer = Address::generate(env);
    let payee = Address::generate(env);
    StellarAssetClient::new(env, &token).mint(&payer, &mint);
    // The token admin doubles as the escrow's constructor admin.
    let cid = env.register(EscrowContract, (admin,));
    (EscrowContractClient::new(env, &cid), cid, token, payer, payee)
}

fn sym(env: &Env) -> Symbol {
    Symbol::new(env, "m")
}

// ── allocation ──────────────────────────────────────────────────────────────

#[test]
fn largest_remainder_sums_exactly() {
    let env = Env::default();
    let shares = allocate_largest_remainder(&env, 25, &vec![&env, 1, 1, 1]);
    assert_eq!(shares, vec![&env, 9, 8, 8]);

    let shares = allocate_largest_remainder(&env, 10, &vec![&env, 1, 2, 3, 4]);
    assert_eq!(shares, vec![&env, 1, 2, 3, 4]);

    // Remainders 0.5/0.3/0.2 style: largest remainder gets the leftover unit.
    let shares = allocate_largest_remainder(&env, 7, &vec![&env, 5, 3, 2]);
    let total: i128 = shares.iter().sum();
    assert_eq!(total, 7);
}

#[test]
fn largest_remainder_zero_fee_is_all_zero() {
    let env = Env::default();
    assert_eq!(allocate_largest_remainder(&env, 0, &vec![&env, 3, 4]), vec![&env, 0, 0]);
}

// ── sum invariant ───────────────────────────────────────────────────────────

#[test]
fn release_requires_complete_plan() {
    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 1000);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    c.add_milestone(&payer, &id, &0, &sym(&env), &400);
    assert_eq!(
        c.try_release_milestone(&payer, &id, &0),
        Err(Ok(EscrowError::MilestoneSumMismatch))
    );
}

#[test]
fn completing_plan_allocates_fee_shares() {
    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 1000);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    // escrow.amount = 975, fee = 25
    c.add_milestone(&payer, &id, &0, &sym(&env), &325);
    c.add_milestone(&payer, &id, &1, &sym(&env), &325);
    c.add_milestone(&payer, &id, &2, &sym(&env), &325);
    let fees: i128 = (0..3).map(|i| c.get_milestone(&id, &i).fee_share).sum();
    assert_eq!(fees, 25);
    assert_eq!(c.get_milestone_indices(&id), vec![&env, 0u32, 1, 2]);
}

#[test]
fn amend_rebalances_and_reallocates() {
    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 1000);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    c.add_milestone(&payer, &id, &0, &sym(&env), &500);
    c.add_milestone(&payer, &id, &1, &sym(&env), &475);
    c.amend_milestones(&payer, &id, &vec![&env, 0u32, 1], &vec![&env, 900i128, 75]);
    assert_eq!(c.get_milestone(&id, &0).amount, 900);
    let fees = c.get_milestone(&id, &0).fee_share + c.get_milestone(&id, &1).fee_share;
    assert_eq!(fees, 25);
}

#[test]
fn amend_with_wrong_sum_is_rejected() {
    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 1000);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    c.add_milestone(&payer, &id, &0, &sym(&env), &500);
    c.add_milestone(&payer, &id, &1, &sym(&env), &475);
    assert_eq!(
        c.try_amend_milestones(&payer, &id, &vec![&env, 0u32], &vec![&env, 499i128]),
        Err(Ok(EscrowError::MilestoneSumMismatch))
    );
    // Reverted: original amount kept.
    assert_eq!(c.get_milestone(&id, &0).amount, 500);
}

#[test]
fn amend_after_release_is_locked() {
    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 1000);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    c.add_milestone(&payer, &id, &0, &sym(&env), &500);
    c.add_milestone(&payer, &id, &1, &sym(&env), &475);
    c.release_milestone(&payer, &id, &0);
    assert_eq!(
        c.try_amend_milestones(&payer, &id, &vec![&env, 1u32], &vec![&env, 475i128]),
        Err(Ok(EscrowError::MilestoneAmendLocked))
    );
}

#[test]
fn payee_cannot_amend() {
    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 1000);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    c.add_milestone(&payer, &id, &0, &sym(&env), &975);
    assert_eq!(
        c.try_amend_milestones(&payee, &id, &vec![&env, 0u32], &vec![&env, 975i128]),
        Err(Ok(EscrowError::Unauthorized))
    );
}

#[test]
fn milestone_count_is_capped() {
    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 100_000);
    let id = c.deposit(&1, &payer, &payee, &100_000, &token, &ReleaseCondition::OnCompletion);
    for i in 0..MAX_MILESTONES {
        c.add_milestone(&payer, &id, &i, &sym(&env), &1);
    }
    assert_eq!(
        c.try_add_milestone(&payer, &id, &MAX_MILESTONES, &sym(&env), &1),
        Err(Ok(EscrowError::TooManyMilestones))
    );
}

/// Regression: `release_funds` after a partial milestone release used to pay
/// the full escrow amount again, draining other escrows' funds.
#[test]
fn release_funds_after_partial_milestones_pays_only_remainder() {
    let env = Env::default();
    let (c, cid, token, payer, payee) = setup(&env, 2000);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    let _other = c.deposit(&2, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    c.add_milestone(&payer, &id, &0, &sym(&env), &600);
    c.add_milestone(&payer, &id, &1, &sym(&env), &375);
    c.release_milestone(&payer, &id, &0);
    c.release_funds(&payer, &id);

    let t = TokenClient::new(&env, &token);
    assert_eq!(t.balance(&payee), 975);
    // Other escrow (975) + both fees (no admin set, held in contract).
    assert_eq!(t.balance(&cid), 975 + 50);
}

// ── property test: random splits ────────────────────────────────────────────

const REGRESSION_SEEDS: &[u64] = &[1, 2, 0xDEAD_BEEF];

#[test]
fn random_splits_pay_out_exactly_the_deposit() {
    run_seeds("escrow::milestone_splits", REGRESSION_SEEDS, |seed| {
        let mut rng = Rng::new(seed);
        let env = Env::default();
        let deposit = rng.amount(100, 50_000);
        let (c, cid, token, payer, payee) = setup(&env, deposit);
        let id = c.deposit(&1, &payer, &payee, &deposit, &token, &ReleaseCondition::OnCompletion);
        let escrow = c.get_escrow(&id);

        let parts = rng.range(1, 12.min(escrow.amount as u64)) as usize;
        let split = rng.split(escrow.amount, parts);
        for (i, amt) in split.iter().enumerate() {
            c.add_milestone(&payer, &id, &(i as u32), &sym(&env), amt);
        }

        // Release in random order.
        let mut order: std::vec::Vec<u32> = (0..parts as u32).collect();
        for i in (1..order.len()).rev() {
            let j = rng.index(i + 1);
            order.swap(i, j);
        }
        let mut fees = 0;
        for i in order {
            c.release_milestone(&payer, &id, &i);
            fees += c.get_milestone(&id, &i).fee_share;
        }

        let t = TokenClient::new(&env, &token);
        assert_eq!(fees, escrow.fee_collected, "fee charged exactly once");
        assert_eq!(t.balance(&payee) + fees, deposit, "paid + fees == deposited");
        assert_eq!(t.balance(&cid), escrow.fee_collected, "no dust left");
        assert!(c.get_escrow(&id).status == EscrowStatus::Complete);
    });
}

// ── #1709: stale oracle price reverts the dependent call ────────────────────

#[test]
fn stale_oracle_price_reverts_release() {
    use oracle::{OracleContract, OracleContractClient, PriceData, MAX_PRICE_AGE_SECS};

    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 1000);
    env.ledger().set_timestamp(10_000);

    let oracle_id = env.register(OracleContract, ());
    let o = OracleContractClient::new(&env, &oracle_id);
    let o_admin = Address::generate(&env);
    let feeder = Address::generate(&env);
    o.initialize(&o_admin);
    o.set_oracle(&o_admin, &feeder);
    o.update_price(&feeder, &PriceData { price_micro_usd: 120_000, timestamp: 10_000, sources: 1 });

    let admin = c.get_admin();
    c.set_oracle_address(&admin, &oracle_id);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);

    env.ledger().set_timestamp(10_000 + MAX_PRICE_AGE_SECS + 1);
    // Previously the oracle returned a hardcoded fallback stamped "now", so the
    // escrow's freshness check passed and funds moved at a fake price.
    assert!(c.try_release_funds(&payer, &id).is_err());
    assert!(c.get_escrow(&id).status == EscrowStatus::Active);
}

#[test]
fn fresh_oracle_price_allows_release() {
    use oracle::{OracleContract, OracleContractClient, PriceData};

    let env = Env::default();
    let (c, _, token, payer, payee) = setup(&env, 1000);
    env.ledger().set_timestamp(10_000);
    let oracle_id = env.register(OracleContract, ());
    let o = OracleContractClient::new(&env, &oracle_id);
    let o_admin = Address::generate(&env);
    let feeder = Address::generate(&env);
    o.initialize(&o_admin);
    o.set_oracle(&o_admin, &feeder);
    o.update_price(&feeder, &PriceData { price_micro_usd: 120_000, timestamp: 10_000, sources: 1 });

    let admin = c.get_admin();
    c.set_oracle_address(&admin, &oracle_id);
    let id = c.deposit(&1, &payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
    assert!(c.release_funds(&payer, &id));
}

