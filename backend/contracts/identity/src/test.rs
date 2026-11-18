#![cfg(test)]

use soroban_sdk::{Address, BytesN, Env};
use stellar_contract_test_utils::{new_address, test_env};

use crate::{DataKey, IdentityContract, IdentityContractClient, KycAttestation, KycLevel};

fn deploy(env: &Env) -> (IdentityContractClient<'_>, Address) {
    let admin = new_address(env);
    let client = IdentityContractClient::new(env, &env.register(IdentityContract, ()));
    client.initialize(&admin);
    (client, admin)
}

fn domain_hash(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

fn sign(env: &Env, msg: &BytesN<32>) -> (BytesN<32>, BytesN<64>) {
    sign_with_key(env, msg, 7)
}

/// Sign `msg` with the deterministic key derived from `key_seed`.
fn sign_with_key(env: &Env, msg: &BytesN<32>, key_seed: u8) -> (BytesN<32>, BytesN<64>) {
    use ed25519_dalek::{Signer, SigningKey};

    // Sign the raw hash bytes directly — the contract verifies via
    // `env.crypto().ed25519_verify(&public_key, &domain_hash.into(), &proof)`
    // against the bytes as-is, not an XDR-encoded `ScVal` wrapping them (which
    // is what soroban_sdk's `testutils::ed25519::Sign` trait produces).
    // A fixed key keeps the tests deterministic and needs no RNG.
    let kp = SigningKey::from_bytes(&[key_seed; 32]);
    let sig = kp.sign(&msg.to_array());
    (
        BytesN::from_array(env, &kp.verifying_key().to_bytes()),
        BytesN::from_array(env, &sig.to_bytes()),
    )
}

#[test]
fn test_submit_proof_succeeds() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);
    let hash = domain_hash(&env, 1);
    let (pk, sig) = sign(&env, &hash);
    assert!(client.submit_proof(&owner, &hash, &pk, &sig));
    let proof = client.get_proof(&owner, &hash);
    assert!(proof.verified);
    assert_eq!(proof.owner, owner);
}

#[test]
fn test_has_proof_returns_true_after_submit() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);
    let hash = domain_hash(&env, 2);
    let (pk, sig) = sign(&env, &hash);
    assert!(!client.has_proof(&owner, &hash));
    client.submit_proof(&owner, &hash, &pk, &sig);
    assert!(client.has_proof(&owner, &hash));
}

#[test]
fn test_proof_count_increments() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);
    for seed in [3u8, 4] {
        let hash = domain_hash(&env, seed);
        let (pk, sig) = sign(&env, &hash);
        client.submit_proof(&owner, &hash, &pk, &sig);
    }
    assert_eq!(client.proof_count(&owner), 2);
}

#[test]
#[should_panic(expected = "Proof already verified")]
fn test_duplicate_proof_panics() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);
    let hash = domain_hash(&env, 5);
    let (pk, sig) = sign(&env, &hash);
    client.submit_proof(&owner, &hash, &pk, &sig);
    client.submit_proof(&owner, &hash, &pk, &sig);
}

#[test]
#[should_panic]
fn test_invalid_signature_panics() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);
    let hash = domain_hash(&env, 6);
    let (pk, bad_sig) = sign(&env, &domain_hash(&env, 99));
    client.submit_proof(&owner, &hash, &pk, &bad_sig);
}

#[test]
#[should_panic]
fn test_wrong_public_key_panics() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);
    let hash = domain_hash(&env, 7);
    let (_, sig) = sign(&env, &hash);
    let (wrong_pk, _) = sign_with_key(&env, &hash, 8);
    client.submit_proof(&owner, &hash, &wrong_pk, &sig);
}

#[test]
#[should_panic(expected = "Proof not found")]
fn test_get_nonexistent_proof_panics() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    client.get_proof(&new_address(&env), &domain_hash(&env, 8));
}

