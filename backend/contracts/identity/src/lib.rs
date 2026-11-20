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

/// Current KYC attestation schema. v2 added issuers (#1717); v3 replaces
/// the plaintext level with a salted commitment (#1718).
pub const KYC_SCHEMA_VERSION: u32 = 3;

/// Issuer id reserved for the platform admin (`attest_kyc` / `verify_kyc`)
/// and for attestations written before issue #1717.
pub const ADMIN_ISSUER_ID: u32 = 0;

/// KYC attestation (schema v3). Each attestation names the issuer that
/// wrote it and the issuer key version that signed it, so an issuer (or one
/// of its compromised keys) can be cut off in O(1) without touching
/// individual attestations (#1717). Contract storage is public, so only a
/// salted commitment to the level is stored, never the level itself (#1718).
#[contracttype]
#[derive(Clone)]
pub struct KycAttestation {
    pub user: Address,
    /// `sha256([level as u8] || salt)`; see [`kyc_commitment`].
    pub commitment: BytesN<32>,
    pub issuer_id: u32,
    pub key_version: u32,
    pub issued_at: u64,
    pub expires_at: u64,
    pub schema_version: u32,
}

/// Pre-#1717 plaintext attestation layout. No longer counts for `check_kyc`
/// (it reveals the level); kept so old entries can be detected and purged.
#[contracttype]
#[derive(Clone)]
pub struct LegacyKycAttestation {
    pub user: Address,
    pub level: KycLevel,
    pub attested_at: u64,
    pub expires_at: u64,
}

/// Commitment view of a user's attestation (#1718). Reveals no level.
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
    /// Legacy plaintext (schema v1) attestation slot. Never written any more;
    /// read only by `has_legacy_kyc` and removed by `purge_legacy_kyc` /
    /// `revoke_kyc`.
    KycAttestation(Address),
    Admin,
    Tier(Address),
    /// Current (v3) attestation.
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
    env.storage().persistent().get::<DataKey, KycAttestation>(&DataKey::Kyc(user.clone()))
}

fn write_attestation(env: &Env, user: &Address, commitment: &BytesN<32>, issuer: &KycIssuer, ttl_secs: u64) -> u64 {
    let now = env.ledger().timestamp();
    let expires_at = now + ttl_secs;
    env.storage().persistent().set(
        &DataKey::Kyc(user.clone()),
        &KycAttestation {
            user: user.clone(),
            commitment: commitment.clone(),
            issuer_id: issuer.id,
            key_version: issuer.key_version,
            issued_at: now,
            expires_at,
            schema_version: KYC_SCHEMA_VERSION,
        },
    );
    // A fresh record supersedes (and deletes) any legacy plaintext one.
    env.storage().persistent().remove(&DataKey::KycAttestation(user.clone()));
    expires_at
}

