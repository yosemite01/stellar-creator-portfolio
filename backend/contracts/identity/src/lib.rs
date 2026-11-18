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

/// Current KYC attestation schema (issue #1717). Bump when fields change.
pub const KYC_SCHEMA_VERSION: u32 = 2;

/// Issuer id reserved for the platform admin (`attest_kyc` / `verify_kyc`)
/// and for attestations written before issue #1717.
pub const ADMIN_ISSUER_ID: u32 = 0;

/// KYC attestation (schema v2, issue #1717). Each attestation names the
/// issuer that wrote it and the issuer key version that signed it, so an
/// issuer (or one of its compromised keys) can be cut off in O(1) without
/// touching individual attestations.
#[contracttype]
#[derive(Clone)]
pub struct KycAttestation {
    pub user: Address,
    pub level: KycLevel,
    pub issuer_id: u32,
    pub key_version: u32,
    pub issued_at: u64,
    pub expires_at: u64,
    pub schema_version: u32,
}

/// Pre-#1717 attestation layout, still readable so existing records keep
/// working until they expire. Treated as issued by `ADMIN_ISSUER_ID`, key 0.
#[contracttype]
#[derive(Clone)]
pub struct LegacyKycAttestation {
    pub user: Address,
    pub level: KycLevel,
    pub attested_at: u64,
    pub expires_at: u64,
}

/// A registered KYC issuer. `signer` is the issuer's current key; rotating
/// it bumps `key_version`. Attestations signed by a key older than
/// `min_key_version` are invalid, and a `revoked` issuer invalidates every
/// attestation it ever wrote.
#[contracttype]
#[derive(Clone)]
pub struct KycIssuer {
    pub id: u32,
    pub signer: Address,
    pub key_version: u32,
    pub min_key_version: u32,
    pub revoked: bool,
    pub registered_at: u64,
}

#[contracttype]
pub enum DataKey {
    Proof(Address, BytesN<32>),
    ProofCount(Address),
    /// Legacy (schema v1) attestation slot; read-only after #1717.
    KycAttestation(Address),
    Admin,
    Tier(Address),
    /// Schema v2 attestation (#1717).
    Kyc(Address),
    /// Issuer registry (#1717).
    Issuer(u32),
    IssuerCount,
}

/// Typed errors for the KYC issuer registry (#1717). Surface on-chain as
/// `Error(Contract, #n)`; never renumber, only append.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum KycError {
    NotInitialized = 101,
    Unauthorized = 102,
    IssuerNotFound = 103,
    IssuerRevoked = 104,
    InvalidTtl = 105,
    AttestationNotFound = 106,
}

#[contract]
pub struct IdentityContract;

const ONE_YEAR_SECS: u64 = 365 * 24 * 60 * 60;
/// Longest validity an issuer may grant an attestation.
pub const MAX_KYC_TTL_SECS: u64 = ONE_YEAR_SECS;

fn stored_admin(env: &Env) -> Result<Address, KycError> {
    env.storage().persistent().get(&DataKey::Admin).ok_or(KycError::NotInitialized)
}

fn require_admin(env: &Env, admin: &Address) -> Result<(), KycError> {
    admin.require_auth();
    if *admin != stored_admin(env)? {
        return Err(KycError::Unauthorized);
    }
    Ok(())
}

/// Issuer record, with `ADMIN_ISSUER_ID` implicitly registered (active,
/// key version 0) until the admin revokes or rotates it.
fn load_issuer(env: &Env, issuer_id: u32) -> Result<KycIssuer, KycError> {
    if let Some(issuer) = env.storage().persistent().get::<DataKey, KycIssuer>(&DataKey::Issuer(issuer_id)) {
        return Ok(issuer);
    }
    if issuer_id == ADMIN_ISSUER_ID {
        return Ok(KycIssuer {
            id: ADMIN_ISSUER_ID,
            signer: stored_admin(env)?,
            key_version: 0,
            min_key_version: 0,
            revoked: false,
            registered_at: 0,
        });
    }
    Err(KycError::IssuerNotFound)
}

