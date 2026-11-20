//! Per-dispute arbitration (#1713).
//!
//! Replaces the admin-only `resolve_dispute` and the global
//! `set_dispute_split` with:
//!
//! 1. **Arbiter registry**: anyone can stake the arbitration token to join the
//!    pool. Each arbiter has a reputation score; selection weight is
//!    `stake * reputation`.
//! 2. **Random panel per dispute**: `PANEL_SIZE` arbiters drawn without
//!    replacement (weighted) with the host PRNG, excluding both parties.
//! 3. **Evidence hashes**: parties anchor the sha256 of each off-chain upload
//!    (`app/api/disputes/[id]/evidence`) on-chain.
//! 4. **Commit-reveal voting**: each panel member commits
//!    `sha256(payee_bps_be || salt)`, then reveals. The ruling is the median
//!    revealed `payee_bps` (for an even count, the mean of the two middle
//!    votes, which also settles ties).
//! 5. **Appeal**: within `APPEAL_SECS` either party can appeal a round-0
//!    ruling to a fresh `APPEAL_PANEL_SIZE` panel. The appeal ruling is final.
//!
//! No-shows (panel members who don't reveal) lose `NO_SHOW_REP_PENALTY`
//! reputation and `SLASH_BPS` of their stake, which is shared among the
//! members who did reveal. Revealers within `ALIGN_BAND_BPS` of the ruling
//! gain reputation; outliers lose some. A round with zero reveals is redrawn
//! up to `MAX_EMPTY_ROUNDS` times, after which the ruling falls back to
//! `DEFAULT_PAYEE_BPS` and is final.

use soroban_sdk::{contracttype, symbol_short, token::Client as TokenClient, Address, Bytes, BytesN, Env, Vec};
use stellar_contract_ttl::{self as ttl, TtlPolicy};

use crate::{ensure, DataKey, EscrowAccount, EscrowError};

pub const PANEL_SIZE: u32 = 3;
pub const APPEAL_PANEL_SIZE: u32 = 5;
pub const COMMIT_SECS: u64 = 3 * 24 * 3600;
pub const REVEAL_SECS: u64 = 2 * 24 * 3600;
pub const APPEAL_SECS: u64 = 3 * 24 * 3600;
pub const MAX_EMPTY_ROUNDS: u32 = 2;
pub const MAX_ARBITERS: u32 = 100;
pub const MAX_EVIDENCE: u32 = 20;
pub const DEFAULT_PAYEE_BPS: u32 = 5_000;
pub const INITIAL_REPUTATION: u32 = 100;
pub const MAX_REPUTATION: u32 = 1_000;
pub const MIN_REPUTATION: u32 = 1;
pub const REP_GAIN: u32 = 5;
pub const REP_LOSS: u32 = 5;
pub const NO_SHOW_REP_PENALTY: u32 = 20;
pub const SLASH_BPS: i128 = 1_000; // 10 % of stake per no-show
pub const ALIGN_BAND_BPS: u32 = 1_500;

