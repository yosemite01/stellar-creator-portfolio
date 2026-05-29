#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
};

#[contracttype]
#[derive(Clone)]
pub struct SocialProof {
    pub owner: Address,
    pub domain_hash: BytesN<32>,
    pub proof: BytesN<64>,
    pub verified: bool,
    pub submitted_at: u64,
}

#[contracttype]
pub enum DataKey {
    Proof(Address, BytesN<32>),
    ProofCount(Address),
}

#[contract]
pub struct IdentityContract;

#[contractimpl]
impl IdentityContract {
    /// Submit a cryptographic proof linking an address to a social domain.
    /// Verifies the Ed25519 signature of `domain_hash` under `public_key`
    /// natively via `env.crypto().ed25519_verify`.
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
}

#[cfg(test)]
mod test;
