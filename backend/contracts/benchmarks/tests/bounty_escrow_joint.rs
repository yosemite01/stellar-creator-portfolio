//! #1714: cross-contract integration tests for the bounty × escrow joint
//! state machine.
//!
//! The model-based test drives a funded bounty through pseudo-random
//! sequences of every bounty and escrow entrypoint (including the ones that
//! should be refused) and checks after every step that:
//!
//! * `check_joint_state` holds (see `joint_state_valid` in the bounty crate);
//! * the escrow contract's token balance matches the escrow status: it holds
//!   the net amount while Active and nothing once Released / Refunded.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String, Vec,
};

use stellar_bounty_contract::{BountyContract, BountyContractClient, BountyStatus};
use stellar_escrow_contract::{EscrowContract, EscrowContractClient, EscrowStatus, ReleaseCondition};

const BUDGET: i128 = 900; // below the default multi-sig threshold
const DEADLINE: u64 = 100;

struct World<'a> {
    env: Env,
    bounty: BountyContractClient<'a>,
    escrow: EscrowContractClient<'a>,
    escrow_addr: Address,
    token: Address,
    creator: Address,
    freelancer: Address,
}

fn world<'a>() -> World<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let creator = Address::generate(&env);
    let freelancer = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&creator, &10_000);

    let escrow_addr = env.register(EscrowContract, ());
    let bounty_addr = env.register(BountyContract, ());
    let escrow = EscrowContractClient::new(&env, &escrow_addr);
    let bounty = BountyContractClient::new(&env, &bounty_addr);

    escrow.set_admin(&admin);
    escrow.allow_token(&admin, &token);
    escrow.set_bounty_contract(&admin, &bounty_addr);
    bounty.set_admin(&admin);
    bounty.set_escrow_contract(&admin, &escrow_addr);

    World { env, bounty, escrow, escrow_addr, token, creator, freelancer }
}

fn funded_bounty(w: &World) -> u64 {
    w.bounty.create_and_fund_bounty(
        &w.creator,
        &String::from_str(&w.env, "Joint state"),
        &String::from_str(&w.env, "Model-based test"),
        &BUDGET,
        &w.token,
        &DEADLINE,
    )
}

fn assert_consistent(w: &World, bounty_id: u64, step: &str) {
    assert!(w.bounty.check_joint_state(&bounty_id), "joint state violated after {step}");

    let b = w.bounty.get_bounty(&bounty_id);
    let e = w.escrow.get_escrow(&b.escrow_id);
    let held = TokenClient::new(&w.env, &w.token).balance(&w.escrow_addr);
    match e.status {
        EscrowStatus::Active => assert_eq!(held, e.amount, "funds missing after {step}"),
        EscrowStatus::Released | EscrowStatus::Refunded => assert_eq!(held, 0, "funds stuck after {step}"),
        _ => {}
    }
}

#[derive(Clone, Copy, Debug)]
enum Op {
    Select,
    Submit,
    Complete,
    Cancel,
    Expire,
    DirectRelease,
    DirectRefund,
    DirectDispute,
    Relink,
}

const OPS: [Op; 9] = [
    Op::Select,
    Op::Submit,
    Op::Complete,
    Op::Cancel,
    Op::Expire,
    Op::DirectRelease,
    Op::DirectRefund,
    Op::DirectDispute,
    Op::Relink,
];

fn apply(w: &World, bounty_id: u64, op: Op) {
    let escrow_id = w.bounty.get_bounty(&bounty_id).escrow_id;
    // Results are ignored on purpose: the model only cares that whatever
    // succeeded left both contracts in a valid joint state.
    match op {
        Op::Select => {
            let app = w.bounty.apply_for_bounty(
                &bounty_id,
                &w.freelancer,
                &String::from_str(&w.env, "proposal"),
                &BUDGET,
                &7,
            );
            let _ = w.bounty.try_select_freelancer(&bounty_id, &app);
        }
        Op::Submit => {
            let _ = w.bounty.try_submit_completion(&bounty_id, &w.freelancer);
        }
        Op::Complete => {
            let _ = w.bounty.try_complete_bounty(&bounty_id, &Vec::new(&w.env));
        }
        Op::Cancel => {
            let _ = w.bounty.try_cancel_bounty(&bounty_id);
        }
        Op::Expire => {
            w.env.ledger().set_timestamp(DEADLINE + 1);
            let _ = w.bounty.try_check_and_expire_bounty(&bounty_id, &w.escrow_addr);
        }
        Op::DirectRelease => {
            assert!(w.escrow.try_release_funds(&w.creator, &escrow_id).is_err());
        }
        Op::DirectRefund => {
            assert!(w.escrow.try_refund_escrow(&w.creator, &escrow_id).is_err());
        }
        Op::DirectDispute => {
            assert!(w.escrow.try_dispute_escrow(&w.creator, &escrow_id).is_err());
        }
        Op::Relink => {
            assert!(w.bounty.try_link_escrow(&bounty_id, &escrow_id).is_err());
        }
    }
}

