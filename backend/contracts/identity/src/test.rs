#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

use crate::{IdentityContract, IdentityContractClient};

fn deploy(env: &Env) -> IdentityContractClient {
    IdentityContractClient::new(env, &env.register(IdentityContract, ()))
}

fn domain_hash(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

fn sign(env: &Env, msg: &BytesN<32>) -> (BytesN<32>, BytesN<64>) {
    use soroban_sdk::testutils::ed25519::Sign;
    let kp = soroban_sdk::testutils::ed25519::generate(env);
    let sig = kp.sign(msg.clone().into());
    (kp.public_key(), sig)
}

#[test]
fn test_submit_proof_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let owner = Address::generate(&env);
    let hash = domain_hash(&env, 1);
    let (pk, sig) = sign(&env, &hash);
    assert!(client.submit_proof(&owner, &hash, &pk, &sig));
    let proof = client.get_proof(&owner, &hash);
    assert!(proof.verified);
    assert_eq!(proof.owner, owner);
}

#[test]
fn test_has_proof_returns_true_after_submit() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let owner = Address::generate(&env);
    let hash = domain_hash(&env, 2);
    let (pk, sig) = sign(&env, &hash);
    assert!(!client.has_proof(&owner, &hash));
    client.submit_proof(&owner, &hash, &pk, &sig);
    assert!(client.has_proof(&owner, &hash));
}

#[test]
fn test_proof_count_increments() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let owner = Address::generate(&env);
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
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let owner = Address::generate(&env);
    let hash = domain_hash(&env, 5);
    let (pk, sig) = sign(&env, &hash);
    client.submit_proof(&owner, &hash, &pk, &sig);
    client.submit_proof(&owner, &hash, &pk, &sig);
}

#[test]
#[should_panic]
fn test_invalid_signature_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let owner = Address::generate(&env);
    let hash = domain_hash(&env, 6);
    let (pk, bad_sig) = sign(&env, &domain_hash(&env, 99));
    client.submit_proof(&owner, &hash, &pk, &bad_sig);
}

#[test]
#[should_panic]
fn test_wrong_public_key_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let owner = Address::generate(&env);
    let hash = domain_hash(&env, 7);
    let (_, sig) = sign(&env, &hash);
    let (wrong_pk, _) = sign(&env, &hash);
    client.submit_proof(&owner, &hash, &wrong_pk, &sig);
}

#[test]
#[should_panic(expected = "Proof not found")]
fn test_get_nonexistent_proof_panics() {
    let env = Env::default();
    let client = deploy(&env);
    client.get_proof(&Address::generate(&env), &domain_hash(&env, 8));
}

#[test]
fn test_revoke_removes_proof_and_decrements_count() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let owner = Address::generate(&env);
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
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    client.revoke_proof(&Address::generate(&env), &domain_hash(&env, 10));
}

#[test]
fn test_different_owners_same_hash_are_independent() {
    let env = Env::default();
    env.mock_all_auths();
    let client = deploy(&env);
    let hash = domain_hash(&env, 11);
    let owner_a = Address::generate(&env);
    let owner_b = Address::generate(&env);
    let (pk_a, sig_a) = sign(&env, &hash);
    let (pk_b, sig_b) = sign(&env, &hash);
    client.submit_proof(&owner_a, &hash, &pk_a, &sig_a);
    client.submit_proof(&owner_b, &hash, &pk_b, &sig_b);
    client.revoke_proof(&owner_a, &hash);
    assert!(!client.has_proof(&owner_a, &hash));
    assert!(client.has_proof(&owner_b, &hash));
}
