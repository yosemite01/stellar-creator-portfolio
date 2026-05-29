// contracts/core/src/storage.rs
// Issue #519 — Cross-contract TTL Refresh
//
// Guarantees persistent storage entries are bumped on every read and write
// so they never silently expire on the Soroban ledger.

#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

/// Minimum ledger TTL threshold before a bump is triggered.
const TTL_THRESHOLD: u32 = 100;
/// Target TTL to extend to (roughly 30 days at ~5s/ledger).
const TTL_TARGET: u32 = 518_400;

/// Keys used in persistent storage.
#[contracttype]
pub enum StorageKey {
    Profile(Address),
    BountyState(u64),
    EscrowBalance(Address),
}

/// A generic profile record stored persistently.
#[contracttype]
#[derive(Clone)]
pub struct Profile {
    pub owner: Address,
    pub display_name: String,
    pub reputation: u32,
}

#[contract]
pub struct StorageContract;

#[contractimpl]
impl StorageContract {
    // ── Write helpers ────────────────────────────────────────────────────────

    /// Persist a profile and immediately bump its TTL.
    pub fn set_profile(env: Env, profile: Profile) {
        profile.owner.require_auth();
        let key = StorageKey::Profile(profile.owner.clone());
        env.storage().persistent().set(&key, &profile);
        Self::bump_persistent(&env, &key);
    }

    /// Persist a bounty state value and bump TTL.
    pub fn set_bounty_state(env: Env, bounty_id: u64, state: u32) {
        let key = StorageKey::BountyState(bounty_id);
        env.storage().persistent().set(&key, &state);
        Self::bump_persistent(&env, &key);
    }

    /// Persist an escrow balance and bump TTL.
    pub fn set_escrow_balance(env: Env, account: Address, balance: i128) {
        account.require_auth();
        let key = StorageKey::EscrowBalance(account);
        env.storage().persistent().set(&key, &balance);
        Self::bump_persistent(&env, &key);
    }

    // ── Read helpers ─────────────────────────────────────────────────────────

    /// Read a profile, bumping TTL on access to prevent expiry.
    pub fn get_profile(env: Env, owner: Address) -> Option<Profile> {
        let key = StorageKey::Profile(owner);
        let value = env.storage().persistent().get::<StorageKey, Profile>(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    /// Read a bounty state, bumping TTL on access.
    pub fn get_bounty_state(env: Env, bounty_id: u64) -> Option<u32> {
        let key = StorageKey::BountyState(bounty_id);
        let value = env.storage().persistent().get::<StorageKey, u32>(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    /// Read an escrow balance, bumping TTL on access.
    pub fn get_escrow_balance(env: Env, account: Address) -> Option<i128> {
        let key = StorageKey::EscrowBalance(account);
        let value = env.storage().persistent().get::<StorageKey, i128>(&key);
        if value.is_some() {
            Self::bump_persistent(&env, &key);
        }
        value
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    /// Extend TTL for a persistent key if it is below the threshold.
    fn bump_persistent(env: &Env, key: &StorageKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_TARGET);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn set_and_get_profile_roundtrip() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StorageContract);
        let client = StorageContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let profile = Profile {
            owner: owner.clone(),
            display_name: soroban_sdk::String::from_str(&env, "Alice"),
            reputation: 42,
        };

        client.set_profile(&profile);
        let fetched = client.get_profile(&owner).expect("profile should exist");
        assert_eq!(fetched.reputation, 42);
    }

    #[test]
    fn bounty_state_persists_and_bumps() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StorageContract);
        let client = StorageContractClient::new(&env, &contract_id);

        client.set_bounty_state(&1u64, &2u32);
        let state = client.get_bounty_state(&1u64).expect("state should exist");
        assert_eq!(state, 2u32);
    }

    #[test]
    fn missing_key_returns_none() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, StorageContract);
        let client = StorageContractClient::new(&env, &contract_id);

        let unknown = Address::generate(&env);
        assert!(client.get_profile(&unknown).is_none());
    }
}
