//! Anchor reliability analytics with time-decay scoring and statistical confidence.
//!
//! ## Problem
//! A purely cumulative reliability score treats a failure from two years ago
//! the same as one from yesterday.  This makes the metric slow to react to
//! real performance changes — both improvements and regressions.
//!
//! ## Solution
//! Each anchor event is weighted by an **exponential decay factor**
//! `e^(-λ · age_days)` before being folded into the score.  Recent events
//! therefore dominate the result while old events fade gracefully.
//!
//! The decay constant `λ` controls the half-life:
//!   half_life_days = ln(2) / λ  ≈  0.693 / λ
//!
//! Default `λ = 0.02` → half-life ≈ 34.7 days.  Tune via
//! `AnchorScoringConfig::with_decay_lambda`.
//!
//! ## Confidence
//! The `confidence` field in [`AnchorReliabilityScore`] is derived from the
//! **effective weight** (Σ decay factors) and the score itself using the
//! Wilson score interval for a weighted proportion.
//!
//! For a weighted proportion `p` with effective weight `W`, the half-width of
//! the 95 % Wilson interval is:
//!
//! ```text
//! half_width = z * sqrt(p * (1 - p) / W)   where z = 1.96
//! ```
//!
//! `confidence = 1 − half_width`, clamped to `[0.0, 1.0]`.
//!
//! Interpretation:
//! - Many recent events + score near 0 or 1 → confidence near 1.0 (low variance).
//! - Few or old events → confidence near 0.0 (high uncertainty).
//! - Score near 0.5 → lower confidence (maximum binomial variance).

use serde::{Deserialize, Serialize};

// ── Event types ───────────────────────────────────────────────────────────────

/// The outcome of a single anchor interaction.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnchorEventKind {
    /// Transaction completed successfully.
    Success,
    /// Transaction failed (timeout, rejection, error).
    Failure,
    /// Transaction completed but was delayed beyond the SLA threshold.
    Delayed,
}

/// A single recorded anchor event.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AnchorEvent {
    /// Unique anchor identifier (e.g. `"circle-usdc"`, `"bitso-mxn"`).
    pub anchor_id: String,
    /// Outcome of the interaction.
    pub kind: AnchorEventKind,
    /// Unix timestamp (seconds) when the event occurred.
    pub timestamp_secs: u64,
}

// ── Scoring config ────────────────────────────────────────────────────────────

/// Tuning parameters for the time-decay reliability scorer.
#[derive(Clone, Debug, PartialEq)]
pub struct AnchorScoringConfig {
    /// Decay constant λ (lambda).  Higher → faster decay.
    /// Default: 0.02  (half-life ≈ 34.7 days).
    pub decay_lambda: f64,
    /// Weight applied to a `Delayed` event relative to a `Success`.
    /// Range [0.0, 1.0].  Default: 0.5.
    pub delayed_weight: f64,
    /// Unix timestamp (seconds) used as "now" when computing event ages.
    /// Override in tests for deterministic results; leave `None` in
    /// production to use the system clock.
    pub now_secs: Option<u64>,
}

impl Default for AnchorScoringConfig {
    fn default() -> Self {
        AnchorScoringConfig {
            decay_lambda: 0.02,
            delayed_weight: 0.5,
            now_secs: None,
        }
    }
}

impl AnchorScoringConfig {
    /// Override the decay constant.
    pub fn with_decay_lambda(mut self, lambda: f64) -> Self {
        self.decay_lambda = lambda;
        self
    }

    /// Override the delayed-event weight.
    pub fn with_delayed_weight(mut self, w: f64) -> Self {
        self.delayed_weight = w;
        self
    }

    /// Pin "now" to a fixed timestamp (useful in tests).
    pub fn with_now(mut self, now_secs: u64) -> Self {
        self.now_secs = Some(now_secs);
        self
    }

    fn now(&self) -> u64 {
        self.now_secs.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        })
    }
}

// ── Score output ──────────────────────────────────────────────────────────────

/// Z-score for a 95 % two-sided confidence interval (1.96).
const Z_95: f64 = 1.96;

