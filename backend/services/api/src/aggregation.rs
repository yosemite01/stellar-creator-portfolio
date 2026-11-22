//! Corridor aggregation with slippage metrics.
//!
//! ## Issue #425 – Missing slippage calculation in corridors
//! Previously the corridor aggregator only measured success rates.  This
//! module adds slippage tracking: for each transaction we compare the
//! *quoted* exchange rate against the *executed* rate and accumulate
//! historical slippage statistics per corridor.
//!
//! ## Issue #1818 – Move heavy aggregation off the request path
//! Aggregations are no longer recomputed on every request.  Instead a
//! [`CorridorAggregateStore`] holds *materialised* aggregates that are
//! updated incrementally from events (see [`CorridorAggregateStore::apply_event`])
//! and refreshed by background jobs (see [`CorridorAggregateStore::rebuild`]).
//! Reads are served from the store (a cache) so the request path only does a
//! cheap lookup instead of a full scan over transactions.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

// ── Materialised aggregates (Issue #1818) ─────────────────────────────────────

/// Running accumulators for a single corridor.
///
/// These are the *materialised* state kept per corridor so that reads never
/// need to scan the full transaction history.  They are updated incrementally
/// from events and can be rebuilt from scratch by a background job.
#[derive(Clone, Debug, Default)]
struct CorridorAccumulator {
    total: usize,
    successful: usize,
    /// Sum of slippage fractions (for the mean).
    slippage_sum: f64,
    /// Sum of squared slippage fractions (for the variance).
    slippage_sq_sum: f64,
    max_slippage: f64,
    min_slippage: f64,
    slippage_count: usize,
}

impl CorridorAccumulator {
    fn new() -> Self {
        Self {
            max_slippage: f64::NEG_INFINITY,
            min_slippage: f64::INFINITY,
            ..Self::default()
        }
    }

    /// Fold a single transaction into the accumulator.
    fn record(&mut self, tx: &CorridorTransaction) {
        self.total += 1;
        if tx.success {
            self.successful += 1;
        }
        if let Some(slip) = tx.slippage_fraction() {
            self.slippage_sum += slip;
            self.slippage_sq_sum += slip * slip;
            self.max_slippage = self.max_slippage.max(slip);
            self.min_slippage = self.min_slippage.min(slip);
            self.slippage_count += 1;
        }
    }

    /// Produce the public metrics view from the accumulated state.
    fn to_metrics(&self, corridor_id: &str) -> Option<CorridorMetrics> {
        if self.total == 0 {
            return None;
        }
        let round4 = |v: f64| (v * 10_000.0).round() / 10_000.0;
        let success_rate = self.successful as f64 / self.total as f64;

        let (mean_slip, max_slip, min_slip, std_dev) = if self.slippage_count == 0 {
            (0.0, 0.0, 0.0, 0.0)
        } else {
            let n = self.slippage_count as f64;
            let mean = self.slippage_sum / n;
            let variance = if self.slippage_count < 2 {
                0.0
            } else {
                // Sample variance from running sums.
                let num = self.slippage_sq_sum - (self.slippage_sum * self.slippage_sum) / n;
                (num / (n - 1.0)).max(0.0)
            };
            (mean, self.max_slippage, self.min_slippage, variance.sqrt())
        };

        Some(CorridorMetrics {
            corridor_id: corridor_id.to_string(),
            total_transactions: self.total,
            successful_transactions: self.successful,
            success_rate: round4(success_rate),
            mean_slippage_fraction: round4(mean_slip),
            mean_slippage_bps: round4(mean_slip * 10_000.0),
            max_slippage_fraction: round4(max_slip),
            min_slippage_fraction: round4(min_slip),
            slippage_std_dev: round4(std_dev),
            slippage_sample_count: self.slippage_count,
        })
    }
}

/// A domain event that mutates the materialised aggregates.
///
/// Every state change that affects corridor metrics emits one of these; the
/// store applies them incrementally instead of recomputing from scratch.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum CorridorEvent {
    /// A transaction settled through a corridor.
    TransactionSettled(CorridorTransaction),
}

/// Materialised aggregate store with an in-memory cache.
///
/// Reads ([`get`](Self::get) / [`all`](Self::all)) are served from the cached
/// metrics and never touch the raw transaction history, keeping the request
/// path cheap.  Writes happen off the request path via [`apply_event`] and
/// [`rebuild`].
///
/// [`apply_event`]: Self::apply_event
/// [`rebuild`]: Self::rebuild
#[derive(Debug, Default)]
pub struct CorridorAggregateStore {
    accumulators: HashMap<String, CorridorAccumulator>,
    /// Cached, sorted metrics view.  Invalidated on every mutation.
    cache: Option<Vec<CorridorMetrics>>,
}

