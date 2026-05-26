//! ML service: logistic-regression payment-success predictor.
//!
//! ## Issue #424 – Replace placeholder model
//! `SimpleMLModel` previously used static weights and fake training data.
//! This module trains a real logistic-regression model on historical
//! `PaymentRecord` data using gradient-descent, so predictions change with
//! actual inputs.
//!
//! ## Issue #427 – Weekly retraining pipeline
//! `run_weekly_retraining` extracts the last 7 days of performance data,
//! retrains the model, and persists updated parameters in-memory (or to a
//! file when `MODEL_PARAMS_PATH` is set).

use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

// ── Training record ───────────────────────────────────────────────────────────

/// A single historical payment observation used for training / inference.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PaymentRecord {
    /// Unix timestamp (seconds) when the payment was attempted.
    pub timestamp_secs: u64,
    /// Payment amount in the smallest currency unit (e.g. stroops).
    pub amount: f64,
    /// Number of prior successful payments by this sender.
    pub sender_history_count: f64,
    /// Corridor reliability score in [0.0, 1.0].
    pub corridor_reliability: f64,
    /// Whether the payment ultimately succeeded (label).
    pub success: bool,
}

// ── Feature extraction ────────────────────────────────────────────────────────

/// Extract the three-dimensional feature vector from a record.
/// Features are normalised to improve gradient-descent convergence.
fn features(r: &PaymentRecord) -> [f64; 3] {
    [
        (r.amount / 1_000_000.0).tanh(),          // amount (normalised)
        (r.sender_history_count / 100.0).tanh(),  // sender history (normalised)
        r.corridor_reliability.clamp(0.0, 1.0),   // already in [0,1]
    ]
}

// ── Logistic regression ───────────────────────────────────────────────────────

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// Trained logistic-regression parameters.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModelParams {
    /// Weight vector (one per feature).
    pub weights: [f64; 3],
    /// Bias term.
    pub bias: f64,
    /// Unix timestamp when these params were last trained.
    pub trained_at: u64,
    /// Number of training samples used.
    pub sample_count: usize,
}

impl Default for ModelParams {
    fn default() -> Self {
        ModelParams {
            weights: [0.0; 3],
            bias: 0.0,
            trained_at: 0,
            sample_count: 0,
        }
    }
}

impl ModelParams {
    /// Predict success probability for a feature vector.
    pub fn predict(&self, feats: &[f64; 3]) -> f64 {
        let z = self.bias
            + self.weights[0] * feats[0]
            + self.weights[1] * feats[1]
            + self.weights[2] * feats[2];
        sigmoid(z)
    }
}

/// Train logistic regression via mini-batch gradient descent.
///
/// Returns `None` when `records` is empty.
pub fn train(records: &[PaymentRecord], learning_rate: f64, epochs: usize) -> Option<ModelParams> {
    if records.is_empty() {
        return None;
    }

    let mut w = [0.0_f64; 3];
    let mut b = 0.0_f64;
    let n = records.len() as f64;

    for _ in 0..epochs {
        let mut dw = [0.0_f64; 3];
        let mut db = 0.0_f64;

        for r in records {
            let x = features(r);
            let y = if r.success { 1.0 } else { 0.0 };
            let z = b + w[0] * x[0] + w[1] * x[1] + w[2] * x[2];
            let err = sigmoid(z) - y;
            for i in 0..3 {
                dw[i] += err * x[i];
            }
            db += err;
        }

        for i in 0..3 {
            w[i] -= learning_rate * dw[i] / n;
        }
        b -= learning_rate * db / n;
    }

    let trained_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Some(ModelParams {
        weights: w,
        bias: b,
        trained_at,
        sample_count: records.len(),
    })
}

// ── Model singleton ───────────────────────────────────────────────────────────

/// Thread-safe wrapper around the current model parameters.
#[derive(Clone)]
pub struct SimpleMLModel {
    params: Arc<RwLock<ModelParams>>,
}

impl SimpleMLModel {
    /// Create a new model.  If `initial_records` is non-empty the model is
    /// trained immediately; otherwise it starts with zero weights.
    pub fn new(initial_records: &[PaymentRecord]) -> Self {
        let params = train(initial_records, 0.1, 200).unwrap_or_default();
        SimpleMLModel {
            params: Arc::new(RwLock::new(params)),
        }
    }

    /// Predict the probability that a payment described by `record` succeeds.
    pub fn predict_success_probability(&self, record: &PaymentRecord) -> f64 {
        let feats = features(record);
        self.params
            .read()
            .expect("model params lock poisoned")
            .predict(&feats)
    }

    /// Replace the current parameters with newly trained ones.
    pub fn update_params(&self, new_params: ModelParams) {
        let mut guard = self.params.write().expect("model params lock poisoned");
        *guard = new_params;
    }

    /// Return a snapshot of the current parameters (for persistence / logging).
    pub fn current_params(&self) -> ModelParams {
        self.params.read().expect("model params lock poisoned").clone()
    }
}

// ── Weekly retraining pipeline (Issue #427) ───────────────────────────────────

const SEVEN_DAYS_SECS: u64 = 7 * 24 * 60 * 60;

