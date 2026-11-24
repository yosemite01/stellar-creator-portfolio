//! Shared TTL (state archival) policy for the platform contracts (#1720).
//!
//! Persistent Soroban entries are archived once their TTL runs out; after that
//! every read fails until someone submits a `RestoreFootprint` operation.
//! Escrows and bounties can sit idle for months, so each contract extends its
//! entries through this crate instead of hard-coding ledger counts:
//!
//! * every write of a user-facing entry extends it ([`extend`]);
//! * the single-entry getters (`get_escrow`, `get_bounty`, `get_proposal`)
//!   extend on read ([`extend_if_present`]);
//! * each contract exposes a permissionless keeper entrypoint that the
//!   backend keeper job (`app/api/admin/cron/contract-ttl`) calls for entries
//!   that are close to expiry.
//!
//! See `docs/contract-ttl.md` for the policy table and the restore procedure.
#![no_std]

use soroban_sdk::{Env, IntoVal, Val};

/// Ledgers per day at the ~5 second close time.
pub const LEDGERS_PER_DAY: u32 = 17_280;

/// Upper bound on ids a keeper call may extend in one transaction, so the
/// footprint stays well inside the per-transaction read/write entry limits.
pub const MAX_KEEPER_BATCH: u32 = 20;

/// How long an entry of a given kind should stay live.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TtlPolicy {
    /// Contract-wide settings: admin, config, counters, token addresses.
    Config,
    /// Records users depend on: escrows, bounties, applications, proposals,
    /// votes and voting checkpoints, arbiter registrations, dispute cases.
    UserEntry,
    /// Records that only matter for a bounded window (timelocks, vote
    /// commitments). They still outlive the window they guard.
    Ephemeral,
}

impl TtlPolicy {
    /// Extend once the remaining TTL drops below this many ledgers.
    pub const fn threshold(self) -> u32 {
        match self {
            TtlPolicy::Config => 60 * LEDGERS_PER_DAY,
            TtlPolicy::UserEntry => 30 * LEDGERS_PER_DAY,
            TtlPolicy::Ephemeral => 7 * LEDGERS_PER_DAY,
        }
    }

    /// Extend the TTL up to this many ledgers from now (capped at the
    /// network's `max_entry_ttl`).
    pub const fn extend_to(self) -> u32 {
        match self {
            TtlPolicy::Config => 180 * LEDGERS_PER_DAY,
            TtlPolicy::UserEntry => 120 * LEDGERS_PER_DAY,
            TtlPolicy::Ephemeral => 30 * LEDGERS_PER_DAY,
        }
    }

    /// `(threshold, extend_to)` clamped to the network maximum, keeping
    /// `threshold <= extend_to`.
    pub fn bounds(self, max_ttl: u32) -> (u32, u32) {
        let extend_to = self.extend_to().min(max_ttl);
        (self.threshold().min(extend_to), extend_to)
    }
}

/// Extend a persistent entry that is known to exist (just written or read).
pub fn extend<K>(env: &Env, key: &K, policy: TtlPolicy)
where
    K: IntoVal<Env, Val>,
{
    let (threshold, extend_to) = policy.bounds(env.storage().max_ttl());
    env.storage().persistent().extend_ttl(key, threshold, extend_to);
}

/// Extend a persistent entry if it exists. Returns whether it did.
pub fn extend_if_present<K>(env: &Env, key: &K, policy: TtlPolicy) -> bool
where
    K: IntoVal<Env, Val>,
{
    if !env.storage().persistent().has(key) {
        return false;
    }
    extend(env, key, policy);
    true
}

/// Extend the contract instance (code + instance storage).
pub fn extend_instance(env: &Env) {
    let (threshold, extend_to) = TtlPolicy::Config.bounds(env.storage().max_ttl());
    env.storage().instance().extend_ttl(threshold, extend_to);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::storage::Persistent as _;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::{contract, contractimpl, Symbol};

    #[contract]
    struct Dummy;

    #[contractimpl]
    impl Dummy {}

    #[test]
    fn bounds_never_exceed_network_max() {
        for policy in [TtlPolicy::Config, TtlPolicy::UserEntry, TtlPolicy::Ephemeral] {
            let (threshold, extend_to) = policy.bounds(1_000);
            assert_eq!(extend_to, 1_000);
            assert!(threshold <= extend_to);
            let (t, e) = policy.bounds(u32::MAX);
            assert_eq!((t, e), (policy.threshold(), policy.extend_to()));
        }
    }

    #[test]
    fn policies_are_ordered_by_lifetime() {
        assert!(TtlPolicy::Config.extend_to() > TtlPolicy::UserEntry.extend_to());
        assert!(TtlPolicy::UserEntry.extend_to() > TtlPolicy::Ephemeral.extend_to());
        for policy in [TtlPolicy::Config, TtlPolicy::UserEntry, TtlPolicy::Ephemeral] {
            assert!(policy.threshold() < policy.extend_to());
        }
    }

    #[test]
    fn extend_sets_policy_ttl() {
        let env = Env::default();
        let id = env.register(Dummy, ());
        env.as_contract(&id, || {
            let key = Symbol::new(&env, "k");
            env.storage().persistent().set(&key, &1u32);
            extend(&env, &key, TtlPolicy::UserEntry);
            let (_, extend_to) = TtlPolicy::UserEntry.bounds(env.storage().max_ttl());
            assert_eq!(env.storage().persistent().get_ttl(&key), extend_to);
        });
    }

    #[test]
    fn extend_if_present_skips_missing_entries() {
        let env = Env::default();
        let id = env.register(Dummy, ());
        env.as_contract(&id, || {
            let key = Symbol::new(&env, "missing");
            assert!(!extend_if_present(&env, &key, TtlPolicy::UserEntry));
        });
    }

    #[test]
    fn entry_survives_past_original_ttl_after_keeper_extension() {
        let env = Env::default();
        let id = env.register(Dummy, ());
        let key = Symbol::new(&env, "escrow");
        env.as_contract(&id, || {
            env.storage().persistent().set(&key, &7u32);
            extend(&env, &key, TtlPolicy::UserEntry);
        });
        // Idle for 100 days, then the keeper runs.
        env.ledger().with_mut(|l| l.sequence_number += 100 * LEDGERS_PER_DAY);
        env.as_contract(&id, || {
            assert!(extend_if_present(&env, &key, TtlPolicy::UserEntry));
        });
        // Another 100 days: past the first 120-day window, still readable.
        env.ledger().with_mut(|l| l.sequence_number += 100 * LEDGERS_PER_DAY);
        env.as_contract(&id, || {
            assert_eq!(env.storage().persistent().get::<_, u32>(&key), Some(7));
        });
    }
}