#[contracttype]
#[derive(Clone, Debug)]
pub struct ArbitrationConfig {
    pub stake_token: Address,
    pub min_stake: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Arbiter {
    pub address: Address,
    pub stake: i128,
    pub reputation: u32,
    pub active_cases: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CasePhase {
    /// Panel drawn; commits then reveals are open.
    Voting = 0,
    /// Round-0 ruling recorded; may be appealed until `appeal_deadline`.
    Appealable = 1,
    /// Ruling is final and has been paid out.
    Final = 2,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeCase {
    pub escrow_id: u64,
    /// 0 = first panel, 1 = appeal panel.
    pub round: u32,
    pub phase: CasePhase,
    pub panel: Vec<Address>,
    /// Members of earlier panels, excluded from later draws.
    pub past_panels: Vec<Address>,
    pub commit_deadline: u64,
    pub reveal_deadline: u64,
    pub revealed: Vec<Address>,
    pub votes: Vec<u32>,
    pub ruling_bps: Option<u32>,
    pub appeal_deadline: u64,
    pub empty_rounds: u32,
    pub appellant: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Evidence {
    pub submitter: Address,
    pub hash: BytesN<32>,
    pub submitted_at: u64,
}

/// `sha256(payee_bps as u32 big-endian || salt)`. Compute it client-side:
/// sending the vote and salt to an RPC node for simulation would reveal it.
pub fn vote_commitment(env: &Env, payee_bps: u32, salt: &BytesN<32>) -> BytesN<32> {
    let mut buf = Bytes::from_array(env, &payee_bps.to_be_bytes());
    buf.append(&Bytes::from_array(env, &salt.to_array()));
    env.crypto().sha256(&buf).to_bytes()
}

// ── storage helpers ──────────────────────────────────────────────────────────

pub fn load_config(env: &Env) -> Result<ArbitrationConfig, EscrowError> {
    env.storage()
        .persistent()
        .get::<DataKey, ArbitrationConfig>(&DataKey::ArbConfig)
        .ok_or(EscrowError::ArbitrationNotConfigured)
}

pub fn configure(env: &Env, stake_token: Address, min_stake: i128) -> Result<(), EscrowError> {
    ensure(!env.storage().persistent().has(&DataKey::ArbConfig), EscrowError::ArbitrationAlreadyConfigured)?;
    ensure(min_stake > 0, EscrowError::InvalidAmount)?;
    let cfg = ArbitrationConfig { stake_token, min_stake };
    env.storage().persistent().set(&DataKey::ArbConfig, &cfg);
    ttl::extend(env, &DataKey::ArbConfig, TtlPolicy::Config);
    env.events().publish((symbol_short!("arb"), symbol_short!("config")), (cfg.stake_token, min_stake));
    Ok(())
}

pub fn load_arbiter(env: &Env, addr: &Address) -> Result<Arbiter, EscrowError> {
    env.storage()
        .persistent()
        .get::<DataKey, Arbiter>(&DataKey::Arbiter(addr.clone()))
        .ok_or(EscrowError::ArbiterNotFound)
}

fn save_arbiter(env: &Env, arbiter: &Arbiter) {
    let key = DataKey::Arbiter(arbiter.address.clone());
    env.storage().persistent().set(&key, arbiter);
    ttl::extend(env, &key, TtlPolicy::UserEntry);
}

fn load_pool(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get::<DataKey, Vec<Address>>(&DataKey::ArbiterPool)
        .unwrap_or_else(|| Vec::new(env))
}

fn save_pool(env: &Env, pool: &Vec<Address>) {
    env.storage().persistent().set(&DataKey::ArbiterPool, pool);
    ttl::extend(env, &DataKey::ArbiterPool, TtlPolicy::Config);
}

pub fn has_case(env: &Env, escrow_id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Case(escrow_id))
}

pub fn load_case(env: &Env, escrow_id: u64) -> Result<DisputeCase, EscrowError> {
    env.storage()
        .persistent()
        .get::<DataKey, DisputeCase>(&DataKey::Case(escrow_id))
        .ok_or(EscrowError::CaseNotFound)
}

fn save_case(env: &Env, case: &DisputeCase) {
    let key = DataKey::Case(case.escrow_id);
    env.storage().persistent().set(&key, case);
    ttl::extend(env, &key, TtlPolicy::UserEntry);
}

pub fn load_evidence(env: &Env, escrow_id: u64) -> Vec<Evidence> {
    env.storage()
        .persistent()
        .get::<DataKey, Vec<Evidence>>(&DataKey::Evidence(escrow_id))
        .unwrap_or_else(|| Vec::new(env))
}

// ── registry ─────────────────────────────────────────────────────────────────

pub fn register(env: &Env, addr: Address, amount: i128) -> Result<Arbiter, EscrowError> {
    let cfg = load_config(env)?;
    ensure(amount > 0, EscrowError::InvalidAmount)?;
    let existing = load_arbiter(env, &addr).ok();
    let mut pool = load_pool(env);
    if existing.is_none() {
        ensure(amount >= cfg.min_stake, EscrowError::InsufficientStake)?;
        ensure(pool.len() < MAX_ARBITERS, EscrowError::ArbiterPoolFull)?;
    }

    TokenClient::new(env, &cfg.stake_token).transfer(&addr, env.current_contract_address(), &amount);

    let arbiter = match existing {
        Some(mut a) => {
            a.stake += amount;
            a
        }
        None => {
            pool.push_back(addr.clone());
            save_pool(env, &pool);
            Arbiter { address: addr.clone(), stake: amount, reputation: INITIAL_REPUTATION, active_cases: 0 }
        }
    };
    save_arbiter(env, &arbiter);
    env.events().publish((symbol_short!("arb"), symbol_short!("staked")), (addr, amount, arbiter.stake));
    Ok(arbiter)
}

pub fn withdraw(env: &Env, addr: Address, amount: i128) -> Result<i128, EscrowError> {
    let cfg = load_config(env)?;
    let mut arbiter = load_arbiter(env, &addr)?;
    ensure(arbiter.active_cases == 0, EscrowError::ArbiterBusy)?;
    ensure(amount > 0 && amount <= arbiter.stake, EscrowError::InvalidAmount)?;

    arbiter.stake -= amount;
    if arbiter.stake == 0 {
        env.storage().persistent().remove(&DataKey::Arbiter(addr.clone()));
        let mut pool = load_pool(env);
        if let Some(i) = pool.first_index_of(&addr) {
            pool.remove(i);
        }
        save_pool(env, &pool);
    } else {
        save_arbiter(env, &arbiter);
    }

    TokenClient::new(env, &cfg.stake_token).transfer(&env.current_contract_address(), &addr, &amount);
    env.events().publish((symbol_short!("arb"), symbol_short!("unstaked")), (addr, amount, arbiter.stake));
    Ok(arbiter.stake)
}

// ── panel selection ──────────────────────────────────────────────────────────

fn weight(a: &Arbiter) -> u64 {
    let stake = u64::try_from(a.stake).unwrap_or(u64::MAX);
    stake.saturating_mul(a.reputation as u64)
}

/// Weighted draw without replacement. Fails (writing nothing) when fewer than
/// `size` eligible arbiters exist.
fn draw_panel(env: &Env, size: u32, exclude: &Vec<Address>) -> Result<Vec<Address>, EscrowError> {
    let cfg = load_config(env)?;
    let mut candidates: Vec<Arbiter> = Vec::new(env);
    for addr in load_pool(env).iter() {
        if exclude.contains(&addr) {
            continue;
        }
        if let Ok(a) = load_arbiter(env, &addr) {
            if a.stake >= cfg.min_stake && weight(&a) > 0 {
                candidates.push_back(a);
            }
        }
    }
    ensure(candidates.len() >= size, EscrowError::NotEnoughArbiters)?;

    let mut panel = Vec::new(env);
    for _ in 0..size {
        let total = candidates.iter().fold(0u64, |acc, a| acc.saturating_add(weight(&a)));
        let mut pick: u64 = env.prng().gen_range(0..total);
        let mut chosen = candidates.len() - 1;
        for (i, a) in candidates.iter().enumerate() {
            let w = weight(&a);
            if pick < w {
                chosen = i as u32;
                break;
            }
            pick -= w;
        }
        if let Some(a) = candidates.get(chosen) {
            panel.push_back(a.address.clone());
        }
        candidates.remove(chosen);
    }
    Ok(panel)
}

fn set_busy(env: &Env, panel: &Vec<Address>, busy: bool) {
    for addr in panel.iter() {
        if let Ok(mut a) = load_arbiter(env, &addr) {
            a.active_cases = if busy { a.active_cases + 1 } else { a.active_cases.saturating_sub(1) };
            save_arbiter(env, &a);
        }
    }
}

fn start_round(env: &Env, case: &mut DisputeCase, panel: Vec<Address>) {
    let now = env.ledger().timestamp();
    set_busy(env, &panel, true);
    case.panel = panel;
    case.phase = CasePhase::Voting;
    case.commit_deadline = now + COMMIT_SECS;
    case.reveal_deadline = now + COMMIT_SECS + REVEAL_SECS;
    case.revealed = Vec::new(env);
    case.votes = Vec::new(env);
    env.events().publish(
        (symbol_short!("arb"), symbol_short!("panel")),
        (case.escrow_id, case.round, case.panel.clone(), case.commit_deadline, case.reveal_deadline),
    );
}

fn parties(env: &Env, escrow: &EscrowAccount) -> Vec<Address> {
    let mut v = Vec::new(env);
    v.push_back(escrow.payer.clone());
    v.push_back(escrow.payee.clone());
    v
}

pub fn open_case(env: &Env, escrow: &EscrowAccount) -> Result<DisputeCase, EscrowError> {
    ensure(!has_case(env, escrow.id), EscrowError::CaseAlreadyOpen)?;
    let panel = draw_panel(env, PANEL_SIZE, &parties(env, escrow))?;
    let mut case = DisputeCase {
        escrow_id: escrow.id,
        round: 0,
        phase: CasePhase::Voting,
        panel: Vec::new(env),
        past_panels: Vec::new(env),
        commit_deadline: 0,
        reveal_deadline: 0,
        revealed: Vec::new(env),
        votes: Vec::new(env),
        ruling_bps: None,
        appeal_deadline: 0,
        empty_rounds: 0,
        appellant: None,
    };
    start_round(env, &mut case, panel);
    save_case(env, &case);
    Ok(case)
}

// ── evidence & voting ────────────────────────────────────────────────────────

pub fn submit_evidence(env: &Env, escrow_id: u64, party: Address, hash: BytesN<32>) -> Result<u32, EscrowError> {
    if let Ok(case) = load_case(env, escrow_id) {
        // Evidence must be in before arbiters lock in their votes.
        ensure(
            case.phase == CasePhase::Voting && env.ledger().timestamp() < case.commit_deadline,
            EscrowError::WrongPhase,
        )?;
    }
    let mut list = load_evidence(env, escrow_id);
    ensure(list.len() < MAX_EVIDENCE, EscrowError::TooMuchEvidence)?;
    list.push_back(Evidence { submitter: party.clone(), hash: hash.clone(), submitted_at: env.ledger().timestamp() });
    let key = DataKey::Evidence(escrow_id);
    env.storage().persistent().set(&key, &list);
    ttl::extend(env, &key, TtlPolicy::UserEntry);
    env.events().publish((symbol_short!("arb"), symbol_short!("evidence")), (escrow_id, party, hash));
    Ok(list.len())
}

pub fn commit(env: &Env, escrow_id: u64, arbiter: Address, commitment: BytesN<32>) -> Result<(), EscrowError> {
    let case = load_case(env, escrow_id)?;
    ensure(case.phase == CasePhase::Voting, EscrowError::WrongPhase)?;
    ensure(env.ledger().timestamp() < case.commit_deadline, EscrowError::WrongPhase)?;
    ensure(case.panel.contains(&arbiter), EscrowError::NotOnPanel)?;
    let key = DataKey::Commit(escrow_id, case.round, arbiter.clone());
    ensure(!env.storage().persistent().has(&key), EscrowError::AlreadyCommitted)?;
    env.storage().persistent().set(&key, &commitment);
    ttl::extend(env, &key, TtlPolicy::Ephemeral);
    env.events().publish((symbol_short!("arb"), symbol_short!("commit")), (escrow_id, case.round, arbiter));
    Ok(())
}

pub fn reveal(env: &Env, escrow_id: u64, arbiter: Address, payee_bps: u32, salt: BytesN<32>) -> Result<(), EscrowError> {
    let mut case = load_case(env, escrow_id)?;
    let now = env.ledger().timestamp();
    ensure(case.phase == CasePhase::Voting, EscrowError::WrongPhase)?;
    ensure(now >= case.commit_deadline && now < case.reveal_deadline, EscrowError::WrongPhase)?;
    ensure(case.panel.contains(&arbiter), EscrowError::NotOnPanel)?;
    ensure(!case.revealed.contains(&arbiter), EscrowError::AlreadyRevealed)?;
    ensure(payee_bps <= 10_000, EscrowError::InvalidBps)?;

    let key = DataKey::Commit(escrow_id, case.round, arbiter.clone());
    let stored: BytesN<32> = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(EscrowError::CommitmentNotFound)?;
    ensure(stored == vote_commitment(env, payee_bps, &salt), EscrowError::CommitmentMismatch)?;

    case.revealed.push_back(arbiter.clone());
    case.votes.push_back(payee_bps);
    save_case(env, &case);
    env.events().publish(
        (symbol_short!("arb"), symbol_short!("reveal")),
        (escrow_id, case.round, arbiter, payee_bps),
    );
    Ok(())
}

/// Median of the votes; mean of the two middle values for an even count.
pub fn median(env: &Env, votes: &Vec<u32>) -> u32 {
    let mut sorted: Vec<u32> = Vec::new(env);
    for v in votes.iter() {
        let mut i = 0;
        while i < sorted.len() && sorted.get(i).unwrap_or(0) <= v {
            i += 1;
        }
        sorted.insert(i, v);
    }
    let n = sorted.len();
    if n == 0 {
        return DEFAULT_PAYEE_BPS;
    }
    let hi = sorted.get(n / 2).unwrap_or(DEFAULT_PAYEE_BPS);
    if n % 2 == 1 {
        hi
    } else {
        let lo = sorted.get(n / 2 - 1).unwrap_or(DEFAULT_PAYEE_BPS);
        (lo + hi) / 2
    }
}

/// Reputation and stake updates for a closed round.
fn apply_incentives(env: &Env, case: &DisputeCase, ruling: Option<u32>) {
    let mut slashed: i128 = 0;
    for addr in case.panel.iter() {
        let Ok(mut a) = load_arbiter(env, &addr) else { continue };
        a.active_cases = a.active_cases.saturating_sub(1);
        match case.revealed.first_index_of(&addr) {
            None => {
                a.reputation = a.reputation.saturating_sub(NO_SHOW_REP_PENALTY).max(MIN_REPUTATION);
                let cut = a.stake * SLASH_BPS / 10_000;
                a.stake -= cut;
                slashed += cut;
                env.events().publish((symbol_short!("arb"), symbol_short!("noshow")), (case.escrow_id, addr.clone(), cut));
            }
            Some(i) => {
                if let (Some(r), Some(v)) = (ruling, case.votes.get(i)) {
                    if v.abs_diff(r) <= ALIGN_BAND_BPS {
                        a.reputation = (a.reputation + REP_GAIN).min(MAX_REPUTATION);
                    } else {
                        a.reputation = a.reputation.saturating_sub(REP_LOSS).max(MIN_REPUTATION);
                    }
                }
            }
        }
        save_arbiter(env, &a);
    }

    // Share no-show slashes among the members who revealed.
    let n = case.revealed.len() as i128;
    if slashed > 0 && n > 0 {
        let share = slashed / n;
        let mut remainder = slashed - share * n;
        for addr in case.revealed.iter() {
            if let Ok(mut a) = load_arbiter(env, &addr) {
                a.stake += share + remainder;
                remainder = 0;
                save_arbiter(env, &a);
            }
        }
    }
}

/// Close the current round. See module docs for the outcomes.
pub fn tally(env: &Env, escrow: &EscrowAccount) -> Result<DisputeCase, EscrowError> {
    let mut case = load_case(env, escrow.id)?;
    ensure(case.phase == CasePhase::Voting, EscrowError::WrongPhase)?;
    ensure(env.ledger().timestamp() >= case.reveal_deadline, EscrowError::WrongPhase)?;

    if case.votes.is_empty() {
        apply_incentives(env, &case, None);
        case.empty_rounds += 1;
        for a in case.panel.iter() {
            case.past_panels.push_back(a);
        }
        if case.empty_rounds < MAX_EMPTY_ROUNDS {
            let mut exclude = parties(env, escrow);
            for a in case.past_panels.iter() {
                exclude.push_back(a);
            }
            let size = if case.round == 0 { PANEL_SIZE } else { APPEAL_PANEL_SIZE };
            // Prefer fresh arbiters; fall back to anyone but the parties.
            let panel = match draw_panel(env, size, &exclude) {
                Ok(p) => Ok(p),
                Err(_) => draw_panel(env, size, &parties(env, escrow)),
            };
            if let Ok(panel) = panel {
                start_round(env, &mut case, panel);
                save_case(env, &case);
                return Ok(case);
            }
        }
        // Nobody showed up repeatedly: fixed default split, final.
        case.ruling_bps = Some(DEFAULT_PAYEE_BPS);
        case.phase = CasePhase::Final;
        save_case(env, &case);
        env.events().publish((symbol_short!("arb"), symbol_short!("ruling")), (escrow.id, case.round, DEFAULT_PAYEE_BPS, true));
        return Ok(case);
    }

    let ruling = median(env, &case.votes);
    apply_incentives(env, &case, Some(ruling));
    case.ruling_bps = Some(ruling);
    if case.round == 0 {
        case.phase = CasePhase::Appealable;
        case.appeal_deadline = env.ledger().timestamp() + APPEAL_SECS;
    } else {
        case.phase = CasePhase::Final;
    }
    save_case(env, &case);
    env.events().publish(
        (symbol_short!("arb"), symbol_short!("ruling")),
        (escrow.id, case.round, ruling, case.phase == CasePhase::Final),
    );
    Ok(case)
}

pub fn appeal(env: &Env, escrow: &EscrowAccount, party: Address) -> Result<DisputeCase, EscrowError> {
    let mut case = load_case(env, escrow.id)?;
    ensure(case.phase == CasePhase::Appealable && case.round == 0, EscrowError::AppealNotAllowed)?;
    ensure(env.ledger().timestamp() < case.appeal_deadline, EscrowError::AppealNotAllowed)?;

    let mut exclude = parties(env, escrow);
    for a in case.past_panels.iter() {
        exclude.push_back(a);
    }
    for a in case.panel.iter() {
        exclude.push_back(a);
    }
    let panel = draw_panel(env, APPEAL_PANEL_SIZE, &exclude)?;

    for a in case.panel.iter() {
        case.past_panels.push_back(a);
    }
    case.round = 1;
    case.empty_rounds = 0;
    case.ruling_bps = None;
    case.appeal_deadline = 0;
    case.appellant = Some(party.clone());
    start_round(env, &mut case, panel);
    save_case(env, &case);
    env.events().publish((symbol_short!("arb"), symbol_short!("appeal")), (escrow.id, party));
    Ok(case)
}

/// Mark an unappealed round-0 ruling final once the window has passed and
/// return the payee share to pay out.
pub fn finalize_unappealed(env: &Env, escrow_id: u64) -> Result<u32, EscrowError> {
    let mut case = load_case(env, escrow_id)?;
    ensure(case.phase == CasePhase::Appealable, EscrowError::WrongPhase)?;
    ensure(env.ledger().timestamp() >= case.appeal_deadline, EscrowError::WrongPhase)?;
    let bps = case.ruling_bps.ok_or(EscrowError::WrongPhase)?;
    case.phase = CasePhase::Final;
    save_case(env, &case);
    Ok(bps)
}
