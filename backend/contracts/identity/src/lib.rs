#![no_std]
// `Events::publish` is deprecated in soroban-sdk 23 in favour of `#[contractevent]`.
// Migrating changes the on-chain event topic/data layout the indexer decodes,
// so it is kept as-is for the SDK upgrade and tracked as a separate change.
#![allow(deprecated)]

//! On-chain identity attestations: social-domain proofs, KYC levels and
//! verification tiers. Semantics of "verified", who may issue each
//! attestation, expiry and revocation are specified in
//! `docs/identity-verification.md` (Issue #1567).

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, Address, Bytes, BytesN, Env,
};

/// Error types for identity verification operations (Issue #1341)
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum IdentityError {
    Unauthorized = 1,
    InvalidSignature = 2,
    InvalidDomainHash = 3,
    AlreadyVerified = 4,
    ProofNotFound = 5,
}

#[contracttype]
#[derive(Clone)]
pub struct SocialProof {
    pub owner: Address,
    pub domain_hash: BytesN<32>,
    pub proof: BytesN<64>,
    pub verified: bool,
    pub submitted_at: u64,
}

/// Decentralized authenticity record linking an address to verified social domains (Issue #1341)
#[contracttype]
#[derive(Clone)]
pub struct DomainAttestation {
    pub address: Address,
    pub domain_hash: BytesN<32>,
    pub verified: bool,
    pub attested_at: u64,
}

/// On-chain tier levels mirroring the DB enum.
/// Stored as u32 for compact Soroban storage.
/// NONE=0  VERIFIED=1  TRUSTED=2  ELITE=3
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum VerificationTier {
    None,
    Verified,
    Trusted,
    Elite,
}

/// Tier attestation stored for each creator address
#[contracttype]
#[derive(Clone)]
pub struct TierAttestation {
    pub owner: Address,
    pub tier: VerificationTier,
    pub attested_at: u64,
    pub attested_by: Address, // platform oracle / admin address
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum KycLevel {
    Basic = 0,
    Enhanced = 1,
    Institutional = 2,
}

/// Legacy plaintext KYC record (pre-#1718). Kept only so old storage
/// entries keep their type; the contract no longer writes it.
#[contracttype]
#[derive(Clone)]
pub struct KycAttestation {
    pub user: Address,
    pub level: KycLevel,
    pub attested_at: u64,
    pub expires_at: u64,
}

/// On-chain KYC record (Issue #1718): only a salted hash of the level.
/// `commitment = sha256([level as u8] || salt)`; the 32-byte salt never goes
/// on-chain.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct KycCommitment {
    pub commitment: BytesN<32>,
    pub attested_at: u64,
    pub expires_at: u64,
}

/// `sha256([level as u8] || salt)`, matching `lib/kyc-commitment.ts`.
pub fn kyc_commitment(env: &Env, level: KycLevel, salt: &BytesN<32>) -> BytesN<32> {
    let mut msg = Bytes::new(env);
    msg.push_back(level as u8);
    msg.append(&salt.clone().into());
    env.crypto().sha256(&msg).to_bytes()
}

#[contracttype]
pub enum DataKey {
    Proof(Address, BytesN<32>),
    ProofCount(Address),
    /// Legacy plaintext KYC record (pre-#1718). Never written any more; read
    /// only by `has_legacy_kyc` and removed by `purge_legacy_kyc`/`revoke_kyc`.
    KycAttestation(Address),
    Admin,
    Tier(Address),
    KycCommitment(Address),
}

#[contract]
pub struct IdentityContract;

const ONE_YEAR_SECS: u64 = 365 * 24 * 60 * 60;

