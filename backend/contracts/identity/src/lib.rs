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

#[contracttype]
#[derive(Clone)]
pub struct KycAttestation {
    pub user: Address,
    pub level: KycLevel,
    pub attested_at: u64,
    pub expires_at: u64,
}

#[contracttype]
pub enum DataKey {
    Proof(Address, BytesN<32>),
    ProofCount(Address),
    KycAttestation(Address),
    Admin,
    Tier(Address),
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

    pub fn attest_kyc(env: Env, admin: Address, user: Address, level: KycLevel) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can attest KYC");

        env.storage().persistent().set(
            &DataKey::KycAttestation(user.clone()),
            &KycAttestation {
                user: user.clone(),
                level,
                attested_at: env.ledger().timestamp(),
                expires_at: env.ledger().timestamp() + ONE_YEAR_SECS,
            },
        );

        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("attested")),
            (user, level),
        );
    }

    pub fn check_kyc(env: Env, user: Address, required_level: KycLevel) -> bool {
        if let Some(attestation) = env.storage().persistent().get::<DataKey, KycAttestation>(&DataKey::KycAttestation(user)) {
            if env.ledger().timestamp() > attestation.expires_at {
                return false;
            }
            (attestation.level as u8) >= (required_level as u8)
        } else {
            false
        }
    }

    pub fn get_kyc_attestation(env: Env, user: Address) -> Option<KycAttestation> {
        env.storage().persistent().get(&DataKey::KycAttestation(user))
    }

    /// Mark a user as KYC-verified following off-chain OCR document review
    /// and admin approval (see `KYCSubmission` in the application database).
    /// Only the platform admin may call this. Records a `Basic`-level
    /// `KycAttestation` and emits an event carrying `kyc_submission_id` so
    /// on-chain activity can be traced back to the reviewed document.
    pub fn verify_kyc(env: Env, admin: Address, user: Address, kyc_submission_id: BytesN<32>) -> bool {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can verify KYC");

        env.storage().persistent().set(
            &DataKey::KycAttestation(user.clone()),
            &KycAttestation {
                user: user.clone(),
                level: KycLevel::Basic,
                attested_at: env.ledger().timestamp(),
                expires_at: env.ledger().timestamp() + ONE_YEAR_SECS,
            },
        );

        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("verified")),
            (user, kyc_submission_id),
        );

        true
    }

    /// Revoke a user's KYC attestation. Admin-only.
    ///
    /// Removes the attestation outright, so `check_kyc` returns `false` for
    /// every level and `get_kyc_attestation` returns `None` — a revoked user
    /// reads exactly like one who was never verified. A fresh `attest_kyc` /
    /// `verify_kyc` re-verifies them. Emits `(kyc, revoked)` → `(user, level)`
    /// with the level that was revoked.
    pub fn revoke_kyc(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can revoke KYC");

        let key = DataKey::KycAttestation(user.clone());
        let attestation: KycAttestation = env
            .storage()
            .persistent()
            .get(&key)
            .expect("KYC attestation not found");
        env.storage().persistent().remove(&key);

        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("revoked")),
            (user, attestation.level),
        );
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

