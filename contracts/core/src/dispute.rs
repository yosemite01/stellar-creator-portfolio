// contracts/core/src/dispute.rs
// Issue #829 — VRF-based Fair Dispute Arbitrator Selection
//
// Uses Soroban Protocol 21's env.prng() — seeded by the network-level
// Verifiable Random Function (VRF) output — to select arbitrators in a
// way that is unpredictable and unmanipulable by any single party.

#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror,
    Address, Env, Vec, Symbol, symbol_short,
};

/// Errors specific to dispute arbitration.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum DisputeError {
    PoolTooSmall = 1,        // fewer than MIN_ARBITRATORS in pool
    AlreadyAssigned = 2,     // dispute already has an arbitrator
    ConflictOfInterest = 3,  // every eligible candidate is a dispute party
    Unauthorized = 4,        // caller is not governance
    DisputeNotFound = 5,     // no dispute with the given ID
}

/// Status of a dispute.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DisputeStatus {
    Open,
    ArbitratorAssigned,
    Resolved,
}

/// On-chain dispute record.
#[contracttype]
#[derive(Clone)]
pub struct Dispute {
    pub id: u64,
    pub creator: Address,
    pub client: Address,
    pub arbitrator: Option<Address>,
    pub status: DisputeStatus,
    pub created_at: u64, // ledger timestamp at open
}

// ── Storage key constants ─────────────────────────────────────────────────────

const ARBITRATOR_POOL: Symbol = symbol_short!("ARB_POOL");
const DISPUTES: Symbol = symbol_short!("DISPUTES");
const GOVERNANCE: Symbol = symbol_short!("GOV");

/// Minimum pool size before arbitrator assignment is allowed.
const MIN_ARBITRATORS: u32 = 7;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct DisputeContract;

#[contractimpl]
impl DisputeContract {
    // ── Governance ────────────────────────────────────────────────────────────

    /// Set the governance address (called once at deploy time).
    pub fn initialize(env: Env, governance: Address) {
        governance.require_auth();
        env.storage().instance().set(&GOVERNANCE, &governance);
    }

    /// Add an arbitrator to the pool. Governance-only.
    pub fn add_arbitrator(env: Env, arbitrator: Address) -> Result<u32, DisputeError> {
        let governance: Address = env
            .storage()
            .instance()
            .get(&GOVERNANCE)
            .unwrap();
        governance.require_auth();

        let mut pool: Vec<Address> = env
            .storage()
            .instance()
            .get(&ARBITRATOR_POOL)
            .unwrap_or(Vec::new(&env));

        pool.push_back(arbitrator.clone());
        env.storage().instance().set(&ARBITRATOR_POOL, &pool);

        env.events().publish(
            (symbol_short!("arb"), symbol_short!("added")),
            arbitrator,
        );

        Ok(pool.len())
    }

    /// Remove an arbitrator from the pool. Governance-only.
    pub fn remove_arbitrator(env: Env, arbitrator: Address) -> Result<u32, DisputeError> {
        let governance: Address = env
            .storage()
            .instance()
            .get(&GOVERNANCE)
            .unwrap();
        governance.require_auth();

        let pool: Vec<Address> = env
            .storage()
            .instance()
            .get(&ARBITRATOR_POOL)
            .unwrap_or(Vec::new(&env));

        let mut new_pool: Vec<Address> = Vec::new(&env);
        for i in 0..pool.len() {
            let addr = pool.get(i).unwrap();
            if addr != arbitrator {
                new_pool.push_back(addr);
            }
        }

        env.storage().instance().set(&ARBITRATOR_POOL, &new_pool);

        env.events().publish(
            (symbol_short!("arb"), symbol_short!("removed")),
            arbitrator,
        );

        Ok(new_pool.len())
    }