#[contractimpl]
impl IdentityContract {
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        assert!(!env.storage().persistent().has(&DataKey::Admin), "Already initialized");
        env.storage().persistent().set(&DataKey::Admin, &admin);
    }

    /// Submit a cryptographic proof linking an address to a social domain.
    /// Verifies the Ed25519 signature of `domain_hash` under `public_key`
    /// natively via `env.crypto().ed25519_verify`.
    ///
    /// # Arguments
    /// * `owner` - The Address submitting the proof (must authenticate)
    /// * `domain_hash` - The 32-byte hash of the social domain/handle
    /// * `public_key` - The Ed25519 public key used for signature verification
    /// * `proof` - The Ed25519 signature proof (64 bytes)
    ///
    /// # Returns
    /// bool - true on successful verification
    ///
    /// # Errors
    /// Panics with message if:
    /// - `owner` does not authenticate the call
    /// - Proof is already verified for this owner+domain_hash pair
    /// - Ed25519 signature verification fails (invalid signature)
    pub fn submit_proof(
        env: Env,
        owner: Address,
        domain_hash: BytesN<32>,
        public_key: BytesN<32>,
        proof: BytesN<64>,
    ) -> bool {
        owner.require_auth();

        let key = DataKey::Proof(owner.clone(), domain_hash.clone());
        if let Some(existing) = env.storage().persistent().get::<DataKey, SocialProof>(&key) {
            assert!(!existing.verified, "Proof already verified");
        }

        let msg: Bytes = domain_hash.clone().into();
        env.crypto().ed25519_verify(&public_key, &msg, &proof);

        env.storage().persistent().set(
            &key,
            &SocialProof {
                owner: owner.clone(),
                domain_hash: domain_hash.clone(),
                proof,
                verified: true,
                submitted_at: env.ledger().timestamp(),
            },
        );

        let count_key = DataKey::ProofCount(owner.clone());
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        env.storage().persistent().set(&count_key, &(count + 1));

        env.events().publish(
            (symbol_short!("identity"), symbol_short!("proof_ok")),
            (owner, domain_hash),
        );

        true
    }

    pub fn get_proof(env: Env, owner: Address, domain_hash: BytesN<32>) -> SocialProof {
        env.storage()
            .persistent()
            .get::<DataKey, SocialProof>(&DataKey::Proof(owner, domain_hash))
            .expect("Proof not found")
    }

    pub fn has_proof(env: Env, owner: Address, domain_hash: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, SocialProof>(&DataKey::Proof(owner, domain_hash))
            .map(|p| p.verified)
            .unwrap_or(false)
    }

    pub fn revoke_proof(env: Env, owner: Address, domain_hash: BytesN<32>) -> bool {
        owner.require_auth();
        let key = DataKey::Proof(owner.clone(), domain_hash.clone());
        assert!(env.storage().persistent().has(&key), "Proof not found");
        env.storage().persistent().remove(&key);

        let count_key = DataKey::ProofCount(owner.clone());
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        if count > 0 {
            env.storage().persistent().set(&count_key, &(count - 1));
        }

        env.events().publish(
            (symbol_short!("identity"), symbol_short!("revoked")),
            (owner, domain_hash),
        );

        true
    }

    pub fn proof_count(env: Env, owner: Address) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::ProofCount(owner))
            .unwrap_or(0)
    }

    // ── KYC: commitments only (Issue #1718) ──────────────────────────────────
    //
    // Contract storage and events are public, so the contract never stores or
    // emits a user's KYC level. The admin records only
    // `commitment = sha256(level_byte || salt)` with a 32-byte secret salt
    // kept off-chain. At use time the user (or the platform on their behalf)
    // presents the opening `(level, salt)` to `check_kyc`, which recomputes the
    // hash against the admin-written commitment. See
    // docs/identity-verification.md (Privacy).

    /// Record a KYC commitment for `user`. Admin-only. Replaces any earlier
    /// commitment and restarts the one-year expiry.
    ///
    /// Event: `(kyc, attested)` → `(user, commitment)`.
    pub fn attest_kyc(env: Env, admin: Address, user: Address, commitment: BytesN<32>) {
        Self::require_admin(&env, &admin, "Only admin can attest KYC");
        Self::store_commitment(&env, &user, &commitment);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("attested")),
            (user, commitment),
        );
    }

    /// Record a KYC commitment following off-chain document review (see
    /// `KYCSubmission`). Admin-only. The event carries the hashed
    /// `kyc_submission_id` so activity can be traced to the reviewed record.
    ///
    /// Event: `(kyc, verified)` → `(user, kyc_submission_id)`.
    pub fn verify_kyc(
        env: Env,
        admin: Address,
        user: Address,
        commitment: BytesN<32>,
        kyc_submission_id: BytesN<32>,
    ) -> bool {
        Self::require_admin(&env, &admin, "Only admin can verify KYC");
        Self::store_commitment(&env, &user, &commitment);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("verified")),
            (user, kyc_submission_id),
        );
        true
    }

    /// Check a presented opening against the stored commitment. Returns
    /// `true` only if `sha256(level || salt)` matches, the commitment has not
    /// expired, and `level >= required_level`.
    pub fn check_kyc(
        env: Env,
        user: Address,
        required_level: KycLevel,
        level: KycLevel,
        salt: BytesN<32>,
    ) -> bool {
        let stored: KycCommitment = match env
            .storage()
            .persistent()
            .get(&DataKey::KycCommitment(user))
        {
            Some(c) => c,
            None => return false,
        };
        if env.ledger().timestamp() > stored.expires_at {
            return false;
        }
        if kyc_commitment(&env, level, &salt) != stored.commitment {
            return false;
        }
        (level as u8) >= (required_level as u8)
    }

    /// The stored commitment for `user`, if any. Reveals no level.
    pub fn get_kyc_commitment(env: Env, user: Address) -> Option<KycCommitment> {
        env.storage().persistent().get(&DataKey::KycCommitment(user))
    }

    /// Compute the commitment for an opening. Read-only helper so clients can
    /// check their encoding matches the contract's.
    pub fn compute_kyc_commitment(env: Env, level: KycLevel, salt: BytesN<32>) -> BytesN<32> {
        kyc_commitment(&env, level, &salt)
    }

    /// Revoke a user's KYC commitment (and any legacy plaintext record).
    /// Admin-only. Afterwards `check_kyc` returns `false` for every opening.
    ///
    /// Event: `(kyc, revoked)` → `user`.
    pub fn revoke_kyc(env: Env, admin: Address, user: Address) {
        Self::require_admin(&env, &admin, "Only admin can revoke KYC");
        let key = DataKey::KycCommitment(user.clone());
        let legacy = DataKey::KycAttestation(user.clone());
        let storage = env.storage().persistent();
        assert!(storage.has(&key) || storage.has(&legacy), "KYC attestation not found");
        storage.remove(&key);
        storage.remove(&legacy);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("revoked")),
            user,
        );
    }

    /// Delete a pre-#1718 plaintext `KycAttestation` for `user`. Admin-only.
    /// Returns `false` if there was nothing to delete. Ledger history still
    /// holds the old value; this only removes it from current state.
    ///
    /// Event: `(kyc, purged)` → `user`.
    pub fn purge_legacy_kyc(env: Env, admin: Address, user: Address) -> bool {
        Self::require_admin(&env, &admin, "Only admin can purge KYC");
        let legacy = DataKey::KycAttestation(user.clone());
        if !env.storage().persistent().has(&legacy) {
            return false;
        }
        env.storage().persistent().remove(&legacy);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("purged")),
            user,
        );
        true
    }

    /// Whether a legacy plaintext KYC record still exists for `user`.
    pub fn has_legacy_kyc(env: Env, user: Address) -> bool {
        env.storage().persistent().has(&DataKey::KycAttestation(user))
    }

    fn require_admin(env: &Env, admin: &Address, msg: &'static str) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert!(*admin == stored_admin, "{}", msg);
    }

    fn store_commitment(env: &Env, user: &Address, commitment: &BytesN<32>) {
        let now = env.ledger().timestamp();
        env.storage().persistent().set(
            &DataKey::KycCommitment(user.clone()),
            &KycCommitment {
                commitment: commitment.clone(),
                attested_at: now,
                expires_at: now + ONE_YEAR_SECS,
            },
        );
        // Writing a commitment also drops any legacy plaintext record.
        env.storage()
            .persistent()
            .remove(&DataKey::KycAttestation(user.clone()));
    }

    /// Attest a creator's verification tier on-chain. Admin-only.
    ///
    /// Previously any address could call this for any owner (the attester
    /// only had to sign for itself), so trust badges could be self-issued.
    /// The attester must now be the stored platform admin.
    pub fn set_tier(
        env: Env,
        attester: Address,
        owner: Address,
        tier: VerificationTier,
    ) -> bool {
        attester.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(attester, stored_admin, "Only admin can set tier");

        let attestation = TierAttestation {
            owner: owner.clone(),
            tier: tier.clone(),
            attested_at: env.ledger().timestamp(),
            attested_by: attester,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Tier(owner.clone()), &attestation);

        env.events().publish(
            (symbol_short!("identity"), symbol_short!("tier_set")),
            (owner, tier),
        );

        true
    }

    /// Revoke a creator's tier attestation. Admin-only. Afterwards `get_tier`
    /// returns `VerificationTier::None`. Emits `(identity, tier_rev)` →
    /// `(owner, revoked_tier)`.
    pub fn revoke_tier(env: Env, admin: Address, owner: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can revoke tier");

        let key = DataKey::Tier(owner.clone());
        let attestation: TierAttestation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("Tier not set");
        env.storage().persistent().remove(&key);

        env.events().publish(
            (symbol_short!("identity"), symbol_short!("tier_rev")),
            (owner, attestation.tier),
        );
    }

    /// Retrieve the tier attestation for a creator.
    /// Returns None variant attestation if not yet set or revoked.
    pub fn get_tier(env: Env, owner: Address) -> VerificationTier {
        env.storage()
            .persistent()
            .get::<DataKey, TierAttestation>(&DataKey::Tier(owner))
            .map(|a| a.tier)
            .unwrap_or(VerificationTier::None)
    }

    // ── Issue #1564: Timelocked upgrade + two-step admin transfer ─────────────
    //
    // Replaces the old instant `upgrade` entrypoint. Shared logic lives in
    // `stellar-upgradeable`; see docs/contracts.md (Upgrading a live contract).

    /// Propose a WASM upgrade. Admin-only. Returns the ledger timestamp after
    /// which `execute_upgrade` may be called (now + 48h). Emits
    /// `(upgrade, proposed)`.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> u64 {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::propose_upgrade(&env, &admin, &stored_admin, new_wasm_hash)
    }

    /// Apply the pending upgrade once its timelock has elapsed. Admin-only.
    /// Emits `(contract, upgraded)`.
    pub fn execute_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::execute_upgrade(&env, &admin, &stored_admin);
    }

    /// Withdraw the pending upgrade. Admin-only. Emits `(upgrade, cancelled)`.
    pub fn cancel_upgrade(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::cancel_upgrade(&env, &admin, &stored_admin);
    }

    /// The upgrade currently waiting out its timelock, if any.
    pub fn get_pending_upgrade(env: Env) -> Option<stellar_upgradeable::PendingUpgrade> {
        stellar_upgradeable::pending_upgrade(&env)
    }

    /// Nominate a new admin (step 1 of 2). Admin-only. Emits `(admin, proposed)`.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::propose_admin(&env, &admin, &stored_admin, &new_admin);
    }

    /// Accept a nomination (step 2 of 2). Must be signed by the nominee.
    /// Emits `(admin, accepted)`.
    pub fn accept_admin(env: Env, new_admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        let accepted = stellar_upgradeable::accept_admin(&env, &new_admin, &stored_admin);
        env.storage().persistent().set(&DataKey::Admin, &accepted);
    }

    /// Withdraw a pending admin nomination. Admin-only. Emits `(admin, cancelled)`.
    pub fn cancel_admin_transfer(env: Env, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Admin)
            .expect("Not initialized");
        stellar_upgradeable::cancel_admin_transfer(&env, &admin, &stored_admin);
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        stellar_upgradeable::pending_admin(&env)
    }
}

#[cfg(test)]
mod test;


// Issue #1719: shared upgrade-timelock conformance tests.
stellar_upgradeable::upgrade_timelock_tests!(
    upgrade_conformance,
    IdentityContract,
    IdentityContractClient,
    |env, id, admin| {
        IdentityContractClient::new(&env, &id).initialize(&admin);
    }
);
