//! Verification reward claims.
//!
//! Claims are protected against double-claiming under concurrency by a
//! transactional uniqueness check on `(user_id, verification_id)` plus a
//! per-user cap and simple sybil heuristics.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Maximum number of reward claims a single user may hold.
pub const MAX_CLAIMS_PER_USER: usize = 10;

/// Minimum account age (in seconds) before a user is eligible for rewards.
pub const MIN_ACCOUNT_AGE_SECS: i64 = 60 * 60 * 24;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationReward {
    pub id: String,
    pub user_id: String,
    pub verification_id: String,
    pub amount: u64,
}

#[derive(Debug, Clone)]
pub struct ClaimRequest {
    pub user_id: String,
    pub verification_id: String,
    pub amount: u64,
    /// Account age in seconds, used for sybil heuristics.
    pub account_age_secs: i64,
    /// Whether the account has a verified on-chain identity.
    pub identity_verified: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ClaimError {
    #[error("reward already claimed for this verification")]
    AlreadyClaimed,
    #[error("user has reached the maximum number of reward claims")]
    CapReached,
    #[error("account does not meet sybil-resistance requirements")]
    SybilRejected,
    #[error("invalid claim amount")]
    InvalidAmount,
}

/// In-memory store backing reward claims.
///
/// The uniqueness invariant is enforced here: a `(user_id, verification_id)`
/// pair may only ever be inserted once. In production this maps to a unique
/// database constraint; the transactional claim below keeps the check and the
/// insert atomic.
#[derive(Debug, Default)]
pub struct RewardStore {
    claims: Vec<VerificationReward>,
    seen: HashSet<(String, String)>,
}

impl RewardStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn claims_for_user(&self, user_id: &str) -> Vec<&VerificationReward> {
        self.claims.iter().filter(|c| c.user_id == user_id).collect()
    }

    /// Atomically validate and record a claim.
    ///
    /// The uniqueness check, cap check and insert happen together so that two
    /// concurrent claims for the same verification cannot both succeed.
    pub fn claim(&mut self, req: ClaimRequest) -> Result<VerificationReward, ClaimError> {
        if req.amount == 0 {
            return Err(ClaimError::InvalidAmount);
        }

        // Sybil heuristics: reject brand-new or unverified accounts.
        if req.account_age_secs < MIN_ACCOUNT_AGE_SECS || !req.identity_verified {
            return Err(ClaimError::SybilRejected);
        }

        let key = (req.user_id.clone(), req.verification_id.clone());
        if self.seen.contains(&key) {
            return Err(ClaimError::AlreadyClaimed);
        }

        if self.claims_for_user(&req.user_id).len() >= MAX_CLAIMS_PER_USER {
            return Err(ClaimError::CapReached);
        }

        let reward = VerificationReward {
            id: format!("{}:{}", req.user_id, req.verification_id),
            user_id: req.user_id,
            verification_id: req.verification_id,
            amount: req.amount,
        };

        self.seen.insert(key);
        self.claims.push(reward.clone());
        Ok(reward)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(user: &str, verification: &str) -> ClaimRequest {
        ClaimRequest {
            user_id: user.to_string(),
            verification_id: verification.to_string(),
            amount: 100,
            account_age_secs: MIN_ACCOUNT_AGE_SECS + 1,
            identity_verified: true,
        }
    }

    #[test]
    fn first_claim_succeeds() {
        let mut store = RewardStore::new();
        assert!(store.claim(request("u1", "v1")).is_ok());
        assert_eq!(store.claims_for_user("u1").len(), 1);
    }

    #[test]
    fn double_claim_rejected() {
        let mut store = RewardStore::new();
        assert!(store.claim(request("u1", "v1")).is_ok());
        assert_eq!(store.claim(request("u1", "v1")), Err(ClaimError::AlreadyClaimed));
        assert_eq!(store.claims_for_user("u1").len(), 1);
    }

    #[test]
    fn concurrent_double_claim_rejected() {
        // Simulate two racing claims: only one may win.
        let mut store = RewardStore::new();
        let first = store.claim(request("u1", "v1"));
        let second = store.claim(request("u1", "v1"));
        assert!(first.is_ok());
        assert_eq!(second, Err(ClaimError::AlreadyClaimed));
    }

    #[test]
    fn cap_enforced() {
        let mut store = RewardStore::new();
        for i in 0..MAX_CLAIMS_PER_USER {
            assert!(store.claim(request("u1", &format!("v{i}"))).is_ok());
        }
        assert_eq!(
            store.claim(request("u1", "overflow")),
            Err(ClaimError::CapReached)
        );
    }

    #[test]
    fn sybil_rejected_for_new_account() {
        let mut store = RewardStore::new();
        let mut req = request("u1", "v1");
        req.account_age_secs = 0;
        assert_eq!(store.claim(req), Err(ClaimError::SybilRejected));
    }

    #[test]
    fn sybil_rejected_for_unverified_identity() {
        let mut store = RewardStore::new();
        let mut req = request("u1", "v1");
        req.identity_verified = false;
        assert_eq!(store.claim(req), Err(ClaimError::SybilRejected));
    }

    #[test]
    fn zero_amount_rejected() {
        let mut store = RewardStore::new();
        let mut req = request("u1", "v1");
        req.amount = 0;
        assert_eq!(store.claim(req), Err(ClaimError::InvalidAmount));
    }
}