fn read_attestation(env: &Env, user: &Address) -> Option<KycAttestation> {
    if let Some(a) = env.storage().persistent().get::<DataKey, KycAttestation>(&DataKey::Kyc(user.clone())) {
        return Some(a);
    }
    env.storage()
        .persistent()
        .get::<DataKey, LegacyKycAttestation>(&DataKey::KycAttestation(user.clone()))
        .map(|l| KycAttestation {
            user: l.user,
            level: l.level,
            issuer_id: ADMIN_ISSUER_ID,
            key_version: 0,
            issued_at: l.attested_at,
            expires_at: l.expires_at,
            schema_version: 1,
        })
}

fn write_attestation(env: &Env, user: &Address, level: KycLevel, issuer: &KycIssuer, ttl_secs: u64) {
    let now = env.ledger().timestamp();
    env.storage().persistent().set(
        &DataKey::Kyc(user.clone()),
        &KycAttestation {
            user: user.clone(),
            level,
            issuer_id: issuer.id,
            key_version: issuer.key_version,
            issued_at: now,
            expires_at: now + ttl_secs,
            schema_version: KYC_SCHEMA_VERSION,
        },
    );
    // A fresh v2 record supersedes any legacy one.
    env.storage().persistent().remove(&DataKey::KycAttestation(user.clone()));
}

