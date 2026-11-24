//! Solvency (#1706) and path-independent yield accrual (#1707) tests.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Env,
};

const YEAR: u64 = SECONDS_PER_YEAR;

struct Ctx {
    env: Env,
    cid: Address,
    admin: Address,
    token: Address,
    payer: Address,
    payee: Address,
}

impl Ctx {
    fn new(mint: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&payer, &mint);
        let admin = Address::generate(&env);
        let cid = env.register(EscrowContract, (admin.clone(),));
        Ctx { env, cid, admin, token, payer, payee }
    }

    fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.cid)
    }

    fn deposit(&self, amount: i128) -> u64 {
        self.client().deposit(
            &1u64,
            &self.payer,
            &self.payee,
            &amount,
            &self.token,
            &ReleaseCondition::OnCompletion,
        )
    }

    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(who)
    }

    fn mint_to_contract(&self, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(&self.cid, &amount);
    }
}

// ── #1706: no drain of other escrows' principal ──────────────────────────────

#[test]
fn withdraw_yield_is_disabled_by_default() {
    let c = Ctx::new(20_000);
    let client = c.client();
    client.configure_yield(&c.admin, &300, &500, &9000);
    let id = c.deposit(10_000);
    c.env.ledger().set_timestamp(1_000 + YEAR);
    client.accrue_yield(&id);
    assert!(!client.is_yield_withdraw_enabled());
    assert_eq!(
        client.try_withdraw_yield(&c.admin, &id),
        Err(Ok(EscrowError::YieldWithdrawDisabled))
    );
}

#[test]
fn non_admin_cannot_enable_yield_withdraw() {
    let c = Ctx::new(1_000);
    let stranger = Address::generate(&c.env);
    assert_eq!(
        c.client().try_set_yield_withdraw_enabled(&stranger, &true),
        Err(Ok(EscrowError::Unauthorized))
    );
    assert!(!c.client().is_yield_withdraw_enabled());
}

#[test]
fn regression_withdraw_yield_cannot_drain_second_escrow() {
    let c = Ctx::new(20_000);
    let client = c.client();
    client.configure_yield(&c.admin, &10_000, &10_000, &9000);
    client.set_yield_withdraw_enabled(&c.admin, &true);

    let a = c.deposit(10_000);
    let b = c.deposit(10_000);
    let principal_a = client.get_escrow(&a).amount;
    let principal_b = client.get_escrow(&b).amount;
    assert_eq!(client.get_total_liabilities(&c.token), principal_a + principal_b);

    // A year at 100 % "accrues" a full principal of virtual yield on A.
    c.env.ledger().set_timestamp(1_000 + YEAR);
    client.accrue_yield(&a);
    assert!(client.get_accrued_yield(&a) > 0);

    // No real yield arrived, so there is nothing to withdraw.
    assert_eq!(client.get_surplus(&c.token), 0);
    assert_eq!(
        client.try_withdraw_yield(&c.admin, &a),
        Err(Ok(EscrowError::NoYieldToWithdraw))
    );

    // Both escrows still pay out in full.
    client.release_funds(&c.payer, &b);
    client.release_funds(&c.payer, &a);
    assert_eq!(c.balance(&c.payee), principal_a + principal_b);
    assert_eq!(client.get_total_liabilities(&c.token), 0);
}

#[test]
fn withdraw_yield_is_bounded_by_measured_surplus() {
    let c = Ctx::new(20_000);
    let client = c.client();
    client.configure_yield(&c.admin, &10_000, &10_000, &9000);
    client.set_yield_withdraw_enabled(&c.admin, &true);

    let a = c.deposit(10_000);
    let b = c.deposit(10_000);
    c.env.ledger().set_timestamp(1_000 + YEAR);
    client.accrue_yield(&a);
    let accrued = client.get_accrued_yield(&a);

    // Strategy returns only 7 units of real yield.
    c.mint_to_contract(7);
    assert_eq!(client.get_surplus(&c.token), 7);

    let admin_before = c.balance(&c.admin);
    assert_eq!(client.withdraw_yield(&c.admin, &a), 7);
    assert_eq!(c.balance(&c.admin) - admin_before, 7);
    assert_eq!(client.get_accrued_yield(&a), accrued - 7);
    assert_eq!(client.get_surplus(&c.token), 0);

    // Second withdrawal finds no surplus.
    assert_eq!(
        client.try_withdraw_yield(&c.admin, &a),
        Err(Ok(EscrowError::NoYieldToWithdraw))
    );

    let pb = client.get_escrow(&b).amount;
    client.refund_escrow(&c.payer, &a);
    client.release_funds(&c.payee, &b);
    assert_eq!(c.balance(&c.payee), pb);
    assert_eq!(c.balance(&c.cid), 0);
}

