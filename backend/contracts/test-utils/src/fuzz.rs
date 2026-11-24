//! Model-based invariant fuzzing helpers shared by every fund-holding
//! contract (escrow, bounty, insurance) — issue #1723.
//!
//! No external fuzzing crate is used: a deterministic SplitMix64 generator
//! drives random operation sequences, so every failure is reproducible from
//! its seed alone.
//!
//! * `FUZZ_ITERATIONS` — number of random seeds per harness (default 32;
//!   the nightly workflow raises it).
//! * `FUZZ_SEED` — run exactly one seed (reproduce a failure).
//!
//! Each harness also runs its `REGRESSION_SEEDS` list first. When a seed
//! fails, the panic message prints it: add it to that list so it is replayed
//! on every CI run from then on.

use std::string::String;
use std::vec::Vec;

/// Deterministic SplitMix64 PRNG.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `lo..=hi`.
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        assert!(lo <= hi);
        lo + self.next_u64() % (hi - lo + 1)
    }

    /// Uniform in `lo..=hi` for token amounts.
    pub fn amount(&mut self, lo: i128, hi: i128) -> i128 {
        self.range(lo as u64, hi as u64) as i128
    }

    /// `true` with probability `pct` / 100.
    pub fn chance(&mut self, pct: u64) -> bool {
        self.range(0, 99) < pct
    }

    /// Index into a collection of length `len` (> 0).
    pub fn index(&mut self, len: usize) -> usize {
        assert!(len > 0);
        (self.next_u64() % len as u64) as usize
    }

    /// Split `total` into `parts` positive integers summing to `total`.
    /// Requires `parts <= total`.
    pub fn split(&mut self, total: i128, parts: usize) -> Vec<i128> {
        assert!(parts > 0 && (parts as i128) <= total);
        let mut cuts: Vec<i128> = Vec::new();
        while cuts.len() < parts - 1 {
            let c = self.amount(1, total - 1);
            if !cuts.contains(&c) {
                cuts.push(c);
            }
        }
        cuts.sort();
        let mut out = Vec::with_capacity(parts);
        let mut prev = 0;
        for c in cuts {
            out.push(c - prev);
            prev = c;
        }
        out.push(total - prev);
        out
    }
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name).ok().and_then(|v| v.parse().ok())
}

/// Seeds to run: `FUZZ_SEED` alone if set, otherwise the regression seeds
/// followed by `FUZZ_ITERATIONS` derived seeds.
pub fn seeds(name: &str, regression: &[u64]) -> Vec<u64> {
    if let Some(seed) = env_u64("FUZZ_SEED") {
        return std::vec![seed];
    }
    let iterations = env_u64("FUZZ_ITERATIONS").unwrap_or(32);
    // Derive per-harness seeds from the name so harnesses don't share streams.
    let mut base = Rng::new(name.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x1000_0000_01b3)
    }));
    let mut out: Vec<u64> = regression.to_vec();
    out.extend((0..iterations).map(|_| base.next_u64()));
    out
}

/// Run `case` once per seed; on failure, re-panic with the seed in the message
/// so it can be pinned as a regression seed.
pub fn run_seeds<F: Fn(u64)>(name: &str, regression: &[u64], case: F) {
    for seed in seeds(name, regression) {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| case(seed)));
        if let Err(err) = result {
            let msg: String = err
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| err.downcast_ref::<&str>().map(|s| String::from(*s)))
                .unwrap_or_default();
            panic!(
                "fuzz harness `{name}` failed for seed {seed} (reproduce with FUZZ_SEED={seed}; \
                 add it to REGRESSION_SEEDS): {msg}"
            );
        }
    }
}

/// Assert that `check` panics — used to prove an invariant checker catches an
/// injected bug (state tampered behind the contract's back).
pub fn assert_detects<F: FnOnce()>(what: &str, check: F) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(check));
    assert!(result.is_err(), "invariant checker failed to detect injected bug: {what}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_sums_to_total_and_is_positive() {
        let mut rng = Rng::new(7);
        for _ in 0..200 {
            let total = rng.amount(10, 10_000);
            let parts = rng.range(1, 10) as usize;
            let s = rng.split(total, parts);
            assert_eq!(s.len(), parts);
            assert_eq!(s.iter().sum::<i128>(), total);
            assert!(s.iter().all(|p| *p > 0));
        }
    }

    #[test]
    fn rng_is_deterministic() {
        let a: Vec<u64> = { let mut r = Rng::new(1); (0..5).map(|_| r.next_u64()).collect() };
        let b: Vec<u64> = { let mut r = Rng::new(1); (0..5).map(|_| r.next_u64()).collect() };
        assert_eq!(a, b);
    }

    #[test]
    fn run_seeds_reports_failing_seed() {
        let r = std::panic::catch_unwind(|| run_seeds("t", &[42], |s| assert!(s != 42)));
        assert!(r.is_err());
    }
}
