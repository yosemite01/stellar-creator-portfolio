//! Corridor aggregation with slippage metrics.
//!
//! ## Issue #425 – Missing slippage calculation in corridors
//! Previously the corridor aggregator only measured success rates.  This
//! module adds slippage tracking: for each transaction we compare the
//! *quoted* exchange rate against the *executed* rate and accumulate
//! historical slippage statistics per corridor.

use serde::{Deserialize, Serialize};

// ── Transaction record ────────────────────────────────────────────────────────

/// A single payment transaction through a corridor.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CorridorTransaction {
    /// Corridor identifier, e.g. `"USD-MXN"`.
    pub corridor_id: String,
    /// Exchange rate quoted to the sender before the transaction.
    pub quoted_rate: f64,
    /// Exchange rate actually applied when the transaction settled.
    pub executed_rate: f64,
    /// Whether the transaction completed successfully.
    pub success: bool,
    /// Unix timestamp (seconds) of the transaction.
    pub timestamp_secs: u64,
}

impl CorridorTransaction {
    /// Slippage as a fraction of the quoted rate.
    ///
    /// Positive → executed rate was *worse* than quoted (cost the sender more).
    /// Negative → executed rate was *better* than quoted (sender got a bonus).
    ///
    /// Returns `None` when `quoted_rate` is zero to avoid division by zero.
    pub fn slippage_fraction(&self) -> Option<f64> {
        if self.quoted_rate == 0.0 {
            return None;
        }
        Some((self.quoted_rate - self.executed_rate) / self.quoted_rate)
    }

    /// Slippage expressed in basis points (1 bp = 0.01 %).
    pub fn slippage_bps(&self) -> Option<f64> {
        self.slippage_fraction().map(|f| f * 10_000.0)
    }
}

// ── Aggregated corridor metrics ───────────────────────────────────────────────

/// Aggregated performance and slippage metrics for a single corridor.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorridorMetrics {
    /// Corridor identifier.
    pub corridor_id: String,
    /// Total number of transactions observed.
    pub total_transactions: usize,
    /// Number of successful transactions.
    pub successful_transactions: usize,
    /// Success rate in [0.0, 1.0].
    pub success_rate: f64,
    /// Mean slippage fraction across all transactions with a valid quoted rate.
    /// Positive = sender paid more than quoted on average.
    pub mean_slippage_fraction: f64,
    /// Mean slippage in basis points.
    pub mean_slippage_bps: f64,
    /// Maximum (worst) slippage fraction observed.
    pub max_slippage_fraction: f64,
    /// Minimum (best / most negative) slippage fraction observed.
    pub min_slippage_fraction: f64,
    /// Standard deviation of slippage fractions (0.0 when < 2 samples).
    pub slippage_std_dev: f64,
    /// Number of transactions where slippage data was available.
    pub slippage_sample_count: usize,
}

// ── Core aggregation ──────────────────────────────────────────────────────────

/// Aggregate corridor metrics from a slice of transactions.
///
/// Returns `None` when `transactions` is empty.
pub fn aggregate_corridor(
    corridor_id: &str,
    transactions: &[CorridorTransaction],
) -> Option<CorridorMetrics> {
    let relevant: Vec<&CorridorTransaction> = transactions
        .iter()
        .filter(|t| t.corridor_id == corridor_id)
        .collect();

    if relevant.is_empty() {
        return None;
    }

    let total = relevant.len();
    let successful = relevant.iter().filter(|t| t.success).count();
    let success_rate = successful as f64 / total as f64;

    // Collect slippage samples (skip zero-quoted-rate entries)
    let slippages: Vec<f64> = relevant
        .iter()
        .filter_map(|t| t.slippage_fraction())
        .collect();

    let (mean_slip, max_slip, min_slip, std_dev) = if slippages.is_empty() {
        (0.0, 0.0, 0.0, 0.0)
    } else {
        let n = slippages.len() as f64;
        let mean = slippages.iter().sum::<f64>() / n;
        let max = slippages.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let min = slippages.iter().cloned().fold(f64::INFINITY, f64::min);
        let variance = if slippages.len() < 2 {
            0.0
        } else {
            slippages.iter().map(|s| (s - mean).powi(2)).sum::<f64>() / (n - 1.0)
        };
        (mean, max, min, variance.sqrt())
    };

    let round4 = |v: f64| (v * 10_000.0).round() / 10_000.0;

    Some(CorridorMetrics {
        corridor_id: corridor_id.to_string(),
        total_transactions: total,
        successful_transactions: successful,
        success_rate: round4(success_rate),
        mean_slippage_fraction: round4(mean_slip),
        mean_slippage_bps: round4(mean_slip * 10_000.0),
        max_slippage_fraction: round4(max_slip),
        min_slippage_fraction: round4(min_slip),
        slippage_std_dev: round4(std_dev),
        slippage_sample_count: slippages.len(),
    })
}

