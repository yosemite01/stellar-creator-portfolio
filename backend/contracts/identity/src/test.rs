#![cfg(test)]

use soroban_sdk::{Address, BytesN, Env};
use stellar_contract_test_utils::{new_address, test_env};

use crate::{IdentityContract, IdentityContractClient, KycLevel};

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

#[test]
fn test_kyc_attestation_by_admin_only() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);

    // Admin can attest
    client.attest_kyc(&admin, &user, &KycLevel::Enhanced);
    let att = client.get_kyc_attestation(&user);
    assert!(att.is_some());
    assert_eq!(att.unwrap().level, KycLevel::Enhanced);
}

#[test]
#[should_panic(expected = "Only admin can attest KYC")]
fn test_non_admin_attest_kyc_fails() {
    let env = test_env();
    let (client, _admin) = deploy(&env);
    let user = new_address(&env);
    let non_admin = new_address(&env);

    // Non-admin cannot attest
    client.attest_kyc(&non_admin, &user, &KycLevel::Basic);
}

#[test]
fn test_attest_kyc_succeeds() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    client.attest_kyc(&admin, &user, &KycLevel::Basic);
    let attestation = client.get_kyc_attestation(&user).unwrap();
    assert_eq!(attestation.user, user);
    assert_eq!(attestation.level, KycLevel::Basic);
}

#[test]
fn test_check_kyc_succeeds() {
    let env = test_env();
    let (client, admin) = deploy(&env);
    let user = new_address(&env);
    client.attest_kyc(&admin, &user, &KycLevel::Enhanced);
    assert!(client.check_kyc(&user, &KycLevel::Basic));
    assert!(client.check_kyc(&user, &KycLevel::Enhanced));
    assert!(!client.check_kyc(&user, &KycLevel::Institutional));
}