/// The admin issuer, checked to be active. Panics like the other admin
/// entrypoints when the contract is not initialized.
fn admin_issuer(env: &Env, admin: &Address, msg: &'static str) -> KycIssuer {
    admin.require_auth();
    let stored: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
    assert!(*admin == stored, "{}", msg);
    let issuer = load_issuer(env, ADMIN_ISSUER_ID).expect("Not initialized");
    assert!(!issuer.revoked, "Admin issuer revoked");
    issuer
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

    // ── KYC: issuer-signed commitments (#1717, #1718) ───────────────────────
    //
    // Contract storage and events are public, so the contract never stores or
    // emits a user's KYC level. Issuers record only
    // `commitment = sha256(level_byte || salt)` with a 32-byte secret salt
    // kept off-chain. At use time the user (or the platform on their behalf)
    // presents the opening `(level, salt)` to `check_kyc`, which recomputes the
    // hash and also checks the issuer and key version are still trusted.
    // See docs/identity-verification.md (Privacy).

    /// Admin-issued KYC commitment (issuer `ADMIN_ISSUER_ID`, one-year
    /// validity). Overwrites any existing attestation.
    ///
    /// Event: `(kyc, attested)` → `(user, commitment)`.
    pub fn attest_kyc(env: Env, admin: Address, user: Address, commitment: BytesN<32>) {
        let issuer = admin_issuer(&env, &admin, "Only admin can attest KYC");
        write_attestation(&env, &user, &commitment, &issuer, ONE_YEAR_SECS);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("attested")),
            (user, commitment),
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

    /// Commitment written by a registered issuer, signed by its current
    /// key. `ttl_secs` must be in `1..=MAX_KYC_TTL_SECS`. Emits
    /// `(kyc, iss_att)` → `(user, commitment, issuer_id, expires_at)`.
    pub fn issuer_attest_kyc(
        env: Env,
        signer: Address,
        issuer_id: u32,
        user: Address,
        commitment: BytesN<32>,
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
        let expires_at = write_attestation(&env, &user, &commitment, &issuer, ttl_secs);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("iss_att")),
            (user, commitment, issuer_id, expires_at),
        );
        Ok(())
    }

    /// Canonical KYC read: checks a presented opening `(level, salt)`.
    /// True only if an attestation exists, has not expired, its issuer is not
    /// revoked, it was signed by a key version the issuer still accepts,
    /// `sha256(level || salt)` matches its commitment, and
    /// `level >= required_level`.
    pub fn check_kyc(
        env: Env,
        user: Address,
        required_level: KycLevel,
        level: KycLevel,
        salt: BytesN<32>,
    ) -> bool {
        let a = match read_attestation(&env, &user) {
            Some(a) => a,
            None => return false,
        };
        attestation_valid(&env, &a)
            && kyc_commitment(&env, level, &salt) == a.commitment
            && (level as u8) >= (required_level as u8)
    }

    /// The stored attestation, valid or not. Reveals no level; use
    /// `check_kyc` for decisions.
    pub fn get_kyc_attestation(env: Env, user: Address) -> Option<KycAttestation> {
        read_attestation(&env, &user)
    }

    /// The stored commitment for `user`, if any. Reveals no level.
    pub fn get_kyc_commitment(env: Env, user: Address) -> Option<KycCommitment> {
        read_attestation(&env, &user).map(|a| KycCommitment {
            commitment: a.commitment,
            attested_at: a.issued_at,
            expires_at: a.expires_at,
        })
    }

    /// Compute the commitment for an opening. Read-only helper so clients can
    /// check their encoding matches the contract's.
    pub fn compute_kyc_commitment(env: Env, level: KycLevel, salt: BytesN<32>) -> BytesN<32> {
        kyc_commitment(&env, level, &salt)
    }

    /// Record a KYC commitment following off-chain document review (see
    /// `KYCSubmission` in the application database). Admin-only (issuer
    /// `ADMIN_ISSUER_ID`, one year). The event carries the hashed
    /// `kyc_submission_id` so activity can be traced to the reviewed record.
    /// Also used by the re-attestation job.
    ///
    /// Event: `(kyc, verified)` → `(user, kyc_submission_id)`.
    pub fn verify_kyc(
        env: Env,
        admin: Address,
        user: Address,
        commitment: BytesN<32>,
        kyc_submission_id: BytesN<32>,
    ) -> bool {
        let issuer = admin_issuer(&env, &admin, "Only admin can verify KYC");
        write_attestation(&env, &user, &commitment, &issuer, ONE_YEAR_SECS);
        env.events().publish(
            (symbol_short!("kyc"), symbol_short!("verified")),
            (user, kyc_submission_id),
        );
        true
    }

    /// Revoke a user's KYC attestation (and any legacy plaintext record).
    /// Admin-only. Afterwards `check_kyc` returns `false` for every opening
    /// and `get_kyc_attestation` returns `None`. To cut off every attestation
    /// from one issuer at once, use `revoke_issuer`.
    ///
    /// Event: `(kyc, revoked)` → `user`.
    pub fn revoke_kyc(env: Env, admin: Address, user: Address) {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can revoke KYC");

        let key = DataKey::Kyc(user.clone());
        let legacy = DataKey::KycAttestation(user.clone());
        let storage = env.storage().persistent();
        assert!(storage.has(&key) || storage.has(&legacy), "KYC attestation not found");
        storage.remove(&key);
        storage.remove(&legacy);
        env.events().publish((symbol_short!("kyc"), symbol_short!("revoked")), user);
    }

    /// Delete a pre-#1718 plaintext attestation for `user`. Admin-only.
    /// Returns `false` if there was nothing to delete. Ledger history still
    /// holds the old value; this only removes it from current state.
    ///
    /// Event: `(kyc, purged)` → `user`.
    pub fn purge_legacy_kyc(env: Env, admin: Address, user: Address) -> bool {
        admin.require_auth();
        let stored_admin: Address = env.storage().persistent().get(&DataKey::Admin).expect("Not initialized");
        assert_eq!(admin, stored_admin, "Only admin can purge KYC");
        let legacy = DataKey::KycAttestation(user.clone());
        if !env.storage().persistent().has(&legacy) {
            return false;
        }
        env.storage().persistent().remove(&legacy);
        env.events().publish((symbol_short!("kyc"), symbol_short!("purged")), user);
        true
    }

    /// Whether a legacy plaintext KYC record still exists for `user`.
    pub fn has_legacy_kyc(env: Env, user: Address) -> bool {
        env.storage().persistent().has(&DataKey::KycAttestation(user))
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