#[test]
fn every_transition_sequence_keeps_joint_state_valid() {
    // Small deterministic LCG so failures are reproducible.
    let mut seed: u64 = 0x1714;
    let mut next = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) as usize
    };

    for _ in 0..48 {
        let w = world();
        let bounty_id = funded_bounty(&w);
        assert_consistent(&w, bounty_id, "create_and_fund_bounty");

        let mut trace = std::vec::Vec::new();
        for _ in 0..6 {
            let op = OPS[next() % OPS.len()];
            trace.push(op);
            apply(&w, bounty_id, op);
            assert_consistent(&w, bounty_id, &format!("{trace:?}"));
        }
    }
}

#[test]
fn complete_releases_escrow_to_freelancer_atomically() {
    let w = world();
    let id = funded_bounty(&w);
    apply(&w, id, Op::Select);
    apply(&w, id, Op::Submit);
    w.bounty.complete_bounty(&id, &Vec::new(&w.env));

    let b = w.bounty.get_bounty(&id);
    assert_eq!(b.status, BountyStatus::Completed);
    let e = w.escrow.get_escrow(&b.escrow_id);
    assert_eq!(e.status, EscrowStatus::Released);
    assert_eq!(e.payee, w.freelancer);
    assert_eq!(TokenClient::new(&w.env, &w.token).balance(&w.freelancer), e.amount);
}

#[test]
fn cancel_refunds_escrow_atomically() {
    let w = world();
    let id = funded_bounty(&w);
    let before = TokenClient::new(&w.env, &w.token).balance(&w.creator);
    w.bounty.cancel_bounty(&id);

    let b = w.bounty.get_bounty(&id);
    assert_eq!(b.status, BountyStatus::Cancelled);
    let e = w.escrow.get_escrow(&b.escrow_id);
    assert_eq!(e.status, EscrowStatus::Refunded);
    assert_eq!(TokenClient::new(&w.env, &w.token).balance(&w.creator), before + e.amount);
}

#[test]
fn expire_refunds_escrow_and_rejects_dummy_escrow_contract() {
    let w = world();
    let id = funded_bounty(&w);
    w.env.ledger().set_timestamp(DEADLINE + 1);

    // Regression: a dummy escrow contract used to cancel the bounty while the
    // real escrow stayed Active.
    let dummy = Address::generate(&w.env);
    assert!(w.bounty.try_check_and_expire_bounty(&id, &dummy).is_err());
    assert_eq!(w.bounty.get_bounty(&id).status, BountyStatus::Open);

    w.bounty.check_and_expire_bounty(&id, &w.escrow_addr);
    let b = w.bounty.get_bounty(&id);
    assert_eq!(b.status, BountyStatus::Cancelled);
    assert_eq!(w.escrow.get_escrow(&b.escrow_id).status, EscrowStatus::Refunded);
}

#[test]
fn link_escrow_binds_a_direct_deposit() {
    let w = world();
    let id = w.bounty.create_bounty(
        &w.creator,
        &String::from_str(&w.env, "Linked"),
        &String::from_str(&w.env, "Direct deposit"),
        &BUDGET,
        &DEADLINE,
    );
    let escrow_id =
        w.escrow.deposit(&id, &w.creator, &w.creator, &BUDGET, &w.token, &ReleaseCondition::OnCompletion);
    w.bounty.link_escrow(&id, &escrow_id);
    assert_consistent(&w, id, "link_escrow");

    // Once linked, the escrow can no longer be moved directly ...
    assert!(w.escrow.try_refund_escrow(&w.creator, &escrow_id).is_err());
    // ... and the bounty can't be re-linked to another escrow.
    let other =
        w.escrow.deposit(&id, &w.creator, &w.creator, &BUDGET, &w.token, &ReleaseCondition::OnCompletion);
    assert!(w.bounty.try_link_escrow(&id, &other).is_err());

    w.bounty.cancel_bounty(&id);
    assert_consistent(&w, id, "cancel_bounty");
}

#[test]
fn link_escrow_rejects_escrow_for_another_bounty() {
    let w = world();
    let id = w.bounty.create_bounty(
        &w.creator,
        &String::from_str(&w.env, "A"),
        &String::from_str(&w.env, "B"),
        &BUDGET,
        &DEADLINE,
    );
    let foreign =
        w.escrow.deposit(&(id + 99), &w.creator, &w.creator, &BUDGET, &w.token, &ReleaseCondition::OnCompletion);
    assert!(w.bounty.try_link_escrow(&id, &foreign).is_err());
    assert_eq!(w.bounty.get_bounty(&id).escrow_id, 0);
}

#[test]
fn create_and_fund_rejects_non_allowlisted_token() {
    let w = world();
    let rogue = w.env.register_stellar_asset_contract_v2(Address::generate(&w.env)).address();
    StellarAssetClient::new(&w.env, &rogue).mint(&w.creator, &10_000);
    let res = w.bounty.try_create_and_fund_bounty(
        &w.creator,
        &String::from_str(&w.env, "Rogue"),
        &String::from_str(&w.env, "Token"),
        &BUDGET,
        &rogue,
        &DEADLINE,
    );
    assert!(res.is_err());
    assert_eq!(w.bounty.get_bounties_count(), 0);
}