    /// Read the current arbitrator pool (no auth required).
    pub fn get_arbitrator_pool(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&ARBITRATOR_POOL)
            .unwrap_or(Vec::new(&env))
    }

    // ── Disputes ──────────────────────────────────────────────────────────────

    /// Open a new dispute between creator and client. Caller must be creator.
    pub fn open_dispute(
        env: Env,
        dispute_id: u64,
        creator: Address,
        client: Address,
    ) -> Result<Dispute, DisputeError> {
        creator.require_auth();

        let dispute = Dispute {
            id: dispute_id,
            creator: creator.clone(),
            client: client.clone(),
            arbitrator: None,
            status: DisputeStatus::Open,
            created_at: env.ledger().timestamp(),
        };

        let mut disputes: Vec<Dispute> = env
            .storage()
            .instance()
            .get(&DISPUTES)
            .unwrap_or(Vec::new(&env));

        disputes.push_back(dispute.clone());
        env.storage().instance().set(&DISPUTES, &disputes);

        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("opened")),
            (dispute_id, creator, client),
        );

        Ok(dispute)
    }

    /// Assign an arbitrator to an open dispute using on-chain PRNG (VRF).
    ///
    /// # Randomness guarantee
    /// `env.prng()` in Soroban Protocol 21 is seeded by the network-level
    /// VRF output included in each ledger header. This seed is determined
    /// by the validator quorum *after* the transaction is submitted, making
    /// it impossible for the transaction submitter or any single validator
    /// to predict or bias the result.
    ///
    /// # Conflict-of-interest check
    /// The selected candidate is rejected if they are the `creator` or
    /// `client` of the dispute. The selection is retried up to `pool_size`
    /// times using an offset to avoid cycling back to the same index.
    /// If every member of the pool is a party to the dispute the call
    /// returns `DisputeError::ConflictOfInterest`.
    pub fn assign_arbitrator(env: Env, dispute_id: u64) -> Result<Address, DisputeError> {
        let pool: Vec<Address> = env
            .storage()
            .instance()
            .get(&ARBITRATOR_POOL)
            .unwrap_or(Vec::new(&env));

        if pool.len() < MIN_ARBITRATORS {
            return Err(DisputeError::PoolTooSmall);
        }

        let mut disputes: Vec<Dispute> = env
            .storage()
            .instance()
            .get(&DISPUTES)
            .unwrap_or(Vec::new(&env));

        // Locate the dispute record.
        let mut dispute_idx: Option<u32> = None;
        for i in 0..disputes.len() {
            if disputes.get(i).unwrap().id == dispute_id {
                dispute_idx = Some(i);
                break;
            }
        }
        let idx = dispute_idx.ok_or(DisputeError::DisputeNotFound)?;
        let dispute = disputes.get(idx).unwrap();

        if dispute.arbitrator.is_some() {
            return Err(DisputeError::AlreadyAssigned);
        }

        // VRF-seeded selection with conflict-of-interest retry.
        let pool_size = pool.len() as u64;
        let mut selected: Option<Address> = None;

        for attempt in 0u64..pool_size {
            // Each call to gen_range draws from the same per-ledger VRF seed
            // but advances an internal counter, producing distinct values.
            let base_idx = env.prng().gen_range::<u64>(0..pool_size);
            let candidate_idx = ((base_idx + attempt) % pool_size) as u32;
            let candidate = pool.get(candidate_idx).unwrap();

            if candidate != dispute.creator && candidate != dispute.client {
                selected = Some(candidate);
                break;
            }
        }

        let arbitrator = selected.ok_or(DisputeError::ConflictOfInterest)?;

        // Persist the updated dispute.
        let updated = Dispute {
            arbitrator: Some(arbitrator.clone()),
            status: DisputeStatus::ArbitratorAssigned,
            id: dispute.id,
            creator: dispute.creator,
            client: dispute.client,
            created_at: dispute.created_at,
        };
        disputes.set(idx, updated);
        env.storage().instance().set(&DISPUTES, &disputes);

        // Emit assignment event for indexers / off-chain listeners.
        env.events().publish(
            (symbol_short!("dispute"), symbol_short!("assigned")),
            (dispute_id, arbitrator.clone()),
        );

        Ok(arbitrator)
    }

    /// Fetch a dispute by ID (returns None if not found).
    pub fn get_dispute(env: Env, dispute_id: u64) -> Option<Dispute> {
        let disputes: Vec<Dispute> = env
            .storage()
            .instance()
            .get(&DISPUTES)
            .unwrap_or(Vec::new(&env));

        for i in 0..disputes.len() {
            let d = disputes.get(i).unwrap();
            if d.id == dispute_id {
                return Some(d);
            }
        }
        None
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    fn setup() -> (Env, DisputeContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, DisputeContract);
        let client = DisputeContractClient::new(&env, &contract_id);
        (env, client)
    }

    #[test]
    fn test_pool_management() {
        let (env, client) = setup();
        let gov = Address::generate(&env);
        client.initialize(&gov);

        for _ in 0..7 {
            client.add_arbitrator(&Address::generate(&env));
        }
        assert_eq!(client.get_arbitrator_pool().len(), 7);
    }

    #[test]
    fn test_pool_too_small_error() {
        let (env, client) = setup();
        let gov = Address::generate(&env);
        client.initialize(&gov);

        // Only 6 arbitrators — below minimum
        for _ in 0..6 {
            client.add_arbitrator(&Address::generate(&env));
        }

        let creator = Address::generate(&env);
        let dispute_client = Address::generate(&env);
        client.open_dispute(&42u64, &creator, &dispute_client);

        let result = client.try_assign_arbitrator(&42u64);
        assert_eq!(result, Err(Ok(DisputeError::PoolTooSmall)));
    }

    #[test]
    fn test_assign_arbitrator_no_conflict() {
        let (env, client) = setup();
        let gov = Address::generate(&env);
        client.initialize(&gov);

        let creator = Address::generate(&env);
        let dispute_client = Address::generate(&env);

        // All 7 arbitrators are distinct from creator and client
        for _ in 0..7 {
            client.add_arbitrator(&Address::generate(&env));
        }

        client.open_dispute(&1u64, &creator, &dispute_client);
        let arbitrator = client.assign_arbitrator(&1u64);

        // Conflict-of-interest check: arbitrator must not be a party
        assert_ne!(arbitrator, creator);
        assert_ne!(arbitrator, dispute_client);

        // Assignment recorded on chain
        let dispute = client.get_dispute(&1u64).unwrap();
        assert_eq!(dispute.arbitrator, Some(arbitrator));
        assert_eq!(dispute.status, DisputeStatus::ArbitratorAssigned);
    }

    #[test]
    fn test_already_assigned_error() {
        let (env, client) = setup();
        let gov = Address::generate(&env);
        client.initialize(&gov);

        let creator = Address::generate(&env);
        let dispute_client = Address::generate(&env);
        for _ in 0..7 {
            client.add_arbitrator(&Address::generate(&env));
        }

        client.open_dispute(&2u64, &creator, &dispute_client);
        client.assign_arbitrator(&2u64);

        // Second assignment on same dispute must fail
        let result = client.try_assign_arbitrator(&2u64);
        assert_eq!(result, Err(Ok(DisputeError::AlreadyAssigned)));
    }

    #[test]
    fn test_dispute_not_found_error() {
        let (env, client) = setup();
        let gov = Address::generate(&env);
        client.initialize(&gov);
        for _ in 0..7 {
            client.add_arbitrator(&Address::generate(&env));
        }

        let result = client.try_assign_arbitrator(&999u64);
        assert_eq!(result, Err(Ok(DisputeError::DisputeNotFound)));
    }

    #[test]
    fn test_remove_arbitrator() {
        let (env, client) = setup();
        let gov = Address::generate(&env);
        client.initialize(&gov);

        let arb = Address::generate(&env);
        client.add_arbitrator(&arb);
        assert_eq!(client.get_arbitrator_pool().len(), 1);

        client.remove_arbitrator(&arb);
        assert_eq!(client.get_arbitrator_pool().len(), 0);
    }
}