#[test]
fn release_after_partial_milestone_pays_only_remaining() {
    let c = Ctx::new(20_000);
    let client = c.client();
    let a = c.deposit(1_000); // net 975
    let b = c.deposit(1_000);
    let desc = Symbol::new(&c.env, "phase1");
    client.add_milestone(&c.payer, &a, &0, &desc, &400);
    client.release_milestone(&c.payer, &a, &0);
    assert_eq!(client.get_total_liabilities(&c.token), 975 - 400 + 975);

    client.release_funds(&c.payer, &a);
    assert_eq!(c.balance(&c.payee), 975);
    // B is untouched and still fully releasable.
    client.release_funds(&c.payer, &b);
    assert_eq!(c.balance(&c.payee), 975 * 2);
    assert_eq!(client.get_total_liabilities(&c.token), 0);
}

#[test]
fn migrate_liabilities_counts_only_uncounted_open_escrows() {
    let c = Ctx::new(20_000);
    let client = c.client();
    let a = c.deposit(1_000);
    let b = c.deposit(1_000);
    client.release_funds(&c.payer, &b);

    // Simulate a pre-#1706 escrow: forget its liability bookkeeping.
    c.env.as_contract(&c.cid, || {
        c.env.storage().persistent().remove(&DataKey::LiabilityCounted(a));
        c.env.storage().persistent().remove(&DataKey::Liabilities(c.token.clone()));
    });
    assert_eq!(client.get_total_liabilities(&c.token), 0);

    assert_eq!(client.migrate_liabilities(&c.admin, &1, &2), 1);
    assert_eq!(client.get_total_liabilities(&c.token), 975);
    // Idempotent.
    assert_eq!(client.migrate_liabilities(&c.admin, &1, &2), 0);
    assert_eq!(client.get_total_liabilities(&c.token), 975);

    let stranger = Address::generate(&c.env);
    assert_eq!(
        client.try_migrate_liabilities(&stranger, &1, &2),
        Err(Ok(EscrowError::Unauthorized))
    );
}

// ── #1706: invariant fuzz ─────────────────────────────────────────────────────

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

fn owed(c: &Ctx, ids: &[u64]) -> i128 {
    let client = c.client();
    let mut total = 0;
    for id in ids {
        let e = client.get_escrow(id);
        if e.status == EscrowStatus::Active || e.status == EscrowStatus::Disputed {
            let (_, _, released, _) = client.get_milestone_progress(id);
            total += e.amount - released;
        }
    }
    total
}

