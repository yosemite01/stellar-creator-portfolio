//! Model-based invariant fuzzing of the joint escrow + insurance system (#1723).
//!
//! A reference Rust model tracks what every escrow and the insurance pool
//! *should* hold. Random operation sequences — including calls from
//! unauthorised actors — are applied to both the real contracts and the model;
//! after every step the harness asserts:
//!
//! * **Authorization** — each call succeeds iff the model says it may.
//! * **Solvency** — the escrow contract holds exactly the unpaid balance of
//!   every open (active/disputed) escrow; the insurance contract holds exactly
//!   its recorded pool.
//! * **Conservation** — tokens are never created or destroyed.
//! * **No stuck funds** — once every escrow is closed, the escrow contract's
//!   balance is zero.
//!
//! Seeds: see `stellar_contract_test_utils::fuzz` (`FUZZ_ITERATIONS`, `FUZZ_SEED`).

extern crate std;

use std::vec::Vec;

use crate::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Env, String};
use stellar_contract_test_utils::fuzz::{assert_detects, run_seeds, Rng};
use stellar_insurance_contract::{InsuranceContract, InsuranceContractClient};

const REGRESSION_SEEDS: &[u64] = &[0, 7, 1709, 1712, 1723];
const STEPS: usize = 40;

#[derive(Clone, Copy, PartialEq, Debug)]
enum St {
    Active,
    Disputed,
    Closed,
}

struct ModelEscrow {
    id: u64,
    payer: usize,
    payee: usize,
    amount: i128,
    released: i128,
    status: St,
    /// Milestone amounts and whether each was released.
    plan: Vec<(i128, bool)>,
}

struct World {
    env: Env,
    escrow: EscrowContractClient<'static>,
    escrow_id: Address,
    insurance: InsuranceContractClient<'static>,
    insurance_id: Address,
    token: Address,
    admin: Address,
    users: Vec<Address>,
    stranger: Address,
    minted: i128,
    escrows: Vec<ModelEscrow>,
    pool: i128,
    admin_fees: i128,
}