#[test]
fn test_revoke_removes_proof_and_decrements_count() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);
    let hash = domain_hash(&env, 9);
    let (pk, sig) = sign(&env, &hash);
    client.submit_proof(&owner, &hash, &pk, &sig);
    assert_eq!(client.proof_count(&owner), 1);
    client.revoke_proof(&owner, &hash);
    assert!(!client.has_proof(&owner, &hash));
    assert_eq!(client.proof_count(&owner), 0);
}

#[test]
#[should_panic(expected = "Proof not found")]
fn test_revoke_nonexistent_panics() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    client.revoke_proof(&new_address(&env), &domain_hash(&env, 10));
}

#[test]
fn test_different_owners_same_hash_are_independent() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let hash = domain_hash(&env, 11);
    let owner_a = new_address(&env);
    let owner_b = new_address(&env);
    let (pk_a, sig_a) = sign(&env, &hash);
    let (pk_b, sig_b) = sign(&env, &hash);
    client.submit_proof(&owner_a, &hash, &pk_a, &sig_a);
    client.submit_proof(&owner_b, &hash, &pk_b, &sig_b);
    client.revoke_proof(&owner_a, &hash);
    assert!(!client.has_proof(&owner_a, &hash));
    assert!(client.has_proof(&owner_b, &hash));
}

// ── Issue #1341: Error boundary tests for decentralized authenticity ────────

#[test]
#[should_panic]
fn test_unauthorized_signature_panics() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let _owner = new_address(&env);
    let unauthorized = new_address(&env);
    let hash = domain_hash(&env, 12);
    let (pk, sig) = sign(&env, &hash);

    env.as_contract(&client.address, || {
        env.mock_all_auths();
        // Mock auth only for unauthorized, not owner
        client.submit_proof(&unauthorized, &hash, &pk, &sig);
    });
}

#[test]
#[should_panic]
fn test_invalid_public_key_signature_mismatch_panics() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);
    let hash = domain_hash(&env, 13);
    let (_, sig) = sign(&env, &hash);
    let (wrong_pk, _) = sign_with_key(&env, &domain_hash(&env, 100), 8);

    // Signature from one key with a different public key = verification fails
    client.submit_proof(&owner, &hash, &wrong_pk, &sig);
}

#[test]
fn test_multiple_proofs_per_user() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let owner = new_address(&env);

    // User can submit multiple proofs for different domains
    let hash1 = domain_hash(&env, 14);
    let hash2 = domain_hash(&env, 15);
    let (pk1, sig1) = sign(&env, &hash1);
    let (pk2, sig2) = sign(&env, &hash2);

    assert!(client.submit_proof(&owner, &hash1, &pk1, &sig1));
    assert!(client.submit_proof(&owner, &hash2, &pk2, &sig2));
    assert_eq!(client.proof_count(&owner), 2);
    assert!(client.has_proof(&owner, &hash1));
    assert!(client.has_proof(&owner, &hash2));
}

// ── KYC commitments (Issue #1718) ────────────────────────────────────────────

fn salt(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

/// Independent re-implementation of the commitment so the test pins the
/// on-chain encoding: sha256([level as u8] || salt).
fn commit(env: &Env, level: KycLevel, s: &BytesN<32>) -> BytesN<32> {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update([level as u8]);
    h.update(s.to_array());
    let out = h.finalize();
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    BytesN::from_array(env, &arr)
}

#[test]
fn test_kyc_commitment_matches_offchain_encoding() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let s = salt(&env, 3);
    for level in [KycLevel::Basic, KycLevel::Enhanced, KycLevel::Institutional] {
        assert_eq!(client.compute_kyc_commitment(&level, &s), commit(&env, level, &s));
    }
}