#[test]
fn fuzz_solvency_invariant_holds_for_random_sequences() {
    extern crate std;
    use std::vec::Vec;

    for seed in 1..=8u64 {
        let c = Ctx::new(1_000_000_000);
        let client = c.client();
        client.configure_yield(&c.admin, &5_000, &10_000, &9000);
        client.set_yield_withdraw_enabled(&c.admin, &true);
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
        let mut ids: Vec<u64> = Vec::new();
        let mut now = 1_000u64;

        for _ in 0..60 {
            now += rng.below(30 * 24 * 3600);
            c.env.ledger().set_timestamp(now);
            let pick = |rng: &mut Rng, ids: &Vec<u64>| ids[rng.below(ids.len() as u64) as usize];
            match rng.below(9) {
                0 | 1 => {
                    let amount = 1 + rng.below(50_000) as i128;
                    ids.push(c.deposit(amount));
                }
                2 if !ids.is_empty() => {
                    let _ = client.try_release_funds(&c.payer, &pick(&mut rng, &ids));
                }
                3 if !ids.is_empty() => {
                    let _ = client.try_refund_escrow(&c.payer, &pick(&mut rng, &ids));
                }
                4 if !ids.is_empty() => {
                    let id = pick(&mut rng, &ids);
                    let idx = rng.below(4) as u32;
                    let amt = 1 + rng.below(10_000) as i128;
                    let desc = Symbol::new(&c.env, "m");
                    if client.try_add_milestone(&c.payer, &id, &idx, &desc, &amt).is_ok() {
                        let _ = client.try_release_milestone(&c.payer, &id, &idx);
                    }
                }
                5 if !ids.is_empty() => {
                    let id = pick(&mut rng, &ids);
                    // Disputes without an arbiter panel settle 50/50 once expired (#1713).
                    if client.try_dispute_escrow(&c.payer, &id).is_ok() {
                        c.env.ledger().with_mut(|l| l.timestamp += DISPUTE_TIMEOUT_SECS + 1);
                        let _ = client.try_resolve_expired_dispute(&id);
                    }
                }
                6 if !ids.is_empty() => {
                    let _ = client.try_accrue_yield(&pick(&mut rng, &ids));
                }
                7 if !ids.is_empty() => {
                    if rng.below(2) == 0 {
                        c.mint_to_contract(1 + rng.below(1_000) as i128);
                    }
                    let _ = client.try_withdraw_yield(&c.admin, &pick(&mut rng, &ids));
                }
                _ => {}
            }

            let liabilities = client.get_total_liabilities(&c.token);
            assert!(
                c.balance(&c.cid) >= liabilities,
                "seed {seed}: balance below liabilities"
            );
            assert_eq!(liabilities, owed(&c, &ids), "seed {seed}: liabilities drift");
        }

        // Every open escrow can still be paid out in full.
        for id in ids.iter() {
            let e = client.get_escrow(id);
            if e.status == EscrowStatus::Active {
                client.release_funds(&c.payer, id);
            } else if e.status == EscrowStatus::Disputed {
                c.env.ledger().with_mut(|l| l.timestamp += DISPUTE_TIMEOUT_SECS + 1);
                client.resolve_expired_dispute(id);
            }
        }
        assert_eq!(client.get_total_liabilities(&c.token), 0);
    }
}

// ── #1707: path-independent accrual ───────────────────────────────────────────

#[test]
fn accrue_with_carry_split_equals_single_call() {
    let mut rng = Rng(0xDEAD_BEEF);
    for _ in 0..500 {
        let principal = 1 + rng.below(1_000_000_000) as i128;
        let rate = rng.below(10_001) as u32;
        let steps = 1 + rng.below(200);
        let mut carry = 0i128;
        let mut total = 0i128;
        let mut elapsed_total = 0u64;
        for _ in 0..steps {
            let dt = 1 + rng.below(3_600);
            elapsed_total += dt;
            let (y, r) = accrue_with_carry(principal, rate, dt, carry).unwrap();
            total += y;
            carry = r;
        }
        let (single, _) = accrue_with_carry(principal, rate, elapsed_total, 0).unwrap();
        assert_eq!(total, single);
    }
}

#[test]
fn accrue_with_carry_reports_overflow() {
    assert!(accrue_with_carry(i128::MAX, 10_000, 10, 0).is_none());
}

#[test]
fn griefing_frequent_accrual_matches_single_accrual() {
    let c = Ctx::new(30_000_000);
    let client = c.client();
    client.configure_yield(&c.admin, &300, &500, &9000);

    // Same principal and start time; old code truncated every 5 s step to 0.
    let griefed = c.deposit(10_000_000);
    let control = c.deposit(10_000_000);
    let (y, _) = accrue_with_carry(client.get_escrow(&griefed).amount, 300, 5, 0).unwrap();
    assert_eq!(y, 0, "a single 5 s step must truncate to 0 for this test to bite");

    let start = 1_000u64;
    for i in 1..=10_000u64 {
        c.env.ledger().set_timestamp(start + i * 5);
        client.accrue_yield(&griefed);
    }
    client.accrue_yield(&control);

    let accrued = client.get_accrued_yield(&griefed);
    assert!(accrued > 0);
    assert_eq!(accrued, client.get_accrued_yield(&control));
}

#[test]
fn accrual_respects_cap_and_drops_carry() {
    let c = Ctx::new(20_000);
    let client = c.client();
    client.configure_yield(&c.admin, &10_000, &100, &9000); // cap = 1 %
    let id = c.deposit(10_000);
    let principal = client.get_escrow(&id).amount;
    c.env.ledger().set_timestamp(1_000 + YEAR);
    client.accrue_yield(&id);
    assert_eq!(client.get_accrued_yield(&id), principal / 100);
    c.env.ledger().set_timestamp(1_000 + 2 * YEAR);
    client.accrue_yield(&id);
    assert_eq!(client.get_accrued_yield(&id), principal / 100);
}