impl World {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_000);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let admin = Address::generate(&env);
        let escrow_id = env.register(EscrowContract, (admin.clone(),));
        let escrow = EscrowContractClient::new(&env, &escrow_id);
        escrow.allow_token(&admin, &token);
        let insurance_id = env.register(InsuranceContract, ());
        let insurance = InsuranceContractClient::new(&env, &insurance_id);
        insurance.initialize(&admin);
        let users = (0..3).map(|_| Address::generate(&env)).collect();
        let stranger = Address::generate(&env);
        World {
            env, escrow, escrow_id, insurance, insurance_id, token, admin, users, stranger,
            minted: 0, escrows: Vec::new(), pool: 0, admin_fees: 0,
        }
    }

    fn token(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.token)
    }

    /// Picks the payer, payee, or a stranger. Returns (address, role).
    fn actor(&self, rng: &mut Rng, e: usize) -> (Address, u8) {
        let m = &self.escrows[e];
        match rng.range(0, 2) {
            0 => (self.users[m.payer].clone(), 0),
            1 => (self.users[m.payee].clone(), 1),
            _ => (self.stranger.clone(), 2),
        }
    }

    fn step(&mut self, rng: &mut Rng) {
        let op = if self.escrows.is_empty() { 0 } else { rng.range(0, 8) };
        match op {
            0 => {
                let payer = rng.index(3);
                let payee = (payer + 1 + rng.index(2)) % 3;
                let amount = rng.amount(1, 5_000);
                StellarAssetClient::new(&self.env, &self.token).mint(&self.users[payer], &amount);
                self.minted += amount;
                let id = self.escrow.deposit(
                    &(self.escrows.len() as u64 + 1),
                    &self.users[payer],
                    &self.users[payee],
                    &amount,
                    &self.token,
                    &ReleaseCondition::OnCompletion,
                );
                let fee = platform_fee(amount);
                self.admin_fees += fee;
                self.escrows.push(ModelEscrow {
                    id, payer, payee, amount: amount - fee, released: 0, status: St::Active, plan: Vec::new(),
                });
            }
            1 => {
                // release_funds: payer or payee, active only.
                let e = rng.index(self.escrows.len());
                let (who, role) = self.actor(rng, e);
                let ok = role != 2 && self.escrows[e].status == St::Active;
                let r = self.escrow.try_release_funds(&who, &self.escrows[e].id);
                assert_eq!(r.is_ok(), ok, "release_funds role={role}");
                if ok {
                    let m = &mut self.escrows[e];
                    m.released = m.amount;
                    m.status = St::Closed;
                }
            }
            2 => {
                // refund_escrow: payer only.
                let e = rng.index(self.escrows.len());
                let (who, role) = self.actor(rng, e);
                let ok = role == 0 && self.escrows[e].status == St::Active;
                let r = self.escrow.try_refund_escrow(&who, &self.escrows[e].id);
                assert_eq!(r.is_ok(), ok, "refund role={role}");
                if ok {
                    let m = &mut self.escrows[e];
                    m.released = m.amount;
                    m.status = St::Closed;
                }
            }
            3 => {
                let e = rng.index(self.escrows.len());
                let (who, role) = self.actor(rng, e);
                let ok = role != 2 && self.escrows[e].status == St::Active;
                let r = self.escrow.try_dispute_escrow(&who, &self.escrows[e].id);
                assert_eq!(r.is_ok(), ok, "dispute role={role}");
                if ok {
                    self.escrows[e].status = St::Disputed;
                }
            }
            4 => {
                // No admin-settled disputes since #1713: a dispute without an
                // arbiter panel is settled 50/50 by anyone once it expires.
                let e = rng.index(self.escrows.len());
                let t = self.env.ledger().timestamp();
                self.env.ledger().set_timestamp(t + DISPUTE_TIMEOUT_SECS + 1);
                let ok = self.escrows[e].status == St::Disputed;
                let r = self.escrow.try_resolve_expired_dispute(&self.escrows[e].id);
                assert_eq!(r.is_ok(), ok, "resolve_expired_dispute");
                if ok {
                    let m = &mut self.escrows[e];
                    m.released = m.amount;
                    m.status = St::Closed;
                }
            }
            5 => {
                // Define a complete milestone plan.
                let e = rng.index(self.escrows.len());
                let m = &self.escrows[e];
                if m.status != St::Active || !m.plan.is_empty() || m.amount < 1 {
                    return;
                }
                let parts = rng.range(1, 5.min(m.amount as u64)) as usize;
                let split = rng.split(m.amount, parts);
                for (i, amt) in split.iter().enumerate() {
                    self.escrow.add_milestone(&self.users[m.payer], &m.id, &(i as u32), &Symbol::new(&self.env, "m"), amt);
                }
                self.escrows[e].plan = split.into_iter().map(|a| (a, false)).collect();
            }
            6 => {
                let e = rng.index(self.escrows.len());
                if self.escrows[e].plan.is_empty() {
                    return;
                }
                let i = rng.index(self.escrows[e].plan.len());
                let (who, role) = self.actor(rng, e);
                let m = &self.escrows[e];
                let ok = role == 0 && m.status == St::Active && !m.plan[i].1;
                let r = self.escrow.try_release_milestone(&who, &m.id, &(i as u32));
                assert_eq!(r.is_ok(), ok, "release_milestone role={role}");
                if ok {
                    let m = &mut self.escrows[e];
                    m.plan[i].1 = true;
                    m.released += m.plan[i].0;
                    if m.plan.iter().all(|(_, r)| *r) {
                        m.status = St::Closed;
                    }
                }
            }
            7 => {
                // Admin forwards part of its fee income to the insurance pool.
                if self.admin_fees == 0 {
                    return;
                }
                let amt = rng.amount(1, self.admin_fees);
                self.insurance.contribute_to_pool(&self.admin, &amt, &self.token);
                self.admin_fees -= amt;
                self.pool += amt;
            }
            _ => {
                // Claims now need a policy on a disputed escrow (#1711); a claim
                // against a policy that does not exist must never be accepted,
                // and the pool must be untouched.
                let claimant = self.users[rng.index(3)].clone();
                let amt = rng.amount(1, 200);
                let r = self.insurance.try_submit_claim(&claimant, &u64::MAX, &amt, &String::from_str(&self.env, "ev"));
                assert!(r.is_err(), "claim without a policy was accepted");
            }
        }
    }

    fn check(&self) {
        let t = self.token();
        let owed: i128 = self
            .escrows
            .iter()
            .filter(|m| m.status != St::Closed)
            .map(|m| m.amount - m.released)
            .sum();
        assert_eq!(t.balance(&self.escrow_id), owed, "escrow solvency");
        assert_eq!(t.balance(&self.insurance_id), self.pool, "insurance solvency");
        assert_eq!(self.insurance.get_pool_balance(&self.token), self.pool, "pool accounting");
        assert_eq!(t.balance(&self.admin), self.admin_fees, "fee accounting");

        let mut total = t.balance(&self.escrow_id) + t.balance(&self.insurance_id) + t.balance(&self.admin);
        for u in &self.users {
            total += t.balance(u);
        }
        total += t.balance(&self.stranger);
        assert_eq!(total, self.minted, "conservation");

        for m in &self.escrows {
            let s = self.escrow.get_escrow(&m.id).status;
            let open = s == EscrowStatus::Active || s == EscrowStatus::Disputed;
            assert_eq!(open, m.status != St::Closed, "status of escrow {}", m.id);
        }
    }

    /// Close every open escrow; nothing may remain in the escrow contract.
    fn drain(&mut self) {
        for e in 0..self.escrows.len() {
            let (id, payer) = (self.escrows[e].id, self.users[self.escrows[e].payer].clone());
            match self.escrows[e].status {
                St::Active => { self.escrow.release_funds(&payer, &id); }
                St::Disputed => {
                    let t = self.env.ledger().timestamp();
                    self.env.ledger().set_timestamp(t + DISPUTE_TIMEOUT_SECS + 1);
                    self.escrow.resolve_expired_dispute(&id);
                }
                St::Closed => continue,
            }
            let m = &mut self.escrows[e];
            m.released = m.amount;
            m.status = St::Closed;
        }
        self.check();
        assert_eq!(self.token().balance(&self.escrow_id), 0, "no stuck funds");
    }
}