/// Aggregate metrics for every distinct corridor present in `transactions`.
///
/// Results are sorted by `mean_slippage_bps` ascending (lowest slippage first).
pub fn aggregate_all_corridors(transactions: &[CorridorTransaction]) -> Vec<CorridorMetrics> {
    let mut seen = std::collections::HashSet::new();
    let mut ids: Vec<&str> = Vec::new();
    for t in transactions {
        if seen.insert(t.corridor_id.as_str()) {
            ids.push(&t.corridor_id);
        }
    }

    let mut metrics: Vec<CorridorMetrics> = ids
        .into_iter()
        .filter_map(|id| aggregate_corridor(id, transactions))
        .collect();

    // Lowest average slippage first (best corridors at the top)
    metrics.sort_by(|a, b| {
        a.mean_slippage_bps
            .partial_cmp(&b.mean_slippage_bps)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    metrics
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn tx(corridor: &str, quoted: f64, executed: f64, success: bool) -> CorridorTransaction {
        CorridorTransaction {
            corridor_id: corridor.to_string(),
            quoted_rate: quoted,
            executed_rate: executed,
            success,
            timestamp_secs: 1_745_000_000,
        }
    }

    // ── slippage_fraction ─────────────────────────────────────────────────────

    #[test]
    fn slippage_fraction_zero_when_rates_match() {
        let t = tx("USD-MXN", 17.5, 17.5, true);
        assert_eq!(t.slippage_fraction(), Some(0.0));
    }

    #[test]
    fn slippage_fraction_positive_when_executed_worse() {
        // Quoted 17.5, got 17.0 → sender received less
        let t = tx("USD-MXN", 17.5, 17.0, true);
        let slip = t.slippage_fraction().unwrap();
        assert!(slip > 0.0, "expected positive slippage, got {slip}");
    }

    #[test]
    fn slippage_fraction_negative_when_executed_better() {
        // Quoted 17.5, got 18.0 → sender received more
        let t = tx("USD-MXN", 17.5, 18.0, true);
        let slip = t.slippage_fraction().unwrap();
        assert!(slip < 0.0, "expected negative slippage, got {slip}");
    }

    #[test]
    fn slippage_fraction_none_for_zero_quoted_rate() {
        let t = tx("USD-MXN", 0.0, 17.0, true);
        assert_eq!(t.slippage_fraction(), None);
    }

    #[test]
    fn slippage_bps_matches_fraction_times_10000() {
        let t = tx("USD-MXN", 17.5, 17.0, true);
        let frac = t.slippage_fraction().unwrap();
        let bps = t.slippage_bps().unwrap();
        assert!((bps - frac * 10_000.0).abs() < 1e-9);
    }

    // ── aggregate_corridor ────────────────────────────────────────────────────

    #[test]
    fn aggregate_returns_none_for_empty_input() {
        assert!(aggregate_corridor("USD-MXN", &[]).is_none());
    }

    #[test]
    fn aggregate_returns_none_for_unknown_corridor() {
        let txs = vec![tx("USD-MXN", 17.5, 17.5, true)];
        assert!(aggregate_corridor("EUR-GBP", &txs).is_none());
    }

    #[test]
    fn aggregate_success_rate_correct() {
        let txs = vec![
            tx("USD-MXN", 17.5, 17.5, true),
            tx("USD-MXN", 17.5, 17.5, true),
            tx("USD-MXN", 17.5, 17.5, false),
            tx("USD-MXN", 17.5, 17.5, false),
        ];
        let m = aggregate_corridor("USD-MXN", &txs).unwrap();
        assert_eq!(m.total_transactions, 4);
        assert_eq!(m.successful_transactions, 2);
        assert_eq!(m.success_rate, 0.5);
    }

    #[test]
    fn aggregate_mean_slippage_correct() {
        // Two transactions: +2.86% and -2.86% slippage → mean ≈ 0
        let txs = vec![
            tx("USD-MXN", 17.5, 17.0, true),  // positive slip
            tx("USD-MXN", 17.5, 18.0, true),  // negative slip
        ];
        let m = aggregate_corridor("USD-MXN", &txs).unwrap();
        assert!(m.mean_slippage_fraction.abs() < 0.001, "mean should be ~0");
        assert_eq!(m.slippage_sample_count, 2);
    }

    #[test]
    fn aggregate_max_min_slippage_correct() {
        let txs = vec![
            tx("USD-MXN", 10.0, 9.0, true),   // +10% slip
            tx("USD-MXN", 10.0, 10.5, true),  // -5% slip
            tx("USD-MXN", 10.0, 10.0, true),  // 0% slip
        ];
        let m = aggregate_corridor("USD-MXN", &txs).unwrap();
        assert!((m.max_slippage_fraction - 0.1).abs() < 0.001);
        assert!((m.min_slippage_fraction - (-0.05)).abs() < 0.001);
    }

    #[test]
    fn aggregate_std_dev_zero_for_single_sample() {
        let txs = vec![tx("USD-MXN", 17.5, 17.0, true)];
        let m = aggregate_corridor("USD-MXN", &txs).unwrap();
        assert_eq!(m.slippage_std_dev, 0.0);
    }

    #[test]
    fn aggregate_skips_zero_quoted_rate_for_slippage() {
        let txs = vec![
            tx("USD-MXN", 0.0, 17.0, true),  // no slippage data
            tx("USD-MXN", 17.5, 17.0, true), // valid slippage
        ];
        let m = aggregate_corridor("USD-MXN", &txs).unwrap();
        assert_eq!(m.slippage_sample_count, 1);
        assert_eq!(m.total_transactions, 2);
    }

    // ── aggregate_all_corridors ───────────────────────────────────────────────

    #[test]
    fn aggregate_all_sorted_by_mean_slippage_ascending() {
        let txs = vec![
            tx("HIGH-SLIP", 10.0, 8.0, true),  // 20% slip
            tx("LOW-SLIP", 10.0, 9.9, true),   // 1% slip
            tx("MID-SLIP", 10.0, 9.0, true),   // 10% slip
        ];
        let metrics = aggregate_all_corridors(&txs);
        assert_eq!(metrics.len(), 3);
        assert_eq!(metrics[0].corridor_id, "LOW-SLIP");
        assert_eq!(metrics[2].corridor_id, "HIGH-SLIP");
    }

    #[test]
    fn aggregate_all_empty_returns_empty() {
        assert!(aggregate_all_corridors(&[]).is_empty());
    }
}
