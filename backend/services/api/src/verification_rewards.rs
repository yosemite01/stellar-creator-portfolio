use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Debug, Error, PartialEq, Clone)]
pub enum RewardError {
    #[error("Double claim rejected: claim '{0}' already processed or in progress")]
    DoubleClaim(String),

    #[error("Reward cap exceeded: {0}")]
    CapExceeded(String),

    #[error("Sybil heuristic violation: {0}")]
    SybilDetected(String),

    #[error("Invalid recipient address: {0}")]
    InvalidRecipient(String),

    #[error("Invalid reward amount: {0}")]
    InvalidAmount(String),

    #[error("Payment failed: {0}")]
    PaymentFailed(String),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct RewardCalculation {
    pub recipient: String,
    pub amount: i128,
    pub reason: String,
    #[serde(default)]
    pub claim_id: Option<String>,
}

#[allow(dead_code)]
impl RewardCalculation {
    pub fn new(recipient: impl Into<String>, amount: i128, reason: impl Into<String>) -> Self {
        Self {
            recipient: recipient.into(),
            amount,
            reason: reason.into(),
            claim_id: None,
        }
    }

    pub fn with_claim_id(
        claim_id: impl Into<String>,
        recipient: impl Into<String>,
        amount: i128,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            recipient: recipient.into(),
            amount,
            reason: reason.into(),
            claim_id: Some(claim_id.into()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)]
pub enum PaymentStatus {
    Success,
    Failed,
    Pending,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct PaymentResult {
    pub transaction_id: String,
    pub recipient: String,
    pub amount: i128,
    pub status: PaymentStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[allow(dead_code)]
pub enum ClaimStatus {
    Pending,
    Success,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ClaimRecord {
    pub claim_id: String,
    pub recipient: String,
    pub amount: i128,
    pub status: ClaimStatus,
    pub transaction_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub failure_reason: Option<String>,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct RewardCaps {
    /// Maximum stroops allowed in a single claim
    pub max_per_claim: i128,
    /// Maximum cumulative stroops a single recipient can claim across all claims
    pub max_per_recipient: i128,
    /// Maximum total payout across the entire service
    pub global_pool_budget: i128,
}

impl Default for RewardCaps {
    fn default() -> Self {
        Self {
            max_per_claim: 50_000,
            max_per_recipient: 250_000,
            global_pool_budget: 10_000_000,
        }
    }
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct SybilConfig {
    /// Minimum time required between consecutive claims by the same recipient (in seconds)
    pub min_cooldown_seconds: i64,
    /// Max claims allowed in the rate limit window
    pub max_claims_per_window: usize,
    /// Window duration in seconds
    pub window_duration_seconds: i64,
}

impl Default for SybilConfig {
    fn default() -> Self {
        Self {
            min_cooldown_seconds: 60,
            max_claims_per_window: 5,
            window_duration_seconds: 3600,
        }
    }
}

#[derive(Default, Debug)]
struct LedgerState {
    claims: HashMap<String, ClaimRecord>,
    recipient_payouts: HashMap<String, i128>,
    recipient_claim_history: HashMap<String, Vec<DateTime<Utc>>>,
    total_disbursed: i128,
}

#[allow(dead_code)]
pub struct VerificationRewardsService {
    stellar_rpc_url: String,
    max_retries: u32,
    caps: RewardCaps,
    sybil_config: SybilConfig,
    state: Arc<Mutex<LedgerState>>,
}

#[allow(dead_code)]
impl VerificationRewardsService {
    pub fn new(stellar_rpc_url: String) -> Self {
        Self::with_config(
            stellar_rpc_url,
            RewardCaps::default(),
            SybilConfig::default(),
        )
    }

    pub fn with_config(
        stellar_rpc_url: String,
        caps: RewardCaps,
        sybil_config: SybilConfig,
    ) -> Self {
        Self {
            stellar_rpc_url,
            max_retries: 3,
            caps,
            sybil_config,
            state: Arc::new(Mutex::new(LedgerState::default())),
        }
    }

    pub fn with_caps(mut self, caps: RewardCaps) -> Self {
        self.caps = caps;
        self
    }

    pub fn with_sybil_config(mut self, config: SybilConfig) -> Self {
        self.sybil_config = config;
        self
    }

    pub fn with_max_retries(mut self, retries: u32) -> Self {
        self.max_retries = retries;
        self
    }

    /// Validate recipient format
    pub fn validate_recipient(recipient: &str) -> Result<(), RewardError> {
        if recipient.is_empty() {
            return Err(RewardError::InvalidRecipient(
                "Recipient address cannot be empty".to_string(),
            ));
        }

        // Stellar public key addresses: starts with 'G', 56 alphanumeric chars (Base32: A-Z, 2-7)
        if recipient.starts_with('G') && recipient.len() == 56 {
            let is_valid_base32 = recipient
                .chars()
                .all(|c| matches!(c, 'A'..='Z' | '2'..='7'));
            if is_valid_base32 {
                return Ok(());
            } else {
                return Err(RewardError::InvalidRecipient(format!(
                    "Stellar address '{}' contains invalid characters for base32 encoding",
                    recipient
                )));
            }
        }

        // If it starts with 'G' and contains only uppercase letters and digits, but len != 56, it's an invalid Stellar key
        if recipient.starts_with('G')
            && recipient
                .chars()
                .all(|c| matches!(c, 'A'..='Z' | '0'..='9'))
        {
            return Err(RewardError::InvalidRecipient(format!(
                "Stellar address '{}' must be exactly 56 characters long (got {})",
                recipient,
                recipient.len()
            )));
        }

        // Internal pools, test recipients, or named accounts: alphanumeric + underscores/hyphens, length 3..=64
        if recipient.len() >= 3
            && recipient.len() <= 64
            && recipient
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Ok(());
        }

        Err(RewardError::InvalidRecipient(format!(
            "Recipient '{}' is neither a valid 56-character Stellar public key (G...) nor a valid account identifier",
            recipient
        )))
    }

    /// Calculate rewards for verified contributors
    pub fn calculate_rewards(&self, verified_count: u32) -> Vec<RewardCalculation> {
        let base_reward = 100i128; // Base reward per verification
        let bonus_threshold = 10u32;
        let bonus_multiplier = 1.5;

        let mut rewards = Vec::new();

        if verified_count > 0 {
            let per_contributor = verified_count as i128;
            let mut amount = base_reward * per_contributor;

            if verified_count >= bonus_threshold {
                amount = (amount as f64 * bonus_multiplier) as i128;
            }

            let claim_id = format!("pool_verification_{}_{}", verified_count, Uuid::new_v4());

            rewards.push(RewardCalculation {
                recipient: "verified_pool".to_string(),
                amount,
                reason: format!("Verification rewards for {} contributors", verified_count),
                claim_id: Some(claim_id),
            });
        }

        rewards
    }

    /// Claim a reward transactionally with double-claim protection, caps, and Sybil heuristics
    pub async fn claim_reward(
        &self,
        claim_id: &str,
        recipient: &str,
        amount: i128,
        reason: &str,
    ) -> Result<PaymentResult, RewardError> {
        let reward = RewardCalculation::with_claim_id(claim_id, recipient, amount, reason);
        self.execute_claim(reward).await
    }

    /// Execute a reward claim transactionally
    pub async fn execute_claim(
        &self,
        reward: RewardCalculation,
    ) -> Result<PaymentResult, RewardError> {
        Self::validate_recipient(&reward.recipient)?;

        if reward.amount <= 0 {
            return Err(RewardError::InvalidAmount(format!(
                "Reward amount must be positive, got {}",
                reward.amount
            )));
        }

        let claim_id = reward
            .claim_id
            .clone()
            .unwrap_or_else(|| format!("claim_{}_{}", reward.recipient, Uuid::new_v4()));

        let now = Utc::now();

        // 1. Transactional uniqueness and reservation under lock
        {
            let mut state = self.state.lock().await;

            // Unique constraint check
            if let Some(existing) = state.claims.get(&claim_id) {
                return match existing.status {
                    ClaimStatus::Success => Err(RewardError::DoubleClaim(format!(
                        "Claim '{}' has already been successfully processed",
                        claim_id
                    ))),
                    ClaimStatus::Pending => Err(RewardError::DoubleClaim(format!(
                        "Claim '{}' is currently pending execution",
                        claim_id
                    ))),
                    ClaimStatus::Failed => Err(RewardError::DoubleClaim(format!(
                        "Claim '{}' previously failed and cannot be re-claimed with the same ID",
                        claim_id
                    ))),
                };
            }

            // Cap checks
            if reward.amount > self.caps.max_per_claim {
                return Err(RewardError::CapExceeded(format!(
                    "Claim amount {} exceeds maximum per-claim cap of {}",
                    reward.amount, self.caps.max_per_claim
                )));
            }

            let recipient_total = state
                .recipient_payouts
                .get(&reward.recipient)
                .copied()
                .unwrap_or(0);
            if recipient_total + reward.amount > self.caps.max_per_recipient {
                return Err(RewardError::CapExceeded(format!(
                    "Cumulative payout {} for recipient '{}' exceeds maximum lifetime cap of {}",
                    recipient_total + reward.amount,
                    reward.recipient,
                    self.caps.max_per_recipient
                )));
            }

            if state.total_disbursed + reward.amount > self.caps.global_pool_budget {
                return Err(RewardError::CapExceeded(format!(
                    "Total disbursement {} exceeds global pool budget cap of {}",
                    state.total_disbursed + reward.amount,
                    self.caps.global_pool_budget
                )));
            }

            // Sybil heuristics
            if let Some(history) = state.recipient_claim_history.get_mut(&reward.recipient) {
                if self.sybil_config.window_duration_seconds > 0 {
                    let window_start =
                        now - Duration::seconds(self.sybil_config.window_duration_seconds);
                    history.retain(|&ts| ts >= window_start);
                }

                if let Some(&last_claim) = history.last() {
                    let elapsed = (now - last_claim).num_seconds();
                    if elapsed < self.sybil_config.min_cooldown_seconds {
                        return Err(RewardError::SybilDetected(format!(
                            "Claim cooldown active: {}s required between claims, only {}s elapsed",
                            self.sybil_config.min_cooldown_seconds, elapsed
                        )));
                    }
                }

                if history.len() >= self.sybil_config.max_claims_per_window {
                    return Err(RewardError::SybilDetected(format!(
                        "Max claims per window limit ({}) exceeded for recipient '{}'",
                        self.sybil_config.max_claims_per_window, reward.recipient
                    )));
                }
            }

            // Atomically record claim as Pending and reserve funds
            state.claims.insert(
                claim_id.clone(),
                ClaimRecord {
                    claim_id: claim_id.clone(),
                    recipient: reward.recipient.clone(),
                    amount: reward.amount,
                    status: ClaimStatus::Pending,
                    transaction_id: None,
                    created_at: now,
                    completed_at: None,
                    failure_reason: None,
                },
            );

            *state
                .recipient_payouts
                .entry(reward.recipient.clone())
                .or_insert(0) += reward.amount;
            state.total_disbursed += reward.amount;
            state
                .recipient_claim_history
                .entry(reward.recipient.clone())
                .or_default()
                .push(now);
        }

        // 2. Execute payment outside lock
        let payment_res = self.send_stellar_payment_with_retries(&reward).await;

        // 3. Atomically finalize claim status
        let mut state = self.state.lock().await;
        match payment_res {
            Ok(tx_id) => {
                if let Some(record) = state.claims.get_mut(&claim_id) {
                    record.status = ClaimStatus::Success;
                    record.transaction_id = Some(tx_id.clone());
                    record.completed_at = Some(Utc::now());
                }

                info!(
                    "Reward claim '{}' successfully paid: {} stroops to {}, tx {}",
                    claim_id, reward.amount, reward.recipient, tx_id
                );

                Ok(PaymentResult {
                    transaction_id: tx_id,
                    recipient: reward.recipient,
                    amount: reward.amount,
                    status: PaymentStatus::Success,
                })
            }
            Err(e) => {
                error!(
                    "Reward claim '{}' payment failed: {}. Reverting reserved caps.",
                    claim_id, e
                );

                // Roll back reserved caps
                if let Some(total) = state.recipient_payouts.get_mut(&reward.recipient) {
                    *total = (*total - reward.amount).max(0);
                }
                state.total_disbursed = (state.total_disbursed - reward.amount).max(0);

                if let Some(record) = state.claims.get_mut(&claim_id) {
                    record.status = ClaimStatus::Failed;
                    record.failure_reason = Some(e.clone());
                    record.completed_at = Some(Utc::now());
                }

                Err(RewardError::PaymentFailed(e))
            }
        }
    }

    /// Execute Stellar payment operation with retries (backwards-compatible wrapper)
    pub async fn execute_payment(
        &self,
        reward: RewardCalculation,
    ) -> Result<PaymentResult, String> {
        self.execute_claim(reward).await.map_err(|e| e.to_string())
    }

    /// Internal retry logic for Stellar payment submission
    async fn send_stellar_payment_with_retries(
        &self,
        reward: &RewardCalculation,
    ) -> Result<String, String> {
        for attempt in 1..=self.max_retries {
            match self.send_stellar_payment(reward).await {
                Ok(tx_id) => {
                    info!("Payment attempt {} successful: {}", attempt, tx_id);
                    return Ok(tx_id);
                }
                Err(e) => {
                    if attempt < self.max_retries {
                        warn!(
                            "Payment attempt {}/{} failed: {}. Retrying...",
                            attempt, self.max_retries, e
                        );
                        let backoff_ms = 50 * (1 << (attempt - 1));
                        tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                    } else {
                        error!("Payment failed after {} attempts: {}", self.max_retries, e);
                        return Err(format!("Payment failed: {}", e));
                    }
                }
            }
        }

        Err("Payment execution exhausted all retries".to_string())
    }

    /// Send payment via Stellar SDK placeholder / simulation
    async fn send_stellar_payment(&self, reward: &RewardCalculation) -> Result<String, String> {
        if reward.recipient == "simulate_failure" {
            return Err("Simulated network timeout connecting to Stellar horizon".to_string());
        }

        let tx_id = format!(
            "tx_{}_{}_{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
            reward.recipient,
            reward.amount
        );

        Ok(tx_id)
    }

    /// Process all rewards and execute payments
    pub async fn process_rewards(&self, verified_count: u32) -> Result<Vec<PaymentResult>, String> {
        let rewards = self.calculate_rewards(verified_count);
        let mut results = Vec::new();

        for reward in rewards {
            match self.execute_payment(reward).await {
                Ok(result) => {
                    info!("Reward processed: {:?}", result);
                    results.push(result);
                }
                Err(e) => {
                    error!("Failed to process reward: {}", e);
                    return Err(e);
                }
            }
        }

        Ok(results)
    }

    /// Get claim record by claim ID
    pub async fn get_claim(&self, claim_id: &str) -> Option<ClaimRecord> {
        let state = self.state.lock().await;
        state.claims.get(claim_id).cloned()
    }

    /// Get cumulative payout total for a recipient
    pub async fn get_recipient_total(&self, recipient: &str) -> i128 {
        let state = self.state.lock().await;
        state.recipient_payouts.get(recipient).copied().unwrap_or(0)
    }

    /// Get total disbursed across all claims
    pub async fn get_total_disbursed(&self) -> i128 {
        let state = self.state.lock().await;
        state.total_disbursed
    }

    /// Get total number of tracked claims
    pub async fn get_claim_count(&self) -> usize {
        let state = self.state.lock().await;
        state.claims.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_rewards() {
        let service = VerificationRewardsService::new("http://localhost:8000".to_string());
        let rewards = service.calculate_rewards(5);

        assert!(!rewards.is_empty());
        assert_eq!(rewards[0].amount, 500); // 5 * 100
        assert!(rewards[0].claim_id.is_some());
    }

    #[test]
    fn test_calculate_rewards_with_bonus() {
        let service = VerificationRewardsService::new("http://localhost:8000".to_string());
        let rewards = service.calculate_rewards(10);

        assert!(!rewards.is_empty());
        // 10 * 100 * 1.5 = 1500
        assert_eq!(rewards[0].amount, 1500);
    }

    #[tokio::test]
    async fn test_execute_payment() {
        let service = VerificationRewardsService::new("http://localhost:8000".to_string());
        let reward = RewardCalculation {
            recipient: "test_recipient".to_string(),
            amount: 100,
            reason: "Test reward".to_string(),
            claim_id: None,
        };

        let result = service.execute_payment(reward).await;
        assert!(result.is_ok());

        let payment = result.unwrap();
        assert_eq!(payment.status, PaymentStatus::Success);
        assert!(!payment.transaction_id.is_empty());
    }

    #[tokio::test]
    async fn test_process_rewards() {
        let service = VerificationRewardsService::new("http://localhost:8000".to_string());
        let results = service.process_rewards(5).await;

        assert!(results.is_ok());
        let payments = results.unwrap();
        assert!(!payments.is_empty());
        assert_eq!(payments[0].status, PaymentStatus::Success);
    }

    #[tokio::test]
    async fn test_sequential_double_claim_rejected() {
        let service = VerificationRewardsService::new("http://localhost:8000".to_string());
        let claim_id = "claim_seq_001";
        let recipient = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        let first = service
            .claim_reward(claim_id, recipient, 150, "First verification")
            .await;
        assert!(first.is_ok());

        let second = service
            .claim_reward(claim_id, recipient, 150, "Second duplicate verification")
            .await;
        assert!(second.is_err());
        match second.unwrap_err() {
            RewardError::DoubleClaim(msg) => {
                assert!(
                    msg.contains("already been successfully processed"),
                    "Unexpected message: {}",
                    msg
                );
            }
            other => panic!("Expected RewardError::DoubleClaim, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_concurrent_double_claim_rejected() {
        let service = Arc::new(VerificationRewardsService::new(
            "http://localhost:8000".to_string(),
        ));
        let claim_id = "claim_concurrent_001";
        let recipient = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
        let amount = 300;

        let s1 = Arc::clone(&service);
        let s2 = Arc::clone(&service);
        let c1 = claim_id.to_string();
        let c2 = claim_id.to_string();

        let handle1 = tokio::spawn(async move {
            s1.claim_reward(&c1, recipient, amount, "Verification claim worker 1")
                .await
        });

        let handle2 = tokio::spawn(async move {
            s2.claim_reward(&c2, recipient, amount, "Verification claim worker 2")
                .await
        });

        let (res1, res2) = tokio::join!(handle1, handle2);
        let r1 = res1.expect("worker 1 panicked");
        let r2 = res2.expect("worker 2 panicked");

        // Exactly one concurrent claim must succeed, and exactly one must fail with DoubleClaim
        let success_count = usize::from(r1.is_ok()) + usize::from(r2.is_ok());
        assert_eq!(
            success_count, 1,
            "Exactly one concurrent claim must succeed"
        );

        let failed_err = if r1.is_err() {
            r1.unwrap_err()
        } else {
            r2.unwrap_err()
        };

        match failed_err {
            RewardError::DoubleClaim(msg) => {
                assert!(
                    msg.contains("already") || msg.contains("pending"),
                    "Expected double claim message, got: {}",
                    msg
                );
            }
            other => panic!("Expected RewardError::DoubleClaim, got: {:?}", other),
        }

        assert_eq!(service.get_claim_count().await, 1);
        assert_eq!(service.get_recipient_total(recipient).await, amount);
    }

    #[tokio::test]
    async fn test_single_claim_amount_cap_exceeded() {
        let caps = RewardCaps {
            max_per_claim: 1000,
            max_per_recipient: 5000,
            global_pool_budget: 10000,
        };
        let service =
            VerificationRewardsService::new("http://localhost:8000".to_string()).with_caps(caps);

        let res = service
            .claim_reward(
                "claim_cap_single",
                "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
                1001,
                "Exceeds single claim cap",
            )
            .await;

        assert!(res.is_err());
        match res.unwrap_err() {
            RewardError::CapExceeded(msg) => {
                assert!(msg.contains("exceeds maximum per-claim cap"));
            }
            other => panic!("Expected RewardError::CapExceeded, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_cumulative_recipient_cap_exceeded() {
        let caps = RewardCaps {
            max_per_claim: 1000,
            max_per_recipient: 1500,
            global_pool_budget: 10000,
        };
        // Disable cooldown to test multiple sequential claims
        let sybil = SybilConfig {
            min_cooldown_seconds: 0,
            max_claims_per_window: 10,
            window_duration_seconds: 3600,
        };
        let service = VerificationRewardsService::new("http://localhost:8000".to_string())
            .with_caps(caps)
            .with_sybil_config(sybil);

        let recipient = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        let c1 = service
            .claim_reward("claim_cum_1", recipient, 1000, "First claim")
            .await;
        assert!(c1.is_ok());

        let c2 = service
            .claim_reward("claim_cum_2", recipient, 600, "Second claim exceeding cap")
            .await;
        assert!(c2.is_err());
        match c2.unwrap_err() {
            RewardError::CapExceeded(msg) => {
                assert!(msg.contains("exceeds maximum lifetime cap"));
            }
            other => panic!("Expected RewardError::CapExceeded, got: {:?}", other),
        }

        assert_eq!(service.get_recipient_total(recipient).await, 1000);
    }

    #[tokio::test]
    async fn test_global_pool_cap_exceeded() {
        let caps = RewardCaps {
            max_per_claim: 5000,
            max_per_recipient: 10000,
            global_pool_budget: 2000,
        };
        let sybil = SybilConfig {
            min_cooldown_seconds: 0,
            max_claims_per_window: 10,
            window_duration_seconds: 3600,
        };
        let service = VerificationRewardsService::new("http://localhost:8000".to_string())
            .with_caps(caps)
            .with_sybil_config(sybil);

        let r1 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
        let r2 = "GB5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        let c1 = service
            .claim_reward("claim_pool_1", r1, 1500, "Claim 1")
            .await;
        assert!(c1.is_ok());

        let c2 = service
            .claim_reward("claim_pool_2", r2, 800, "Claim 2 exceeding pool budget")
            .await;
        assert!(c2.is_err());
        match c2.unwrap_err() {
            RewardError::CapExceeded(msg) => {
                assert!(msg.contains("exceeds global pool budget cap"));
            }
            other => panic!("Expected RewardError::CapExceeded, got: {:?}", other),
        }

        assert_eq!(service.get_total_disbursed().await, 1500);
    }

    #[tokio::test]
    async fn test_sybil_cooldown_rejected() {
        let sybil = SybilConfig {
            min_cooldown_seconds: 30,
            max_claims_per_window: 5,
            window_duration_seconds: 3600,
        };
        let service = VerificationRewardsService::new("http://localhost:8000".to_string())
            .with_sybil_config(sybil);

        let recipient = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        let c1 = service
            .claim_reward("claim_cd_1", recipient, 100, "First claim")
            .await;
        assert!(c1.is_ok());

        // Attempt second claim immediately for the same recipient
        let c2 = service
            .claim_reward("claim_cd_2", recipient, 100, "Immediate second claim")
            .await;
        assert!(c2.is_err());
        match c2.unwrap_err() {
            RewardError::SybilDetected(msg) => {
                assert!(msg.contains("Claim cooldown active"));
            }
            other => panic!("Expected RewardError::SybilDetected, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_sybil_rate_limit_window_exceeded() {
        let sybil = SybilConfig {
            min_cooldown_seconds: 0,
            max_claims_per_window: 2,
            window_duration_seconds: 3600,
        };
        let service = VerificationRewardsService::new("http://localhost:8000".to_string())
            .with_sybil_config(sybil);

        let recipient = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

        assert!(service
            .claim_reward("claim_win_1", recipient, 50, "Claim 1")
            .await
            .is_ok());
        assert!(service
            .claim_reward("claim_win_2", recipient, 50, "Claim 2")
            .await
            .is_ok());

        let c3 = service
            .claim_reward("claim_win_3", recipient, 50, "Claim 3 exceeding window")
            .await;
        assert!(c3.is_err());
        match c3.unwrap_err() {
            RewardError::SybilDetected(msg) => {
                assert!(msg.contains("Max claims per window limit"));
            }
            other => panic!("Expected RewardError::SybilDetected, got: {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_recipient_validation() {
        let service = VerificationRewardsService::new("http://localhost:8000".to_string());

        // Valid Stellar address
        assert!(VerificationRewardsService::validate_recipient(
            "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        )
        .is_ok());

        // Valid named identifier
        assert!(VerificationRewardsService::validate_recipient("verified_pool").is_ok());
        assert!(VerificationRewardsService::validate_recipient("creator-pool-1").is_ok());

        // Invalid: empty
        assert!(matches!(
            VerificationRewardsService::validate_recipient(""),
            Err(RewardError::InvalidRecipient(_))
        ));

        // Invalid: starts with G but truncated
        assert!(matches!(
            VerificationRewardsService::validate_recipient("GA5ZSEJYB37JRC5A"),
            Err(RewardError::InvalidRecipient(_))
        ));

        // Invalid: illegal characters
        assert!(matches!(
            VerificationRewardsService::validate_recipient("bad!recipient@address"),
            Err(RewardError::InvalidRecipient(_))
        ));

        let res = service
            .claim_reward("claim_bad_addr", "bad!addr", 100, "Bad address test")
            .await;
        assert!(matches!(res, Err(RewardError::InvalidRecipient(_))));
    }

    #[tokio::test]
    async fn test_invalid_amount_rejected() {
        let service = VerificationRewardsService::new("http://localhost:8000".to_string());

        let res_zero = service
            .claim_reward(
                "claim_zero",
                "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
                0,
                "Zero amount",
            )
            .await;
        assert!(matches!(res_zero, Err(RewardError::InvalidAmount(_))));

        let res_neg = service
            .claim_reward(
                "claim_neg",
                "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
                -100,
                "Negative amount",
            )
            .await;
        assert!(matches!(res_neg, Err(RewardError::InvalidAmount(_))));
    }

    #[tokio::test]
    async fn test_payment_failure_rollback() {
        let service = VerificationRewardsService::new("http://localhost:8000".to_string())
            .with_max_retries(1);

        let recipient = "simulate_failure";
        let res = service
            .claim_reward("claim_fail_1", recipient, 500, "Payment failure simulation")
            .await;

        assert!(res.is_err());
        match res.unwrap_err() {
            RewardError::PaymentFailed(msg) => {
                assert!(msg.contains("Simulated network timeout"));
            }
            other => panic!("Expected RewardError::PaymentFailed, got: {:?}", other),
        }

        // Verify reserved caps are rolled back
        assert_eq!(service.get_recipient_total(recipient).await, 0);
        assert_eq!(service.get_total_disbursed().await, 0);

        // Verify claim is stored as Failed
        let claim = service.get_claim("claim_fail_1").await.unwrap();
        assert_eq!(claim.status, ClaimStatus::Failed);
        assert!(claim.failure_reason.is_some());
    }
}