/// Compute the Wilson-score confidence for a weighted proportion.
///
/// # Arguments
/// * `score`            – Point estimate of the proportion, in `[0.0, 1.0]`.
/// * `effective_weight` – Sum of decay weights (Σ w_i); acts as the effective
///                        sample size.
///
/// # Returns
/// A value in `[0.0, 1.0]` where **1.0 means maximum certainty** and **0.0
/// means no information at all**.
///
/// The half-width of the 95 % Wilson interval for a weighted proportion is:
/// ```text
/// half_width = z * sqrt(p * (1 - p) / W)
/// ```
/// Confidence is then `1 − half_width`, clamped to `[0.0, 1.0]`.
///
/// Edge cases:
/// - `effective_weight == 0` → returns `0.0` (no data).
/// - `score == 0.0` or `score == 1.0` → variance is 0, returns `1.0`.
pub fn wilson_confidence(score: f64, effective_weight: f64) -> f64 {
    if effective_weight <= 0.0 {
        return 0.0;
    }
    // Binomial variance is maximised at p = 0.5 and zero at p ∈ {0, 1}.
    let variance = score * (1.0 - score);
    let half_width = Z_95 * (variance / effective_weight).sqrt();
    (1.0 - half_width).clamp(0.0, 1.0)
}

/// Computed reliability score for a single anchor.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorReliabilityScore {
    /// Anchor identifier.
    pub anchor_id: String,
    /// Reliability score in [0.0, 1.0].  1.0 = perfect, 0.0 = all failures.
    pub score: f64,
    /// Total number of events that contributed to this score.
    pub event_count: usize,
    /// Sum of decay weights across all events (effective sample size).
    pub effective_weight: f64,
    /// Statistical confidence in the score, derived from the Wilson score
    /// interval for a weighted proportion (95 % CI).
    ///
    /// Range [0.0, 1.0]:
    /// - **1.0** – very high certainty (many recent events, score near 0 or 1).
    /// - **0.0** – no information (zero effective weight).
    ///
    /// Computed as `1 − half_width` where
    /// `half_width = 1.96 * sqrt(score * (1 − score) / effective_weight)`.
    pub confidence: f64,
}

// ── Core algorithm ────────────────────────────────────────────────────────────

/// Compute the time-decayed reliability score for a single anchor.
///
/// # Algorithm
///
/// For each event `i` with age `a_i` days:
///   - decay factor:  `w_i = e^(-λ · a_i)`
///   - success value: `v_i = 1.0` (Success), `delayed_weight` (Delayed), `0.0` (Failure)
///
/// Score = Σ(w_i · v_i) / Σ(w_i)
///
/// Returns `None` when the event slice is empty (no data to score).
pub fn compute_reliability_score(
    anchor_id: &str,
    events: &[AnchorEvent],
    config: &AnchorScoringConfig,
) -> Option<AnchorReliabilityScore> {
    // Filter to only this anchor's events.
    let relevant: Vec<&AnchorEvent> = events
        .iter()
        .filter(|e| e.anchor_id == anchor_id)
        .collect();

    if relevant.is_empty() {
        return None;
    }

    let now = config.now();
    let secs_per_day = 86_400.0_f64;
    let lambda = config.decay_lambda;

    let mut weighted_success = 0.0_f64;
    let mut total_weight = 0.0_f64;

    for event in &relevant {
        // Age in days; clamp to 0 so future-dated events don't boost the score.
        let age_days = if now >= event.timestamp_secs {
            (now - event.timestamp_secs) as f64 / secs_per_day
        } else {
            0.0
        };

        let decay = (-lambda * age_days).exp();

        let value = match event.kind {
            AnchorEventKind::Success => 1.0,
            AnchorEventKind::Delayed => config.delayed_weight,
            AnchorEventKind::Failure => 0.0,
        };

        weighted_success += decay * value;
        total_weight += decay;
    }

    // Guard against degenerate floating-point edge cases.
    let score = if total_weight > 0.0 {
        (weighted_success / total_weight).clamp(0.0, 1.0)
    } else {
        0.0
    };

    // Round to 4 decimal places for stable serialisation.
    let score = (score * 10_000.0).round() / 10_000.0;
    let effective_weight = (total_weight * 10_000.0).round() / 10_000.0;

    // Derive confidence from the effective weight and the point estimate using
    // the Wilson score interval.  This reflects both sample size (via
    // effective_weight) and score extremity (variance is 0 at 0 and 1).
    let confidence = {
        let raw = wilson_confidence(score, effective_weight);
        (raw * 10_000.0).round() / 10_000.0
    };

    Some(AnchorReliabilityScore {
        anchor_id: anchor_id.to_string(),
        score,
        event_count: relevant.len(),
        effective_weight,
        confidence,
    })
}