impl CorridorAggregateStore {
    /// Create an empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply a single event, updating the materialised aggregate incrementally.
    pub fn apply_event(&mut self, event: CorridorEvent) {
        match event {
            CorridorEvent::TransactionSettled(tx) => {
                self.accumulators
                    .entry(tx.corridor_id.clone())
                    .or_insert_with(CorridorAccumulator::new)
                    .record(&tx);
                self.cache = None;
            }
        }
    }

    /// Rebuild the materialised aggregates from a full transaction history.
    ///
    /// Intended to be run by a background job (e.g. on startup or periodically)
    /// so the request path never performs the full scan.
    pub fn rebuild(&mut self, transactions: &[CorridorTransaction]) {
        self.accumulators.clear();
        for tx in transactions {
            self.accumulators
                .entry(tx.corridor_id.clone())
                .or_insert_with(CorridorAccumulator::new)
                .record(tx);
        }
        self.cache = None;
    }

    /// Read the cached metrics for a single corridor.
    pub fn get(&mut self, corridor_id: &str) -> Option<CorridorMetrics> {
        self.ensure_cache();
        self.cache
            .as_ref()
            .and_then(|all| all.iter().find(|m| m.corridor_id == corridor_id).cloned())
    }

    /// Read all cached metrics, sorted by `mean_slippage_bps` ascending.
    pub fn all(&mut self) -> Vec<CorridorMetrics> {
        self.ensure_cache();
        self.cache.clone().unwrap_or_default()
    }

    /// Populate the cache from the accumulators if it is stale.
    fn ensure_cache(&mut self) {
        if self.cache.is_some() {
            return;
        }
        let mut metrics: Vec<CorridorMetrics> = self
            .accumulators
            .iter()
            .filter_map(|(id, acc)| acc.to_metrics(id))
            .collect();
        metrics.sort_by(|a, b| {
            a.mean_slippage_bps
                .partial_cmp(&b.mean_slippage_bps)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        self.cache = Some(metrics);
    }
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
        assert!(aggregate_corridor("EUR-BRL", &txs).is_none());
    }

    // ── CorridorAggregateStore (Issue #1818) ──────────────────────────────────

    #[test]
    fn store_incremental_matches_batch_aggregation() {
        let txs = vec![
            tx("USD-MXN", 17.5, 17.0, true),
            tx("USD-MXN", 17.5, 17.5, true),
            tx("USD-MXN", 17.5, 18.0, false),
            tx("EUR-BRL", 5.4, 5.3, true),
        ];

        let mut store = CorridorAggregateStore::new();
        for t in &txs {
            store.apply_event(CorridorEvent::TransactionSettled(t.clone()));
        }

        let batch = aggregate_all_corridors(&txs);
        let cached = store.all();
        assert_eq!(cached.len(), batch.len());
        for (a, b) in cached.iter().zip(batch.iter()) {
            assert_eq!(a.corridor_id, b.corridor_id);
            assert_eq!(a.total_transactions, b.total_transactions);
            assert_eq!(a.successful_transactions, b.successful_transactions);
            assert_eq!(a.slippage_sample_count, b.slippage_sample_count);
            assert!((a.mean_slippage_fraction - b.mean_slippage_fraction).abs() < 1e-9);
            assert!((a.slippage_std_dev - b.slippage_std_dev).abs() < 1e-9);
        }
    }

    #[test]
    fn store_rebuild_matches_incremental() {
        let txs = vec![
            tx("USD-MXN", 17.5, 17.0, true),
            tx("USD-MXN", 17.5, 18.0, true),
        ];

        let mut incremental = CorridorAggregateStore::new();
        for t in &txs {
            incremental.apply_event(CorridorEvent::TransactionSettled(t.clone()));
        }

        let mut rebuilt = CorridorAggregateStore::new();
        rebuilt.rebuild(&txs);

        assert_eq!(incremental.all(), rebuilt.all());
    }

    #[test]
    fn store_get_returns_none_for_unknown_corridor() {
        let mut store = CorridorAggregateStore::new();
        store.apply_event(CorridorEvent::TransactionSettled(tx("USD-MXN", 17.5, 17.5, true)));
        assert!(store.get("EUR-BRL").is_none());
        assert!(store.get("USD-MXN").is_some());
    }

    #[test]
    fn store_cache_invalidated_on_new_event() {
        let mut store = CorridorAggregateStore::new();
        store.apply_event(CorridorEvent::TransactionSettled(tx("USD-MXN", 17.5, 17.5, true)));
        assert_eq!(store.get("USD-MXN").unwrap().total_transactions, 1);

        store.apply_event(CorridorEvent::TransactionSettled(tx("USD-MXN", 17.5, 17.5, true)));
        assert_eq!(store.get("USD-MXN").unwrap().total_transactions, 2);
    }
}