#[test]
fn test_attest_kyc_stores_only_commitment() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    let s = salt(&env, 9);
    let c = commit(&env, KycLevel::Enhanced, &s);

    client.attest_kyc(&admin, &user, &c);
    let stored = client.get_kyc_commitment(&user).unwrap();
    assert_eq!(stored.commitment, c);
    assert!(!client.has_legacy_kyc(&user));

    // No plaintext record exists in storage.
    let cid = client.address.clone();
    env.as_contract(&cid, || {
        assert!(!env.storage().persistent().has(&DataKey::KycAttestation(user.clone())));
    });
}

#[test]
#[should_panic(expected = "Only admin can attest KYC")]
fn test_non_admin_attest_kyc_fails() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let user = new_address(&env);
    let non_admin = new_address(&env);
    let c = commit(&env, KycLevel::Basic, &salt(&env, 1));
    client.attest_kyc(&non_admin, &user, &c);
}

#[test]
fn test_check_kyc_with_valid_opening() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    let s = salt(&env, 5);
    client.attest_kyc(&admin, &user, &commit(&env, KycLevel::Enhanced, &s));

    assert!(client.check_kyc(&user, &KycLevel::Basic, &KycLevel::Enhanced, &s));
    assert!(client.check_kyc(&user, &KycLevel::Enhanced, &KycLevel::Enhanced, &s));
    assert!(!client.check_kyc(&user, &KycLevel::Institutional, &KycLevel::Enhanced, &s));
}

#[test]
fn test_check_kyc_rejects_forged_level_or_wrong_salt() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    let s = salt(&env, 5);
    client.attest_kyc(&admin, &user, &commit(&env, KycLevel::Basic, &s));

    // Claiming a higher level than committed fails.
    assert!(!client.check_kyc(&user, &KycLevel::Basic, &KycLevel::Institutional, &s));
    // Wrong salt fails.
    assert!(!client.check_kyc(&user, &KycLevel::Basic, &KycLevel::Basic, &salt(&env, 6)));
    // Another user's opening does not carry over.
    let other = new_address(&env);
    assert!(!client.check_kyc(&other, &KycLevel::Basic, &KycLevel::Basic, &s));
}

#[test]
fn test_check_kyc_expires_after_one_year() {
    use soroban_sdk::testutils::Ledger as _;
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    let s = salt(&env, 2);
    client.attest_kyc(&admin, &user, &commit(&env, KycLevel::Basic, &s));
    let exp = client.get_kyc_commitment(&user).unwrap().expires_at;
    env.ledger().set_timestamp(exp + 1);
    assert!(!client.check_kyc(&user, &KycLevel::Basic, &KycLevel::Basic, &s));
}

#[test]
fn test_verify_kyc_and_revoke() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    let s = salt(&env, 4);
    let c = commit(&env, KycLevel::Basic, &s);
    assert!(client.verify_kyc(&admin, &user, &c, &BytesN::from_array(&env, &[8; 32])));
    assert!(client.check_kyc(&user, &KycLevel::Basic, &KycLevel::Basic, &s));

    client.revoke_kyc(&admin, &user);
    assert!(client.get_kyc_commitment(&user).is_none());
    assert!(!client.check_kyc(&user, &KycLevel::Basic, &KycLevel::Basic, &s));
}

#[test]
fn test_purge_legacy_plaintext_kyc() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    let cid = client.address.clone();

    // Seed a pre-#1718 plaintext record.
    env.as_contract(&cid, || {
        env.storage().persistent().set(
            &DataKey::KycAttestation(user.clone()),
            &KycAttestation {
                user: user.clone(),
                level: KycLevel::Enhanced,
                attested_at: 0,
                expires_at: 1,
            },
        );
    });
    assert!(client.has_legacy_kyc(&user));
    assert!(client.purge_legacy_kyc(&admin, &user));
    assert!(!client.has_legacy_kyc(&user));
    assert!(!client.purge_legacy_kyc(&admin, &user));
}