/// Extract records from the last 7 days.
fn filter_recent(records: &[PaymentRecord]) -> Vec<PaymentRecord> {
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        .saturating_sub(SEVEN_DAYS_SECS);

    records
        .iter()
        .filter(|r| r.timestamp_secs >= cutoff)
        .cloned()
        .collect()
}

/// Persist model parameters to `MODEL_PARAMS_PATH` when set.
fn persist_params(params: &ModelParams) {
    if let Ok(path) = std::env::var("MODEL_PARAMS_PATH") {
        match serde_json::to_string_pretty(params) {
            Ok(json) => {
                if let Err(e) = std::fs::write(&path, json) {
                    tracing::warn!("Failed to persist model params to {}: {}", path, e);
                } else {
                    tracing::info!("Model params persisted to {}", path);
                }
            }
            Err(e) => tracing::warn!("Failed to serialise model params: {}", e),
        }
    }
}

/// Run the weekly ML retraining job.
///
/// 1. Filters `all_records` to the last 7 days.
/// 2. Retrains the logistic-regression model on that window.
/// 3. Updates `model` in-place with the new parameters.
/// 4. Persists parameters when `MODEL_PARAMS_PATH` env var is set.
///
/// Returns the number of records used for retraining, or `None` if there
/// were no recent records.
pub fn run_weekly_retraining(
    model: &SimpleMLModel,
    all_records: &[PaymentRecord],
) -> Option<usize> {
    let recent = filter_recent(all_records);
    tracing::info!(
        "Weekly retraining: {} records in the last 7 days",
        recent.len()
    );

    let new_params = train(&recent, 0.1, 300)?;
    let count = new_params.sample_count;

    tracing::info!(
        "Retraining complete: {} samples, weights={:?}, bias={:.4}",
        count,
        new_params.weights,
        new_params.bias
    );

    persist_params(&new_params);
    model.update_params(new_params);

    Some(count)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn record(success: bool, amount: f64, history: f64, reliability: f64) -> PaymentRecord {
        PaymentRecord {
            timestamp_secs: now_secs(),
            amount,
            sender_history_count: history,
            corridor_reliability: reliability,
            success,
        }
    }

    #[test]
    fn train_returns_none_for_empty_data() {
        assert!(train(&[], 0.1, 100).is_none());
    }

    #[test]
    fn trained_model_predicts_high_prob_for_good_inputs() {
        // All-success training set with high reliability
        let records: Vec<PaymentRecord> = (0..50)
            .map(|_| record(true, 500_000.0, 20.0, 0.95))
            .collect();
        let params = train(&records, 0.1, 500).unwrap();
        let prob = params.predict(&features(&record(true, 500_000.0, 20.0, 0.95)));
        assert!(prob > 0.6, "expected high probability, got {prob}");
    }

    #[test]
    fn trained_model_predicts_low_prob_for_bad_inputs() {
        // All-failure training set
        let records: Vec<PaymentRecord> = (0..50)
            .map(|_| record(false, 100.0, 0.0, 0.1))
            .collect();
        let params = train(&records, 0.1, 500).unwrap();
        let prob = params.predict(&features(&record(false, 100.0, 0.0, 0.1)));
        assert!(prob < 0.4, "expected low probability, got {prob}");
    }

    #[test]
    fn predictions_change_with_inputs() {
        let records: Vec<PaymentRecord> = (0..30)
            .map(|i| record(i % 3 != 0, 1_000_000.0, 50.0, 0.8))
            .collect();
        let model = SimpleMLModel::new(&records);
        let p_good = model.predict_success_probability(&record(true, 2_000_000.0, 80.0, 0.95));
        let p_bad = model.predict_success_probability(&record(false, 100.0, 0.0, 0.05));
        // Good inputs should score higher than bad inputs
        assert!(p_good > p_bad, "good={p_good}, bad={p_bad}");
    }

    #[test]
    fn weekly_retraining_updates_params() {
        let model = SimpleMLModel::new(&[]);
        let old_trained_at = model.current_params().trained_at;

        // Create records timestamped within the last 7 days
        let records: Vec<PaymentRecord> = (0..20)
            .map(|i| PaymentRecord {
                timestamp_secs: now_secs() - 3600, // 1 hour ago
                amount: 500_000.0,
                sender_history_count: 10.0,
                corridor_reliability: 0.8,
                success: i % 4 != 0,
            })
            .collect();

        let count = run_weekly_retraining(&model, &records);
        assert_eq!(count, Some(20));
        assert!(model.current_params().trained_at >= old_trained_at);
        assert_eq!(model.current_params().sample_count, 20);
    }

    #[test]
    fn weekly_retraining_ignores_old_records() {
        let model = SimpleMLModel::new(&[]);
        // Records older than 7 days
        let old_records: Vec<PaymentRecord> = (0..10)
            .map(|_| PaymentRecord {
                timestamp_secs: now_secs() - SEVEN_DAYS_SECS - 3600,
                amount: 500_000.0,
                sender_history_count: 10.0,
                corridor_reliability: 0.8,
                success: true,
            })
            .collect();

        let count = run_weekly_retraining(&model, &old_records);
        assert_eq!(count, None, "no recent records should yield None");
    }
}