/// Score every distinct anchor present in `events`.
///
/// Returns one `AnchorReliabilityScore` per unique `anchor_id`, sorted by
/// score descending (highest reliability first).
pub fn score_all_anchors(
    events: &[AnchorEvent],
    config: &AnchorScoringConfig,
) -> Vec<AnchorReliabilityScore> {
    // Collect unique anchor IDs while preserving first-seen order.
    let mut seen = std::collections::HashSet::new();
    let mut anchor_ids: Vec<&str> = Vec::new();
    for e in events {
        if seen.insert(e.anchor_id.as_str()) {
            anchor_ids.push(&e.anchor_id);
        }
    }

    let mut scores: Vec<AnchorReliabilityScore> = anchor_ids
        .into_iter()
        .filter_map(|id| compute_reliability_score(id, events, config))
        .collect();

    // Highest reliability first.
    scores.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scores
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_745_000_000; // fixed "now" for deterministic tests
    const DAY: u64 = 86_400;

    fn cfg() -> AnchorScoringConfig {
        AnchorScoringConfig::default().with_now(NOW)
    }

    fn event(anchor_id: &str, kind: AnchorEventKind, age_days: u64) -> AnchorEvent {
        AnchorEvent {
            anchor_id: anchor_id.to_string(),
            kind,
            timestamp_secs: NOW - age_days * DAY,
        }
    }

    // ── Basic correctness ─────────────────────────────────────────────────────

    #[test]
    fn all_successes_score_one() {
        let events = vec![
            event("anchor-a", AnchorEventKind::Success, 1),
            event("anchor-a", AnchorEventKind::Success, 10),
            event("anchor-a", AnchorEventKind::Success, 30),
        ];
        let score = compute_reliability_score("anchor-a", &events, &cfg()).unwrap();
        assert_eq!(score.score, 1.0);
        assert_eq!(score.event_count, 3);
        // Score at boundary (1.0) → variance = 0 → confidence = 1.0.
        assert_eq!(score.confidence, 1.0);
    }

    #[test]
    fn all_failures_score_zero() {
        let events = vec![
            event("anchor-b", AnchorEventKind::Failure, 2),
            event("anchor-b", AnchorEventKind::Failure, 15),
        ];
        let score = compute_reliability_score("anchor-b", &events, &cfg()).unwrap();
        assert_eq!(score.score, 0.0);
        assert_eq!(score.event_count, 2);
        // Score at boundary (0.0) → variance = 0 → confidence = 1.0.
        assert_eq!(score.confidence, 1.0);
    }

    #[test]
    fn empty_events_returns_none() {
        let result = compute_reliability_score("anchor-x", &[], &cfg());
        assert!(result.is_none());
    }

    #[test]
    fn unknown_anchor_returns_none() {
        let events = vec![event("anchor-a", AnchorEventKind::Success, 1)];
        let result = compute_reliability_score("anchor-z", &events, &cfg());
        assert!(result.is_none());
    }

    // ── Time-decay: recent events outweigh old ones ───────────────────────────

    #[test]
    fn recent_failure_lowers_score_more_than_old_failure() {
        // Scenario A: old failure (60 days ago), recent successes
        let events_a = vec![
            event("anchor-a", AnchorEventKind::Failure, 60),
            event("anchor-a", AnchorEventKind::Success, 1),
            event("anchor-a", AnchorEventKind::Success, 2),
        ];

        // Scenario B: recent failure (1 day ago), old successes
        let events_b = vec![
            event("anchor-b", AnchorEventKind::Success, 60),
            event("anchor-b", AnchorEventKind::Success, 61),
            event("anchor-b", AnchorEventKind::Failure, 1),
        ];

        let score_a = compute_reliability_score("anchor-a", &events_a, &cfg()).unwrap();
        let score_b = compute_reliability_score("anchor-b", &events_b, &cfg()).unwrap();

        // Anchor A (old failure) should score higher than anchor B (recent failure).
        assert!(
            score_a.score > score_b.score,
            "expected score_a ({}) > score_b ({})",
            score_a.score,
            score_b.score
        );
    }

    #[test]
    fn recent_recovery_raises_score_above_old_failure_baseline() {
        // Anchor had failures historically but has been succeeding recently.
        let events = vec![
            event("anchor-c", AnchorEventKind::Failure, 90),
            event("anchor-c", AnchorEventKind::Failure, 80),
            event("anchor-c", AnchorEventKind::Failure, 70),
            event("anchor-c", AnchorEventKind::Success, 3),
            event("anchor-c", AnchorEventKind::Success, 2),
            event("anchor-c", AnchorEventKind::Success, 1),
        ];
        let score = compute_reliability_score("anchor-c", &events, &cfg()).unwrap();
        // Recent successes should dominate; score should be well above 0.5.
        assert!(score.score > 0.80, "expected score > 0.80, got {}", score.score);
    }

    #[test]
    fn decay_is_applied_consistently_across_anchors() {
        // Two anchors with identical event histories should produce identical scores.
        let events = vec![
            event("anchor-x", AnchorEventKind::Success, 5),
            event("anchor-x", AnchorEventKind::Failure, 20),
            event("anchor-y", AnchorEventKind::Success, 5),
            event("anchor-y", AnchorEventKind::Failure, 20),
        ];
        let sx = compute_reliability_score("anchor-x", &events, &cfg()).unwrap();
        let sy = compute_reliability_score("anchor-y", &events, &cfg()).unwrap();
        assert_eq!(sx.score, sy.score);
    }

    // ── Delayed events ────────────────────────────────────────────────────────

    #[test]
    fn delayed_event_scores_between_success_and_failure() {
        let events_success = vec![event("a", AnchorEventKind::Success, 1)];
        let events_delayed = vec![event("b", AnchorEventKind::Delayed, 1)];
        let events_failure = vec![event("c", AnchorEventKind::Failure, 1)];

        let s = compute_reliability_score("a", &events_success, &cfg()).unwrap().score;
        let d = compute_reliability_score("b", &events_delayed, &cfg()).unwrap().score;
        let f = compute_reliability_score("c", &events_failure, &cfg()).unwrap().score;

        assert!(s > d, "success ({s}) should beat delayed ({d})");
        assert!(d > f, "delayed ({d}) should beat failure ({f})");
    }

    // ── score_all_anchors ─────────────────────────────────────────────────────

    #[test]
    fn score_all_anchors_sorted_descending() {
        let events = vec![
            event("bad-anchor", AnchorEventKind::Failure, 1),
            event("bad-anchor", AnchorEventKind::Failure, 2),
            event("good-anchor", AnchorEventKind::Success, 1),
            event("good-anchor", AnchorEventKind::Success, 2),
            event("mid-anchor", AnchorEventKind::Success, 1),
            event("mid-anchor", AnchorEventKind::Failure, 2),
        ];
        let scores = score_all_anchors(&events, &cfg());
        assert_eq!(scores.len(), 3);
        // Verify descending order.
        for w in scores.windows(2) {
            assert!(
                w[0].score >= w[1].score,
                "scores not sorted: {} < {}",
                w[0].score,
                w[1].score
            );
        }
        assert_eq!(scores[0].anchor_id, "good-anchor");
        assert_eq!(scores[2].anchor_id, "bad-anchor");
    }

    #[test]
    fn score_all_anchors_empty_returns_empty() {
        let scores = score_all_anchors(&[], &cfg());
        assert!(scores.is_empty());
    }

    // ── Config tuning ─────────────────────────────────────────────────────────

    #[test]
    fn higher_lambda_decays_faster() {
        // With a very high lambda, a 30-day-old failure should barely matter.
        let events = vec![
            event("anchor-a", AnchorEventKind::Failure, 30),
            event("anchor-a", AnchorEventKind::Success, 1),
        ];
        let slow_cfg = cfg().with_decay_lambda(0.001); // very slow decay
        let fast_cfg = cfg().with_decay_lambda(0.2);   // fast decay

        let slow_score = compute_reliability_score("anchor-a", &events, &slow_cfg).unwrap();
        let fast_score = compute_reliability_score("anchor-a", &events, &fast_cfg).unwrap();

        // Fast decay → old failure weighs almost nothing → higher score.
        assert!(
            fast_score.score > slow_score.score,
            "fast ({}) should beat slow ({})",
            fast_score.score,
            slow_score.score
        );
    }

    #[test]
    fn future_dated_event_treated_as_age_zero() {
        // An event timestamped in the future should not inflate the score.
        let future_event = AnchorEvent {
            anchor_id: "anchor-f".to_string(),
            kind: AnchorEventKind::Success,
            timestamp_secs: NOW + DAY * 10, // 10 days in the future
        };
        let past_event = event("anchor-f", AnchorEventKind::Success, 0);
        let score_future = compute_reliability_score("anchor-f", &[future_event], &cfg()).unwrap();
        let score_now = compute_reliability_score("anchor-f", &[past_event], &cfg()).unwrap();
        // Both should score 1.0 (all successes); future is clamped to age 0.
        assert_eq!(score_future.score, score_now.score);
    }

    #[test]
    fn effective_weight_decreases_with_age() {
        let recent = vec![event("a", AnchorEventKind::Success, 1)];
        let old = vec![event("b", AnchorEventKind::Success, 365)];

        let w_recent = compute_reliability_score("a", &recent, &cfg()).unwrap().effective_weight;
        let w_old = compute_reliability_score("b", &old, &cfg()).unwrap().effective_weight;

        assert!(w_recent > w_old, "recent weight ({w_recent}) should exceed old ({w_old})");
    }

    // ── Confidence: derived from effective weight and score variance ──────────

    #[test]
    fn confidence_increases_with_more_events() {
        // Same score (all successes), but more events → higher confidence.
        let few_events = vec![
            event("anchor-few", AnchorEventKind::Success, 1),
        ];
        let many_events = vec![
            event("anchor-many", AnchorEventKind::Success, 1),
            event("anchor-many", AnchorEventKind::Success, 2),
            event("anchor-many", AnchorEventKind::Success, 3),
            event("anchor-many", AnchorEventKind::Success, 4),
            event("anchor-many", AnchorEventKind::Success, 5),
            event("anchor-many", AnchorEventKind::Success, 6),
            event("anchor-many", AnchorEventKind::Success, 7),
            event("anchor-many", AnchorEventKind::Success, 8),
            event("anchor-many", AnchorEventKind::Success, 9),
            event("anchor-many", AnchorEventKind::Success, 10),
        ];

        // Both score 1.0 (all successes) → variance = 0 → confidence = 1.0 for both.
        // Use a mixed dataset to see the effect of sample size on confidence.
        let few_mixed = vec![
            event("few-m", AnchorEventKind::Success, 1),
            event("few-m", AnchorEventKind::Failure, 2),
        ];
        let many_mixed: Vec<AnchorEvent> = (1..=20)
            .flat_map(|i| {
                vec![
                    event("many-m", AnchorEventKind::Success, i),
                    event("many-m", AnchorEventKind::Failure, i + 20),
                ]
            })
            .collect();

        let c_few = compute_reliability_score("few-m", &few_mixed, &cfg())
            .unwrap()
            .confidence;
        let c_many = compute_reliability_score("many-m", &many_mixed, &cfg())
            .unwrap()
            .confidence;

        assert!(
            c_many > c_few,
            "more events should yield higher confidence: many={c_many}, few={c_few}"
        );

        // Boundary scores (0 or 1) always yield confidence = 1.0 regardless of count.
        let c_few_all_success = compute_reliability_score("anchor-few", &few_events, &cfg())
            .unwrap()
            .confidence;
        let c_many_all_success = compute_reliability_score("anchor-many", &many_events, &cfg())
            .unwrap()
            .confidence;
        assert_eq!(c_few_all_success, 1.0);
        assert_eq!(c_many_all_success, 1.0);
    }

    #[test]
    fn confidence_lower_for_score_near_half() {
        // A score near 0.5 has maximum binomial variance → lower confidence
        // than a score near 0 or 1 with the same effective weight.
        let balanced = vec![
            event("balanced", AnchorEventKind::Success, 1),
            event("balanced", AnchorEventKind::Failure, 2),
        ];
        let extreme = vec![
            event("extreme", AnchorEventKind::Success, 1),
            event("extreme", AnchorEventKind::Success, 2),
        ];

        let c_balanced = compute_reliability_score("balanced", &balanced, &cfg())
            .unwrap()
            .confidence;
        let c_extreme = compute_reliability_score("extreme", &extreme, &cfg())
            .unwrap()
            .confidence;

        assert!(
            c_extreme > c_balanced,
            "score near 1.0 ({c_extreme}) should have higher confidence than score near 0.5 ({c_balanced})"
        );
    }

    #[test]
    fn confidence_is_zero_for_zero_effective_weight() {
        // wilson_confidence with W=0 must return 0.0 (no data).
        assert_eq!(wilson_confidence(0.5, 0.0), 0.0);
        assert_eq!(wilson_confidence(1.0, 0.0), 0.0);
        assert_eq!(wilson_confidence(0.0, 0.0), 0.0);
    }

    #[test]
    fn confidence_is_one_at_score_boundaries() {
        // Variance is 0 at p=0 and p=1, so confidence must be 1.0 for any W > 0.
        assert_eq!(wilson_confidence(0.0, 1.0), 1.0);
        assert_eq!(wilson_confidence(1.0, 1.0), 1.0);
        assert_eq!(wilson_confidence(0.0, 100.0), 1.0);
        assert_eq!(wilson_confidence(1.0, 100.0), 1.0);
    }

    #[test]
    fn confidence_in_valid_range() {
        // Confidence must always be in [0.0, 1.0] for any inputs.
        let test_cases = [
            (0.5, 0.1),   // very low weight, maximum variance
            (0.5, 1.0),
            (0.5, 10.0),
            (0.5, 100.0),
            (0.3, 5.0),
            (0.9, 2.0),
            (0.1, 50.0),
        ];
        for (score, weight) in test_cases {
            let c = wilson_confidence(score, weight);
            assert!(
                (0.0..=1.0).contains(&c),
                "confidence {c} out of range for score={score}, weight={weight}"
            );
        }
    }

    #[test]
    fn recent_events_yield_higher_confidence_than_old_events() {
        // Same number of events, same outcome mix, but one anchor's events are
        // recent and the other's are old.  Recent events have higher effective
        // weight → higher confidence.
        let recent_events = vec![
            event("recent", AnchorEventKind::Success, 1),
            event("recent", AnchorEventKind::Failure, 2),
            event("recent", AnchorEventKind::Success, 3),
        ];
        let old_events = vec![
            event("old", AnchorEventKind::Success, 200),
            event("old", AnchorEventKind::Failure, 210),
            event("old", AnchorEventKind::Success, 220),
        ];

        let c_recent = compute_reliability_score("recent", &recent_events, &cfg())
            .unwrap()
            .confidence;
        let c_old = compute_reliability_score("old", &old_events, &cfg())
            .unwrap()
            .confidence;

        assert!(
            c_recent > c_old,
            "recent events ({c_recent}) should yield higher confidence than old events ({c_old})"
        );
    }
}