#[test]
fn joint_escrow_insurance_invariants() {
    run_seeds("escrow+insurance::joint", REGRESSION_SEEDS, |seed| {
        let mut rng = Rng::new(seed);
        let mut w = World::new();
        for _ in 0..STEPS {
            w.step(&mut rng);
            w.check();
        }
        w.drain();
    });
}

// ── The harness catches injected bugs ───────────────────────────────────────

fn populated() -> World {
    let mut rng = Rng::new(99);
    let mut w = World::new();
    for _ in 0..10 {
        w.step(&mut rng);
    }
    w.check();
    w
}

#[test]
fn harness_detects_escrow_overpayment_bug() {
    // Injected bug: the contract "pays" an escrow without recording it — the
    // shape of the release-after-milestones double payout fixed in #1712.
    let w = populated();
    let id = w.escrows.iter().find(|m| m.status != St::Closed).map(|m| m.id);
    if let Some(id) = id {
        let _ = id;
        TokenClient::new(&w.env, &w.token).transfer(&w.escrow_id, &w.stranger, &1);
    } else {
        StellarAssetClient::new(&w.env, &w.token).mint(&w.escrow_id, &1);
    }
    assert_detects("escrow paid out more than recorded", || w.check());
}

#[test]
fn harness_detects_escrow_status_tampering() {
    let w = populated();
    let id = w.escrows[0].id;
    w.env.as_contract(&w.escrow_id, || {
        let mut e = load_escrow(&w.env, id).unwrap();
        let open = e.status == EscrowStatus::Active || e.status == EscrowStatus::Disputed;
        e.status = if open { EscrowStatus::Released } else { EscrowStatus::Active };
        w.env.storage().persistent().set(&escrow_key(&w.env, id), &e);
    });
    assert_detects("escrow status diverged from model", || w.check());
}

#[test]
fn harness_detects_insurance_pool_inflation() {
    let w = populated();
    w.env.as_contract(&w.insurance_id, || {
        w.env.storage().persistent().set(
            &stellar_insurance_contract::DataKey::PoolBalance(w.token.clone()),
            &(w.pool + 1),
        );
    });
    assert_detects("insurance pool accounting inflated", || w.check());
}