/// Is this attestation currently valid: unexpired, issuer not revoked, and
/// signed by a key version the issuer still accepts.
fn attestation_valid(env: &Env, a: &KycAttestation) -> bool {
    if env.ledger().timestamp() > a.expires_at {
        return false;
    }
    match load_issuer(env, a.issuer_id) {
        Ok(issuer) => !issuer.revoked && a.key_version >= issuer.min_key_version,
        Err(_) => false,
    }
}

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

    /// Admin-issued KYC attestation (issuer `ADMIN_ISSUER_ID`, one-year
    /// validity). Overwrites any existing attestation.
    pub fn attest_kyc(env: Env, admin: Address, user: Address, level: KycLevel) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can attest KYC");
        let issuer = load_issuer(&env, ADMIN_ISSUER_ID).expect("Not initialized");
        assert!(!issuer.revoked, "Admin issuer revoked");

        write_attestation(&env, &user, level, &issuer, ONE_YEAR_SECS);

        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("attested")),
            (user, level),
        );
    }

    // ── KYC issuer registry (issue #1717) ─────────────────────────────────

    /// Register a third-party KYC issuer whose current key is `signer`.
    /// Admin-only. Returns the new issuer id (ids start at 1; 0 is the
    /// platform admin). Emits `(kyc, iss_reg)` → `(id, signer)`.
    pub fn register_issuer(env: Env, admin: Address, signer: Address) -> Result<u32, KycError> {
        require_admin(&env, &admin)?;
        let id: u32 = env.storage().persistent().get(&DataKey::IssuerCount).unwrap_or(0) + 1;
        env.storage().persistent().set(&DataKey::IssuerCount, &id);
        env.storage().persistent().set(
            &DataKey::Issuer(id),
            &KycIssuer {
                id,
                signer: signer.clone(),
                key_version: 1,
                min_key_version: 1,
                revoked: false,
                registered_at: env.ledger().timestamp(),
            },
        );
        env.events().publish((symbol_short!("kyc"), symbol_short!("iss_reg")), (id, signer));
        Ok(id)
    }

    /// Rotate an issuer's key. Callable by the admin or the issuer's current
    /// signer. With `invalidate_previous`, every attestation signed by an
    /// older key stops validating immediately (O(1) — the compromised-key
    /// response). Emits `(kyc, iss_rot)` → `(id, key_version, invalidate_previous)`.
    pub fn rotate_issuer_key(
        env: Env,
        caller: Address,
        issuer_id: u32,
        new_signer: Address,
        invalidate_previous: bool,
    ) -> Result<u32, KycError> {
        caller.require_auth();
        let mut issuer = load_issuer(&env, issuer_id)?;
        if issuer.revoked {
            return Err(KycError::IssuerRevoked);
        }
        if caller != stored_admin(&env)? && caller != issuer.signer {
            return Err(KycError::Unauthorized);
        }
        issuer.signer = new_signer;
        issuer.key_version += 1;
        if invalidate_previous {
            issuer.min_key_version = issuer.key_version;
        }
        env.storage().persistent().set(&DataKey::Issuer(issuer_id), &issuer);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("iss_rot")),
            (issuer_id, issuer.key_version, invalidate_previous),
        );
        Ok(issuer.key_version)
    }

    /// Revoke an issuer. Admin-only. Every attestation it wrote stops
    /// validating in O(1); none are touched individually. Irreversible:
    /// register a new issuer instead. Emits `(kyc, iss_rev)` → `id`.
    pub fn revoke_issuer(env: Env, admin: Address, issuer_id: u32) -> Result<(), KycError> {
        require_admin(&env, &admin)?;
        let mut issuer = load_issuer(&env, issuer_id)?;
        issuer.revoked = true;
        env.storage().persistent().set(&DataKey::Issuer(issuer_id), &issuer);
        env.events().publish((symbol_short!("kyc"), symbol_short!("iss_rev")), issuer_id);
        Ok(())
    }

    pub fn get_issuer(env: Env, issuer_id: u32) -> Result<KycIssuer, KycError> {
        load_issuer(&env, issuer_id)
    }

    /// Attestation written by a registered issuer, signed by its current
    /// key. `ttl_secs` must be in `1..=MAX_KYC_TTL_SECS`. Emits
    /// `(kyc, iss_att)` → `(user, level, issuer_id, expires_at)`.
    pub fn issuer_attest_kyc(
        env: Env,
        signer: Address,
        issuer_id: u32,
        user: Address,
        level: KycLevel,
        ttl_secs: u64,
    ) -> Result<(), KycError> {
        signer.require_auth();
        let issuer = load_issuer(&env, issuer_id)?;
        if issuer.revoked {
            return Err(KycError::IssuerRevoked);
        }
        if signer != issuer.signer {
            return Err(KycError::Unauthorized);
        }
        if ttl_secs == 0 || ttl_secs > MAX_KYC_TTL_SECS {
            return Err(KycError::InvalidTtl);
        }
        write_attestation(&env, &user, level, &issuer, ttl_secs);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("iss_att")),
            (user, level, issuer_id, env.ledger().timestamp() + ttl_secs),
        );
        Ok(())
    }

    /// Canonical KYC read. True only if an attestation exists, has not
    /// expired, its issuer is not revoked, it was signed by a key version the
    /// issuer still accepts, and its level is at least `required_level`.
    pub fn check_kyc(env: Env, user: Address, required_level: KycLevel) -> bool {
        match read_attestation(&env, &user) {
            Some(a) => attestation_valid(&env, &a) && (a.level as u8) >= (required_level as u8),
            None => false,
        }
    }

    /// The stored attestation (legacy records mapped to schema v1), valid or
    /// not. Use `check_kyc` for decisions.
    pub fn get_kyc_attestation(env: Env, user: Address) -> Option<KycAttestation> {
        read_attestation(&env, &user)
    }

    /// Mark a user as KYC-verified following off-chain OCR document review
    /// and admin approval (see `KYCSubmission` in the application database).
    /// Only the platform admin may call this. Records a `Basic`-level
    /// `KycAttestation` (issuer `ADMIN_ISSUER_ID`, one year) and emits an
    /// event carrying `kyc_submission_id` so on-chain activity can be traced
    /// back to the reviewed document. Also used by the re-attestation job.
    pub fn verify_kyc(env: Env, admin: Address, user: Address, kyc_submission_id: BytesN<32>) -> bool {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can verify KYC");
        let issuer = load_issuer(&env, ADMIN_ISSUER_ID).expect("Not initialized");
        assert!(!issuer.revoked, "Admin issuer revoked");

        write_attestation(&env, &user, KycLevel::Basic, &issuer, ONE_YEAR_SECS);

        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("verified")),
            (user, kyc_submission_id),
        );

        true
    }

    /// Revoke a user's KYC attestation. Admin-only.
    ///
    /// Removes the attestation outright (both v2 and legacy slots), so
    /// `check_kyc` returns `false` for every level and `get_kyc_attestation`
    /// returns `None`. Emits `(kyc, revoked)` → `(user, level)`. To cut off
    /// every attestation from one issuer at once, use `revoke_issuer`.
    pub fn revoke_kyc(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can revoke KYC");

        let attestation = read_attestation(&env, &user).expect("KYC attestation not found");
        env.storage().persistent().remove(&DataKey::Kyc(user.clone()));
        env.storage().persistent().remove(&DataKey::KycAttestation(user.clone()));

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