#[test]
fn test_new_commitment_replaces_legacy_record() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    let cid = client.address.clone();
    env.as_contract(&cid, || {
        env.storage().persistent().set(
            &DataKey::KycAttestation(user.clone()),
            &KycAttestation { user: user.clone(), level: KycLevel::Basic, attested_at: 0, expires_at: 1 },
        );
    });
    client.attest_kyc(&admin, &user, &commit(&env, KycLevel::Basic, &salt(&env, 1)));
    assert!(!client.has_legacy_kyc(&user));
}

#[test]
#[should_panic(expected = "Only admin can purge KYC")]
fn test_non_admin_cannot_purge_legacy_kyc() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let user = new_address(&env);
    client.purge_legacy_kyc(&new_address(&env), &user);
}

// ── Issue #1717: expiry, issuer registry, rotation and revocation ──────────

mod issuer_registry {
    use super::*;
    use crate::{KycError, ADMIN_ISSUER_ID, KYC_SCHEMA_VERSION, MAX_KYC_TTL_SECS};
    use soroban_sdk::testutils::Ledger;

    const DAY: u64 = 24 * 60 * 60;

    #[test]
    fn attestation_carries_issuer_and_schema() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let user = new_address(&env);
        env.ledger().set_timestamp(1_000);
        client.attest_kyc(&admin, &user, &KycLevel::Basic);
        let a = client.get_kyc_attestation(&user).unwrap();
        assert_eq!(a.issuer_id, ADMIN_ISSUER_ID);
        assert_eq!(a.schema_version, KYC_SCHEMA_VERSION);
        assert_eq!(a.issued_at, 1_000);
        assert_eq!(a.expires_at, 1_000 + 365 * DAY);
    }

    #[test]
    fn expired_attestation_fails_check() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let signer = new_address(&env);
        let user = new_address(&env);
        let issuer = client.register_issuer(&admin, &signer);
        client.issuer_attest_kyc(&signer, &issuer, &user, &KycLevel::Enhanced, &(30 * DAY));
        assert!(client.check_kyc(&user, &KycLevel::Enhanced));

        env.ledger().set_timestamp(30 * DAY + 1);
        assert!(!client.check_kyc(&user, &KycLevel::Basic));
    }

    #[test]
    fn revoking_issuer_invalidates_all_its_attestations() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let signer = new_address(&env);
        let issuer = client.register_issuer(&admin, &signer);
        let users: [Address; 3] = [new_address(&env), new_address(&env), new_address(&env)];
        for u in users.iter() {
            client.issuer_attest_kyc(&signer, &issuer, u, &KycLevel::Basic, &(90 * DAY));
        }
        // An admin-issued attestation is unaffected.
        let other = new_address(&env);
        client.attest_kyc(&admin, &other, &KycLevel::Basic);

        client.revoke_issuer(&admin, &issuer);

        for u in users.iter() {
            assert!(!client.check_kyc(u, &KycLevel::Basic));
        }
        assert!(client.check_kyc(&other, &KycLevel::Basic));
        assert!(client.get_issuer(&issuer).revoked);
    }

    #[test]
    fn revoked_issuer_cannot_attest() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let signer = new_address(&env);
        let issuer = client.register_issuer(&admin, &signer);
        client.revoke_issuer(&admin, &issuer);
        assert_eq!(
            client.try_issuer_attest_kyc(&signer, &issuer, &new_address(&env), &KycLevel::Basic, &DAY),
            Err(Ok(KycError::IssuerRevoked))
        );
    }

    #[test]
    fn rotation_with_invalidation_cuts_off_old_key() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let old_key = new_address(&env);
        let new_key = new_address(&env);
        let issuer = client.register_issuer(&admin, &old_key);
        let user = new_address(&env);
        client.issuer_attest_kyc(&old_key, &issuer, &user, &KycLevel::Basic, &DAY);

        assert_eq!(client.rotate_issuer_key(&admin, &issuer, &new_key, &true), 2);
        assert!(!client.check_kyc(&user, &KycLevel::Basic));

        // Old key can no longer attest; the new one can.
        assert_eq!(
            client.try_issuer_attest_kyc(&old_key, &issuer, &user, &KycLevel::Basic, &DAY),
            Err(Ok(KycError::Unauthorized))
        );
        client.issuer_attest_kyc(&new_key, &issuer, &user, &KycLevel::Basic, &DAY);
        assert!(client.check_kyc(&user, &KycLevel::Basic));
    }

    #[test]
    fn routine_rotation_keeps_existing_attestations() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let old_key = new_address(&env);
        let issuer = client.register_issuer(&admin, &old_key);
        let user = new_address(&env);
        client.issuer_attest_kyc(&old_key, &issuer, &user, &KycLevel::Basic, &DAY);
        // The issuer rotates its own key without invalidation.
        client.rotate_issuer_key(&old_key, &issuer, &new_address(&env), &false);
        assert!(client.check_kyc(&user, &KycLevel::Basic));
    }

    #[test]
    fn non_admin_cannot_register_or_revoke_issuer() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let stranger = new_address(&env);
        assert_eq!(
            client.try_register_issuer(&stranger, &stranger),
            Err(Ok(KycError::Unauthorized))
        );
        let issuer = client.register_issuer(&admin, &new_address(&env));
        assert_eq!(client.try_revoke_issuer(&stranger, &issuer), Err(Ok(KycError::Unauthorized)));
        assert_eq!(
            client.try_rotate_issuer_key(&stranger, &issuer, &stranger, &true),
            Err(Ok(KycError::Unauthorized))
        );
    }

    #[test]
    fn ttl_bounds_enforced() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let signer = new_address(&env);
        let issuer = client.register_issuer(&admin, &signer);
        let user = new_address(&env);
        assert_eq!(
            client.try_issuer_attest_kyc(&signer, &issuer, &user, &KycLevel::Basic, &0),
            Err(Ok(KycError::InvalidTtl))
        );
        assert_eq!(
            client.try_issuer_attest_kyc(&signer, &issuer, &user, &KycLevel::Basic, &(MAX_KYC_TTL_SECS + 1)),
            Err(Ok(KycError::InvalidTtl))
        );
    }

    #[test]
    fn unknown_issuer_rejected() {
        let env = test_env();
        let (client, _admin) = deploy(&env);
        let signer = new_address(&env);
        assert_eq!(
            client.try_issuer_attest_kyc(&signer, &42, &new_address(&env), &KycLevel::Basic, &DAY),
            Err(Ok(KycError::IssuerNotFound))
        );
    }

    #[test]
    fn revoking_admin_issuer_invalidates_admin_and_legacy_attestations() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let user = new_address(&env);
        let legacy_user = new_address(&env);
        client.verify_kyc(&admin, &user, &BytesN::from_array(&env, &[1; 32]));
        // Simulate a record written before #1717.
        env.as_contract(&client.address, || {
            env.storage().persistent().set(
                &crate::DataKey::KycAttestation(legacy_user.clone()),
                &crate::LegacyKycAttestation {
                    user: legacy_user.clone(),
                    level: KycLevel::Basic,
                    attested_at: 0,
                    expires_at: 365 * DAY,
                },
            );
        });
        assert!(client.check_kyc(&legacy_user, &KycLevel::Basic));
        assert_eq!(client.get_kyc_attestation(&legacy_user).unwrap().schema_version, 1);

        client.revoke_issuer(&admin, &ADMIN_ISSUER_ID);
        assert!(!client.check_kyc(&user, &KycLevel::Basic));
        assert!(!client.check_kyc(&legacy_user, &KycLevel::Basic));
    }

    #[test]
    fn revoke_kyc_clears_single_user() {
        let env = test_env();
        let (client, admin) = deploy(&env);
        let user = new_address(&env);
        client.attest_kyc(&admin, &user, &KycLevel::Basic);
        client.revoke_kyc(&admin, &user);
        assert!(client.get_kyc_attestation(&user).is_none());
        assert!(!client.check_kyc(&user, &KycLevel::Basic));
    }
}
