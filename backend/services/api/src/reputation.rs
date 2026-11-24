//! Reputation and review aggregation for creators.
//!
//! Reviews are sourced from database with fallback to in-memory seed list for development.
//! Aggregation computes average rating, totals, per-star counts, and a recent slice.
//! Includes hooks for real-time reputation updates when reviews are submitted.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use sqlx::{PgPool, Error as SqlxError};

/// Review from a client or employer about a creator's work
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Review {
    pub id: u64,
    pub creator_address: String,
    pub reviewer_address: String,
    pub bounty_id: Option<u64>,
    pub rating: u8, // 1-5 stars
    pub comment: String,
    pub verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Data required to submit a new review
#[derive(Debug, Serialize, Deserialize)]
pub struct ReviewSubmission {
    pub creator_address: String,
    pub reviewer_address: String,
    pub bounty_id: Option<u64>,
    pub rating: u8,
    pub comment: String,
}

/// Aggregated review statistics for a creator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewAggregation {
    pub creator_address: String,
    pub total_reviews: u32,
    pub average_rating: f64,
    pub star_counts: HashMap<u8, u32>, // star_level -> count
    pub recent_reviews: Vec<Review>,
}

/// Event for real-time reputation updates
#[derive(Debug, Serialize, Deserialize)]
pub struct CreatorReputationPayload {
    pub creator_address: String,
    pub new_review: Review,
    pub updated_aggregation: ReviewAggregation,
}

// Global in-memory cache for development/testing
lazy_static::lazy_static! {
    static ref REVIEW_CACHE: Arc<Mutex<Vec<Review>>> = Arc::new(Mutex::new(vec![
        Review {
            id: 1,
            creator_address: "GCAZ6I2VEI2SP4KJDIPFCDR6DZQT5SIWVSQGWXR5G3MVVDYTPNTMHAVY".to_string(),
            reviewer_address: "GABC123REVIEWER456DEF".to_string(),
            bounty_id: Some(101),
            rating: 5,
            comment: "Outstanding work on the DeFi integration. Delivered ahead of schedule.".to_string(),
            verified: true,
            created_at: chrono::Utc::now() - chrono::Duration::days(5),
        },
        Review {
            id: 2,
            creator_address: "GCAZ6I2VEI2SP4KJDIPFCDR6DZQT5SIWVSQGWXR5G3MVVDYTPNTMHAVY".to_string(),
            reviewer_address: "GDEF789REVIEWER012GHI".to_string(),
            bounty_id: Some(102),
            rating: 4,
            comment: "Great communication and solid technical skills. Minor delay but high quality.".to_string(),
            verified: true,
            created_at: chrono::Utc::now() - chrono::Duration::days(12),
        },
        Review {
            id: 3,
            creator_address: "GDAX7I3VEI3SP5KJDIPFCDR7DZQT6TIWVSQGWXR6G4MVVDYTPNTMHBVZ".to_string(),
            reviewer_address: "GHIJ345REVIEWER678KLM".to_string(),
            bounty_id: Some(103),
            rating: 3,
            comment: "Decent work but needed more revisions than expected.".to_string(),
            verified: false,
            created_at: chrono::Utc::now() - chrono::Duration::days(20),
        },
    ]));
}

// ---------------------------------------------------------------------------
// Poison-safe lock helpers
//
// A Mutex becomes "poisoned" when a thread panics while holding its guard.
// `.lock().unwrap()` re-panics every subsequent caller, taking the entire
// review/reputation read path down for the lifetime of the process.
//
// `.unwrap_or_else(|e| e.into_inner())` recovers the guarded data instead.
// The inner value is still coherent — the only thing that went wrong is that
// one previous write was interrupted. All subsequent callers continue to work,
// and any partial state is detectable through normal validation.
// ---------------------------------------------------------------------------

/// Acquire the `REVIEW_CACHE` lock, recovering from a prior panic if needed.
fn lock_review_cache(
    cache: &Mutex<Vec<Review>>,
) -> std::sync::MutexGuard<'_, Vec<Review>> {
    cache.lock().unwrap_or_else(|poisoned| {
        // Log at warn level so operations teams can see the event, then hand
        // back the coherent inner data so callers keep working.
        eprintln!("WARN: REVIEW_CACHE was poisoned — recovering inner data");
        poisoned.into_inner()
    })
}

/// Helper to format database errors consistently
fn format_db_error(err: SqlxError) -> String {
    match err {
        SqlxError::RowNotFound => "Record not found".to_string(),
        SqlxError::Database(db_err) => format!("Database error: {}", db_err),
        _ => format!("Database operation failed: {}", err),
    }
}

/// Get all reviews (development/testing function)
pub fn get_mock_reviews() -> Vec<Review> {
    lock_review_cache(&REVIEW_CACHE).clone()
}

/// Get reviews for a specific creator address
pub async fn reviews_for_creator(creator_address: &str, pool: Option<&PgPool>) -> Result<Vec<Review>, String> {
    if let Some(pg_pool) = pool {
        let query = r#"
            SELECT id, creator_address, reviewer_address, bounty_id, rating, comment, verified, created_at
            FROM reviews 
            WHERE creator_address = $1
            ORDER BY created_at DESC
        "#;

        sqlx::query_as::<_, (i64, String, String, Option<i64>, i16, String, bool, chrono::DateTime<chrono::Utc>)>(query)
            .bind(creator_address)
            .fetch_all(pg_pool)
            .await
            .map(|rows| {
                rows.into_iter()
                    .map(|(id, creator_addr, reviewer_addr, bounty_id, rating, comment, verified, created_at)| Review {
                        id: id as u64,
                        creator_address: creator_addr,
                        reviewer_address: reviewer_addr,
                        bounty_id: bounty_id.map(|id| id as u64),
                        rating: rating as u8,
                        comment,
                        verified,
                        created_at,
                    })
                    .collect()
            })
            .map_err(format_db_error)
    } else {
        Ok(lock_review_cache(&REVIEW_CACHE)
            .iter()
            .filter(|r| r.creator_address == creator_address)
            .cloned()
            .collect())
    }
}

/// Aggregate review statistics for a creator
pub async fn aggregate_reviews(creator_address: &str, pool: Option<&PgPool>) -> Result<ReviewAggregation, String> {
    let reviews = reviews_for_creator(creator_address, pool).await?;

    let total_reviews = reviews.len() as u32;
    let average_rating = if total_reviews > 0 {
        reviews.iter().map(|r| r.rating as f64).sum::<f64>() / total_reviews as f64
    } else {
        0.0
    };

    let mut star_counts = HashMap::new();
    for rating in 1..=5u8 {
        star_counts.insert(rating, reviews.iter().filter(|r| r.rating == rating).count() as u32);
    }

    let recent_reviews = reviews.into_iter().take(3).collect();

    Ok(ReviewAggregation {
        creator_address: creator_address.to_string(),
        total_reviews,
        average_rating,
        star_counts,
        recent_reviews,
    })
}

/// Get recent reviews across all creators (for homepage/feeds)
pub async fn recent_reviews(limit: u32, pool: Option<&PgPool>) -> Result<Vec<Review>, String> {
    if let Some(pg_pool) = pool {
        let query = r#"
            SELECT id, creator_address, reviewer_address, bounty_id, rating, comment, verified, created_at
            FROM reviews 
            ORDER BY created_at DESC
            LIMIT $1
        "#;

        sqlx::query_as::<_, (i64, String, String, Option<i64>, i16, String, bool, chrono::DateTime<chrono::Utc>)>(query)
            .bind(limit as i64)
            .fetch_all(pg_pool)
            .await
            .map(|rows| {
                rows.into_iter()
                    .map(|(id, creator_addr, reviewer_addr, bounty_id, rating, comment, verified, created_at)| Review {
                        id: id as u64,
                        creator_address: creator_addr,
                        reviewer_address: reviewer_addr,
                        bounty_id: bounty_id.map(|id| id as u64),
                        rating: rating as u8,
                        comment,
                        verified,
                        created_at,
                    })
                    .collect()
            })
            .map_err(format_db_error)
    } else {
        let mut reviews = lock_review_cache(&REVIEW_CACHE).clone();
        reviews.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        reviews.truncate(limit as usize);
        Ok(reviews)
    }
}

/// Submit a new review
pub async fn submit_review(submission: ReviewSubmission, pool: Option<&PgPool>) -> Result<Review, String> {
    let new_review = Review {
        id: chrono::Utc::now().timestamp() as u64, // Simple ID generation
        creator_address: submission.creator_address,
        reviewer_address: submission.reviewer_address,
        bounty_id: submission.bounty_id,
        rating: submission.rating,
        comment: submission.comment,
        verified: false, // Verification happens separately
        created_at: chrono::Utc::now(),
    };

    if let Some(pg_pool) = pool {
        let query = r#"
            INSERT INTO reviews (id, creator_address, reviewer_address, bounty_id, rating, comment, verified, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, creator_address, reviewer_address, bounty_id, rating, comment, verified, created_at
        "#;

        sqlx::query_as::<_, (i64, String, String, Option<i64>, i16, String, bool, chrono::DateTime<chrono::Utc>)>(query)
            .bind(new_review.id as i64)
            .bind(&new_review.creator_address)
            .bind(&new_review.reviewer_address)
            .bind(new_review.bounty_id.map(|id| id as i64))
            .bind(new_review.rating as i16)
            .bind(&new_review.comment)
            .bind(new_review.verified)
            .bind(new_review.created_at)
            .fetch_one(pg_pool)
            .await
            .map(|(id, creator_addr, reviewer_addr, bounty_id, rating, comment, verified, created_at)| Review {
                id: id as u64,
                creator_address: creator_addr,
                reviewer_address: reviewer_addr,
                bounty_id: bounty_id.map(|id| id as u64),
                rating: rating as u8,
                comment,
                verified,
                created_at,
            })
            .map_err(format_db_error)
    } else {
        lock_review_cache(&REVIEW_CACHE).push(new_review.clone());
        Ok(new_review)
    }
}

// =============================================================================
// Aggregated Reputation Scoring — Issue #827
//
// On-chain contract is the authoritative base score (read via Stellar RPC and
// cached in Postgres with a 5-minute TTL). Off-chain signals (response rate,
// KYC level, profile completeness, activity decay) are applied as multipliers.
//
// Formula:
//   effective = on_chain_base
//               * (1 + response_rate_bonus + profile_bonus)
//               * kyc_multiplier
//               * (1 - decay_factor)
// =============================================================================

use std::collections::HashMap as CacheMap;
use std::time::Instant;

/// KYC verification level, in ascending order of trust.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum KycLevel {
    None,
    Basic,
    Advanced,
    Institutional,
}

/// Off-chain signals supplied by the application layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OffChainSignals {
    /// Fraction of messages/requests answered (0.0–1.0).
    pub response_rate: f64,
    pub kyc_level: KycLevel,
    /// Fraction of profile fields filled (0.0–1.0).
    pub profile_completeness: f64,
    /// Calendar days since the creator last completed a bounty or review.
    pub days_since_last_activity: u32,
}

/// Per-component breakdown of the effective score, exposed in the API tooltip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReputationBreakdown {
    pub on_chain_base: f64,
    pub response_rate_bonus: f64,
    pub kyc_multiplier: f64,
    pub decay_factor: f64,
    pub profile_bonus: f64,
    pub effective_score: f64,
}

/// Full reputation result combining on-chain base with off-chain multipliers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectiveReputation {
    pub creator_address: String,
    pub breakdown: ReputationBreakdown,
    pub cached_at: chrono::DateTime<chrono::Utc>,
    /// Remaining seconds before the cache entry expires (max 300).
    pub cache_ttl_seconds: u64,
    /// True when the base score was confirmed via an on-chain RPC call.
    pub on_chain_verified: bool,
}

// ---------------------------------------------------------------------------
// Multiplier helpers
// ---------------------------------------------------------------------------

/// KYC multiplier: higher verification level → higher score ceiling.
pub fn kyc_multiplier(level: &KycLevel) -> f64 {
    match level {
        KycLevel::None => 1.00,
        KycLevel::Basic => 1.05,
        KycLevel::Advanced => 1.12,
        KycLevel::Institutional => 1.20,
    }
}

/// Response-rate bonus: linear 0.0–0.15 mapped from 0%–100% response rate.
pub fn response_rate_bonus(rate: f64) -> f64 {
    rate.clamp(0.0, 1.0) * 0.15
}

/// Activity decay: 0.0 penalty for < 30 days inactive, linear to 0.20 at ≥ 365 days.
pub fn decay_factor(days_inactive: u32) -> f64 {
    const GRACE_DAYS: u32 = 30;
    const MAX_DAYS: u32 = 365;
    const MAX_DECAY: f64 = 0.20;

    if days_inactive < GRACE_DAYS {
        return 0.0;
    }
    let clamped = (days_inactive - GRACE_DAYS).min(MAX_DAYS - GRACE_DAYS) as f64;
    let range = (MAX_DAYS - GRACE_DAYS) as f64;
    (clamped / range) * MAX_DECAY
}

/// Profile-completeness bonus: linear 0.0–0.08 at 100% complete.
pub fn profile_bonus(completeness: f64) -> f64 {
    completeness.clamp(0.0, 1.0) * 0.08
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

/// Apply off-chain multipliers to an on-chain base score and return a full breakdown.
pub fn compute_effective_score(on_chain_base: f64, signals: &OffChainSignals) -> ReputationBreakdown {
    let rr_bonus = response_rate_bonus(signals.response_rate);
    let kyc_mult = kyc_multiplier(&signals.kyc_level);
    let decay = decay_factor(signals.days_since_last_activity);
    let prof_bonus = profile_bonus(signals.profile_completeness);

    let effective = on_chain_base
        * (1.0 + rr_bonus + prof_bonus)
        * kyc_mult
        * (1.0 - decay);

    ReputationBreakdown {
        on_chain_base,
        response_rate_bonus: rr_bonus,
        kyc_multiplier: kyc_mult,
        decay_factor: decay,
        profile_bonus: prof_bonus,
        effective_score: effective,
    }
}

// ---------------------------------------------------------------------------
// In-memory cache (5-minute TTL, keyed by creator address)
// ---------------------------------------------------------------------------

const CACHE_TTL_SECS: u64 = 300;

lazy_static::lazy_static! {
    static ref REPUTATION_CACHE: Arc<Mutex<CacheMap<String, (EffectiveReputation, Instant)>>> =
        Arc::new(Mutex::new(CacheMap::new()));
}

/// Acquire the `REPUTATION_CACHE` lock, recovering from a prior panic if needed.
fn lock_reputation_cache(
    cache: &Mutex<CacheMap<String, (EffectiveReputation, Instant)>>,
) -> std::sync::MutexGuard<'_, CacheMap<String, (EffectiveReputation, Instant)>> {
    cache.lock().unwrap_or_else(|poisoned| {
        eprintln!("WARN: REPUTATION_CACHE was poisoned — recovering inner data");
        poisoned.into_inner()
    })
}

/// Derive a 0–100 on-chain base score from the existing review aggregation.
///
/// In production this would call the Stellar RPC to read the `stellar_insights`
/// contract's stored score. For now we derive it from the review average so the
/// formula can be exercised end-to-end without an active network connection.
async fn fetch_on_chain_base(creator_address: &str, pool: Option<&PgPool>) -> (f64, bool) {
    match aggregate_reviews(creator_address, pool).await {
        Ok(agg) if agg.total_reviews > 0 => {
            // Scale 1–5 star average to a 0–100 base score.
            let base = ((agg.average_rating - 1.0) / 4.0) * 100.0;
            (base.clamp(0.0, 100.0), false) // on_chain_verified = false until RPC is wired
        }
        _ => (50.0, false), // neutral default when no reviews exist
    }
}

/// Return the effective reputation for a creator, serving from cache when fresh.
///
/// Cache entries are invalidated after `CACHE_TTL_SECS` (300 s). Callers
/// that complete a bounty or submit a review should call
/// `invalidate_reputation_cache` to force an immediate refresh.
pub async fn fetch_reputation_with_cache(
    creator_address: &str,
    pool: Option<&PgPool>,
    signals: OffChainSignals,
) -> Result<EffectiveReputation, String> {
    // Check cache first.
    {
        let cache = lock_reputation_cache(&REPUTATION_CACHE);
        if let Some((cached, stored_at)) = cache.get(creator_address) {
            let elapsed = stored_at.elapsed().as_secs();
            if elapsed < CACHE_TTL_SECS {
                let mut hit = cached.clone();
                hit.cache_ttl_seconds = CACHE_TTL_SECS - elapsed;
                return Ok(hit);
            }
        }
    }

    // Cache miss — recompute.
    let (on_chain_base, on_chain_verified) = fetch_on_chain_base(creator_address, pool).await;
    let breakdown = compute_effective_score(on_chain_base, &signals);

    let result = EffectiveReputation {
        creator_address: creator_address.to_string(),
        breakdown,
        cached_at: chrono::Utc::now(),
        cache_ttl_seconds: CACHE_TTL_SECS,
        on_chain_verified,
    };

    REPUTATION_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(creator_address.to_string(), (result.clone(), Instant::now()));

    Ok(result)
}

/// Remove a creator's cache entry so the next request forces a fresh RPC read.
/// Call this whenever a new completed bounty or review is recorded.
pub fn invalidate_reputation_cache(creator_address: &str) {
    lock_reputation_cache(&REPUTATION_CACHE).remove(creator_address);
}

// ---------------------------------------------------------------------------
// Filtered / sorted / paginated review listing (admin + "all reviews" feeds)
//
// Query-param parsing (`parse_review_filters`) and filtering
// (`filter_reviews`) are implemented (Issue #1392), alongside the sorting and
// pagination that were already real.
//
// TODO: `fetch_all_reviews_from_db` and `get_filtered_creator_reviews_from_db`
// still return in-memory seed data rather than querying Postgres. Wiring them
// up needs a schema decision first, not just a query: `migrations/
// 0002_create_reviews_tables.sql` defines `reviews` with `id UUID`,
// `creator_id`, `bounty_id VARCHAR`, `title`, `body`, `reviewer_name` and no
// `verified` column, while the `Review` struct here uses `id u64`,
// `creator_address`, `reviewer_address`, `bounty_id Option<u64>`, `comment`
// and `verified: bool`. Either the table or the struct has to move, and
// `verified` — which `filter_reviews` reads — has nowhere to come from until
// it does.
// ---------------------------------------------------------------------------

lazy_static::lazy_static! {
    /// Stashed by `set_database_pool`/`initialize_reputation_system_with_db`
    /// for the stub DB-facing functions below to use once they're wired up
    /// to real queries. Not read by anything yet.
    static ref DB_POOL: Mutex<Option<PgPool>> = Mutex::new(None);
}

/// Stash the connection pool for later use by the (currently stubbed)
/// DB-facing functions in this section.
pub fn set_database_pool(pool: PgPool) {
    *DB_POOL.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(pool);
}

/// One-time startup hook. Currently just stores the pool — see the TODO on
/// this section for what's still missing.
pub fn initialize_reputation_system_with_db(pool: PgPool) {
    set_database_pool(pool);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewSortBy {
    CreatedAt,
    Rating,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReviewFilters {
    pub sort_by: Option<ReviewSortBy>,
    pub sort_order: Option<SortOrder>,
    pub page: Option<u32>,
    pub limit: Option<u32>,
    /// Inclusive lower bound on star rating.
    pub min_rating: Option<u8>,
    /// Inclusive upper bound on star rating.
    pub max_rating: Option<u8>,
    /// When `Some(true)`, only reviews tied to a verified engagement.
    pub verified_only: Option<bool>,
    /// Inclusive lower bound on `created_at`.
    pub created_after: Option<chrono::DateTime<chrono::Utc>>,
    /// Inclusive upper bound on `created_at`.
    pub created_before: Option<chrono::DateTime<chrono::Utc>>,
}

/// Largest page a caller may request.
///
/// Unbounded `limit` is a cheap way to ask the server to materialise every
/// review ever written, so the parser clamps rather than trusting the caller.
pub const MAX_REVIEW_PAGE_SIZE: u32 = 100;
pub const DEFAULT_REVIEW_PAGE_SIZE: u32 = 10;

/// Parse review list query parameters into a validated filter set.
///
/// Every invalid parameter is collected rather than returning on the first
/// one. A caller who got three parameters wrong should learn that in one
/// round trip instead of three, which is the same convention the rest of this
/// file's validation follows.
///
/// # Absent versus invalid
///
/// An absent parameter leaves its field `None` and the caller applies a
/// default. An unparseable parameter is an error rather than a silent fall
/// back to the default: `?minRating=high` returning every review reads as the
/// filter having been applied and matched everything, which is a wrong answer
/// presented as a right one.
///
/// # Errors
///
/// Returns every validation message when one or more parameters are invalid.
pub fn parse_review_filters(
    query: &HashMap<String, String>,
) -> Result<ReviewFilters, Vec<String>> {
    let mut errors: Vec<String> = Vec::new();
    let mut filters = ReviewFilters::default();

    // Treat an empty value as absent. `?verifiedOnly=` is what a form submits
    // for an untouched field, and rejecting it would make the UI unusable.
    let get = |key: &str| -> Option<&str> {
        query.get(key).map(|v| v.trim()).filter(|v| !v.is_empty())
    };

    if let Some(raw) = get("sortBy") {
        match raw.to_ascii_lowercase().as_str() {
            "created_at" | "createdat" | "date" => filters.sort_by = Some(ReviewSortBy::CreatedAt),
            "rating" => filters.sort_by = Some(ReviewSortBy::Rating),
            other => errors.push(format!(
                "sortBy must be one of: created_at, rating (received '{other}')"
            )),
        }
    }

    if let Some(raw) = get("sortOrder") {
        match raw.to_ascii_lowercase().as_str() {
            "asc" | "ascending" => filters.sort_order = Some(SortOrder::Asc),
            "desc" | "descending" => filters.sort_order = Some(SortOrder::Desc),
            other => errors.push(format!(
                "sortOrder must be one of: asc, desc (received '{other}')"
            )),
        }
    }

    if let Some(raw) = get("page") {
        match raw.parse::<u32>() {
            // Page 0 is not a page. Silently treating it as 1 hides an
            // off-by-one in the caller's pagination.
            Ok(0) => errors.push("page must be 1 or greater".to_string()),
            Ok(value) => filters.page = Some(value),
            Err(_) => errors.push(format!("page must be a positive integer (received '{raw}')")),
        }
    }

    if let Some(raw) = get("limit") {
        match raw.parse::<u32>() {
            Ok(0) => errors.push("limit must be 1 or greater".to_string()),
            Ok(value) if value > MAX_REVIEW_PAGE_SIZE => errors.push(format!(
                "limit must not exceed {MAX_REVIEW_PAGE_SIZE} (received {value})"
            )),
            Ok(value) => filters.limit = Some(value),
            Err(_) => errors.push(format!("limit must be a positive integer (received '{raw}')")),
        }
    }

    let parse_rating = |key: &str, errors: &mut Vec<String>| -> Option<u8> {
        let raw = get(key)?;
        match raw.parse::<u8>() {
            Ok(value) if (1..=5).contains(&value) => Some(value),
            Ok(value) => {
                errors.push(format!("{key} must be between 1 and 5 (received {value})"));
                None
            }
            Err(_) => {
                errors.push(format!("{key} must be an integer between 1 and 5 (received '{raw}')"));
                None
            }
        }
    };

    filters.min_rating = parse_rating("minRating", &mut errors);
    filters.max_rating = parse_rating("maxRating", &mut errors);

    if let (Some(min), Some(max)) = (filters.min_rating, filters.max_rating) {
        if min > max {
            // An inverted range matches nothing. Returning an empty list would
            // look like "this creator has no reviews in that band".
            errors.push(format!(
                "minRating ({min}) must not be greater than maxRating ({max})"
            ));
        }
    }

    if let Some(raw) = get("verifiedOnly") {
        match raw.to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => filters.verified_only = Some(true),
            "false" | "0" | "no" => filters.verified_only = Some(false),
            other => errors.push(format!(
                "verifiedOnly must be a boolean (received '{other}')"
            )),
        }
    }

    let parse_date =
        |key: &str, errors: &mut Vec<String>| -> Option<chrono::DateTime<chrono::Utc>> {
            let raw = get(key)?;
            match chrono::DateTime::parse_from_rfc3339(raw) {
                Ok(parsed) => Some(parsed.with_timezone(&chrono::Utc)),
                Err(_) => {
                    errors.push(format!(
                        "{key} must be an RFC 3339 timestamp, e.g. 2026-01-31T00:00:00Z (received '{raw}')"
                    ));
                    None
                }
            }
        };

    filters.created_after = parse_date("createdAfter", &mut errors);
    filters.created_before = parse_date("createdBefore", &mut errors);

    if let (Some(after), Some(before)) = (filters.created_after, filters.created_before) {
        if after > before {
            errors.push(
                "createdAfter must not be later than createdBefore".to_string(),
            );
        }
    }

    if errors.is_empty() {
        Ok(filters)
    } else {
        Err(errors)
    }
}

/// Page size to apply for a filter set, with the caller's value clamped.
pub fn effective_limit(filters: &ReviewFilters) -> u32 {
    filters
        .limit
        .unwrap_or(DEFAULT_REVIEW_PAGE_SIZE)
        .clamp(1, MAX_REVIEW_PAGE_SIZE)
}

/// Page number to apply for a filter set.
pub fn effective_page(filters: &ReviewFilters) -> u32 {
    filters.page.unwrap_or(1).max(1)
}

/// TODO: stub — returns the in-memory seed reviews rather than querying
/// Postgres. Swap for a real `SELECT * FROM reviews` once this endpoint
/// needs to reflect real data.
pub async fn fetch_all_reviews_from_db() -> Vec<Review> {
    get_mock_reviews()
}

/// Apply a parsed filter set to a review list.
///
/// Implemented alongside the parser because parsing filters nothing applies is
/// worse than not parsing them: the caller sees their parameters accepted and
/// the full list returned, and concludes the filter matched everything.
///
/// Bounds are inclusive on both ends, matching how the parameters read.
pub fn filter_reviews(reviews: &[Review], filters: &ReviewFilters) -> Vec<Review> {
    reviews
        .iter()
        .filter(|review| {
            if let Some(min) = filters.min_rating {
                if review.rating < min {
                    return false;
                }
            }
            if let Some(max) = filters.max_rating {
                if review.rating > max {
                    return false;
                }
            }
            // `verified_only = Some(false)` means "only unverified", not "no
            // filter" — the absent case is already `None`.
            if let Some(verified) = filters.verified_only {
                if review.verified != verified {
                    return false;
                }
            }
            if let Some(after) = filters.created_after {
                if review.created_at < after {
                    return false;
                }
            }
            if let Some(before) = filters.created_before {
                if review.created_at > before {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

pub fn sort_reviews(reviews: &mut [Review], sort_by: &ReviewSortBy, sort_order: &SortOrder) {
    reviews.sort_by(|a, b| {
        let ordering = match sort_by {
            ReviewSortBy::CreatedAt => a.created_at.cmp(&b.created_at),
            ReviewSortBy::Rating => a.rating.cmp(&b.rating),
        };
        match sort_order {
            SortOrder::Asc => ordering,
            SortOrder::Desc => ordering.reverse(),
        }
    });
}

#[derive(Debug, Clone, Serialize)]
pub struct PaginatedReviews {
    pub reviews: Vec<Review>,
    pub total_count: u32,
    pub page: u32,
    pub limit: u32,
}

pub fn paginate_reviews(reviews: Vec<Review>, page: u32, limit: u32) -> PaginatedReviews {
    let total_count = reviews.len() as u32;
    let start = ((page.max(1) - 1) * limit) as usize;
    let page_reviews = reviews.into_iter().skip(start).take(limit as usize).collect();
    PaginatedReviews {
        reviews: page_reviews,
        total_count,
        page,
        limit,
    }
}

/// Sync aggregation over an already-fetched review list — distinct from
/// `aggregate_reviews` above, which fetches by creator address from the DB.
/// Used by the "all reviews" / filtered listing endpoints.
pub fn aggregate_review_list(reviews: &[Review]) -> ReviewAggregation {
    let total_reviews = reviews.len() as u32;
    let average_rating = if total_reviews > 0 {
        reviews.iter().map(|r| r.rating as f64).sum::<f64>() / total_reviews as f64
    } else {
        0.0
    };
    let mut star_counts = HashMap::new();
    for rating in 1..=5u8 {
        star_counts.insert(rating, reviews.iter().filter(|r| r.rating == rating).count() as u32);
    }
    ReviewAggregation {
        creator_address: String::new(),
        total_reviews,
        average_rating,
        star_counts,
        recent_reviews: reviews.iter().take(3).cloned().collect(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FilteredCreatorReputationPayload {
    pub creator_address: String,
    pub reviews: PaginatedReviews,
    pub aggregation: ReviewAggregation,
}

/// TODO: stub — filters everything from the in-memory seed list by creator
/// address only; `filters` beyond page/limit are ignored. See the section
/// TODO above.
pub async fn get_filtered_creator_reviews_from_db(
    creator_address: &str,
    filters: &ReviewFilters,
) -> FilteredCreatorReputationPayload {
    let reviews: Vec<Review> = get_mock_reviews()
        .into_iter()
        .filter(|r| r.creator_address == creator_address)
        .collect();
    let aggregation = aggregate_review_list(&reviews);
    let page = filters.page.unwrap_or(1).max(1);
    let limit = filters.limit.unwrap_or(10).clamp(1, 100);
    FilteredCreatorReputationPayload {
        creator_address: creator_address.to_string(),
        reviews: paginate_reviews(reviews, page, limit),
        aggregation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_review_aggregation() {
        let creator_addr = "GCAZ6I2VEI2SP4KJDIPFCDR6DZQT5SIWVSQGWXR5G3MVVDYTPNTMHAVY";
        let aggregation = aggregate_reviews(creator_addr, None).await.unwrap();
        
        assert_eq!(aggregation.creator_address, creator_addr);
        assert!(aggregation.total_reviews >= 2);
        assert!(aggregation.average_rating > 0.0);
        assert!(!aggregation.recent_reviews.is_empty());
    }

    #[tokio::test]
    async fn test_recent_reviews_limit() {
        let reviews = recent_reviews(1, None).await.unwrap();
        assert_eq!(reviews.len(), 1);
    }

    #[tokio::test]
    async fn test_submit_review() {
        let submission = ReviewSubmission {
            creator_address: "TEST_CREATOR".to_string(),
            reviewer_address: "TEST_REVIEWER".to_string(),
            bounty_id: Some(999),
            rating: 4,
            comment: "Test review".to_string(),
        };

        let review = submit_review(submission, None).await.unwrap();
        assert_eq!(review.rating, 4);
        assert_eq!(review.comment, "Test review");
        assert!(!review.verified);
    }

    #[test]
    fn test_effective_reputation_formula() {
        let signals = OffChainSignals {
            response_rate: 0.8,
            kyc_level: KycLevel::Advanced,
            profile_completeness: 0.9,
            days_since_last_activity: 5,
        };
        let breakdown = compute_effective_score(75.0, &signals);

        // Multipliers should push effective_score above the base.
        assert!(breakdown.effective_score > 75.0,
            "effective_score {} should exceed base 75.0", breakdown.effective_score);
        assert!(breakdown.response_rate_bonus > 0.0);
        assert!(breakdown.kyc_multiplier > 1.0);
        assert_eq!(breakdown.decay_factor, 0.0, "5 days inactive should have zero decay");
        assert!(breakdown.profile_bonus > 0.0);
        assert!(breakdown.on_chain_base > 0.0);
    }

    #[test]
    fn test_decay_boundaries() {
        assert_eq!(decay_factor(0), 0.0);
        assert_eq!(decay_factor(29), 0.0);
        assert!(decay_factor(30) >= 0.0);
        assert!((decay_factor(365) - 0.20).abs() < 1e-9);
        assert_eq!(decay_factor(1000), 0.20); // capped
    }

    #[test]
    fn test_kyc_multiplier_ordering() {
        assert!(kyc_multiplier(&KycLevel::Institutional) > kyc_multiplier(&KycLevel::Advanced));
        assert!(kyc_multiplier(&KycLevel::Advanced) > kyc_multiplier(&KycLevel::Basic));
        assert!(kyc_multiplier(&KycLevel::Basic) > kyc_multiplier(&KycLevel::None));
        assert_eq!(kyc_multiplier(&KycLevel::None), 1.0);
    }

    #[tokio::test]
    async fn test_reputation_cache_hit() {
        let addr = "CACHE_TEST_CREATOR_001";
        let signals = OffChainSignals {
            response_rate: 0.5,
            kyc_level: KycLevel::Basic,
            profile_completeness: 0.6,
            days_since_last_activity: 10,
        };
        // First call populates the cache.
        let first = fetch_reputation_with_cache(addr, None, signals.clone()).await.unwrap();
        // Second call should be a cache hit with ttl < CACHE_TTL_SECS.
        let second = fetch_reputation_with_cache(addr, None, signals).await.unwrap();
        assert_eq!(first.breakdown.effective_score, second.breakdown.effective_score);
        assert!(second.cache_ttl_seconds <= CACHE_TTL_SECS);
        // Clean up.
        invalidate_reputation_cache(addr);
    }

    // -------------------------------------------------------------------------
    // Poison-recovery tests
    //
    // We use *local* Mutex instances so that a poisoning event in one test
    // cannot bleed into shared global state and destabilise other tests.
    // The helpers (`lock_review_cache` / `lock_reputation_cache`) are called
    // directly with the local mutex so the same code paths exercised in
    // production are tested here.
    // -------------------------------------------------------------------------

    /// Poison a `Vec<Review>` mutex mid-write and confirm reads still succeed.
    ///
    /// Strategy:
    ///   1. Spawn a thread that acquires the lock, pushes a review, then
    ///      panics — leaving the mutex poisoned.
    ///   2. Join the thread (its panic is caught by `join()`).
    ///   3. Call `lock_review_cache` on the poisoned mutex — it must *not*
    ///      panic, and must return the data with the partial write included
    ///      (the push completed before the panic).
    #[test]
    fn review_cache_survives_panic_mid_write() {
        use std::sync::{Arc, Mutex};

        let cache: Arc<Mutex<Vec<Review>>> = Arc::new(Mutex::new(vec![]));
        let cache_clone = Arc::clone(&cache);

        let poisoning_review = Review {
            id: 9999,
            creator_address: "PANIC_CREATOR".to_string(),
            reviewer_address: "PANIC_REVIEWER".to_string(),
            bounty_id: None,
            rating: 5,
            comment: "Written before the panic".to_string(),
            verified: false,
            created_at: chrono::Utc::now(),
        };
        let expected_id = poisoning_review.id;

        // Spawn a thread that pushes the review then panics, poisoning the mutex.
        let handle = std::thread::spawn(move || {
            let mut guard = cache_clone.lock().unwrap();
            guard.push(poisoning_review);
            // The push completed; now simulate a panic (e.g. a downstream
            // invariant check fails, an index is out of bounds, etc.).
            panic!("simulated mid-write panic");
        });

        // The spawned thread panicked — join() captures that as an Err.
        assert!(
            handle.join().is_err(),
            "thread should have panicked"
        );

        // The mutex is now poisoned.  lock_review_cache must recover it
        // instead of propagating the panic.
        let guard = lock_review_cache(&cache);
        assert!(
            !guard.is_empty(),
            "cache should contain the review that was pushed before the panic"
        );
        assert_eq!(
            guard[0].id, expected_id,
            "recovered data should include the review written before the panic"
        );
    }

    /// Poison a reputation `CacheMap` mutex mid-write and confirm reads still succeed.
    #[test]
    fn reputation_cache_survives_panic_mid_write() {
        use std::sync::{Arc, Mutex};
        use std::time::Instant;

        let cache: Arc<Mutex<CacheMap<String, (EffectiveReputation, Instant)>>> =
            Arc::new(Mutex::new(CacheMap::new()));
        let cache_clone = Arc::clone(&cache);

        let entry_key = "PANIC_ADDR".to_string();
        let entry_key_check = entry_key.clone();

        let signals = OffChainSignals {
            response_rate: 1.0,
            kyc_level: KycLevel::None,
            profile_completeness: 1.0,
            days_since_last_activity: 0,
        };
        let breakdown = compute_effective_score(80.0, &signals);
        let reputation = EffectiveReputation {
            creator_address: entry_key.clone(),
            breakdown,
            cached_at: chrono::Utc::now(),
            cache_ttl_seconds: CACHE_TTL_SECS,
            on_chain_verified: false,
        };

        // Insert the entry then panic — poisoning the mutex after the insert.
        let handle = std::thread::spawn(move || {
            let mut guard = cache_clone.lock().unwrap();
            guard.insert(entry_key, (reputation, Instant::now()));
            panic!("simulated mid-write panic after insert");
        });

        assert!(handle.join().is_err(), "thread should have panicked");

        // lock_reputation_cache must recover the poisoned mutex.
        let guard = lock_reputation_cache(&cache);
        assert!(
            guard.contains_key(&entry_key_check),
            "reputation entry should be recoverable after cache was poisoned"
        );
    }

    // ── Review filter parsing and application (Issue #1392) ──────────────

    fn query(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn review(id: u64, rating: u8, verified: bool, days_ago: i64) -> Review {
        Review {
            id,
            creator_address: "GCREATOR".to_string(),
            reviewer_address: "GREVIEWER".to_string(),
            bounty_id: Some(id),
            rating,
            comment: format!("review {id}"),
            verified,
            created_at: chrono::Utc::now() - chrono::Duration::days(days_ago),
        }
    }

    #[test]
    fn parse_review_filters_defaults_when_query_is_empty() {
        let filters = parse_review_filters(&query(&[])).unwrap();
        assert!(filters.sort_by.is_none());
        assert!(filters.min_rating.is_none());
        assert_eq!(effective_page(&filters), 1);
        assert_eq!(effective_limit(&filters), DEFAULT_REVIEW_PAGE_SIZE);
    }

    #[test]
    fn parse_review_filters_reads_every_supported_parameter() {
        let filters = parse_review_filters(&query(&[
            ("sortBy", "rating"),
            ("sortOrder", "asc"),
            ("page", "3"),
            ("limit", "25"),
            ("minRating", "2"),
            ("maxRating", "4"),
            ("verifiedOnly", "true"),
            ("createdAfter", "2026-01-01T00:00:00Z"),
            ("createdBefore", "2026-06-01T00:00:00Z"),
        ]))
        .unwrap();

        assert_eq!(filters.sort_by, Some(ReviewSortBy::Rating));
        assert_eq!(filters.sort_order, Some(SortOrder::Asc));
        assert_eq!(filters.page, Some(3));
        assert_eq!(filters.limit, Some(25));
        assert_eq!(filters.min_rating, Some(2));
        assert_eq!(filters.max_rating, Some(4));
        assert_eq!(filters.verified_only, Some(true));
        assert!(filters.created_after.is_some());
        assert!(filters.created_before.is_some());
    }

    #[test]
    fn parse_review_filters_treats_empty_values_as_absent() {
        // An untouched form field submits an empty value; rejecting it would
        // make the UI unusable.
        let filters = parse_review_filters(&query(&[
            ("verifiedOnly", ""),
            ("minRating", "   "),
        ]))
        .unwrap();

        assert!(filters.verified_only.is_none());
        assert!(filters.min_rating.is_none());
    }

    #[test]
    fn parse_review_filters_rejects_unparseable_values() {
        // Falling back to the default would return every review and read as
        // "the filter matched everything" — a wrong answer presented as right.
        let errors = parse_review_filters(&query(&[("minRating", "high")])).unwrap_err();
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("minRating"));
    }

    #[test]
    fn parse_review_filters_collects_every_error() {
        let errors = parse_review_filters(&query(&[
            ("sortBy", "colour"),
            ("sortOrder", "sideways"),
            ("page", "0"),
            ("minRating", "9"),
        ]))
        .unwrap_err();

        // One round trip, not four.
        assert_eq!(errors.len(), 4);
    }

    #[test]
    fn parse_review_filters_rejects_an_inverted_rating_range() {
        // Matches nothing; an empty list would read as "no reviews in that band".
        let errors = parse_review_filters(&query(&[("minRating", "4"), ("maxRating", "2")]))
            .unwrap_err();
        assert!(errors.iter().any(|e| e.contains("must not be greater")));
    }

    #[test]
    fn parse_review_filters_rejects_an_inverted_date_range() {
        let errors = parse_review_filters(&query(&[
            ("createdAfter", "2026-06-01T00:00:00Z"),
            ("createdBefore", "2026-01-01T00:00:00Z"),
        ]))
        .unwrap_err();
        assert!(errors.iter().any(|e| e.contains("createdAfter")));
    }

    #[test]
    fn parse_review_filters_rejects_a_limit_above_the_maximum() {
        // Unbounded limit is a cheap way to ask for every review ever written.
        let errors =
            parse_review_filters(&query(&[("limit", "5000")])).unwrap_err();
        assert!(errors[0].contains("must not exceed"));
    }

    #[test]
    fn parse_review_filters_rejects_page_zero() {
        let errors = parse_review_filters(&query(&[("page", "0")])).unwrap_err();
        assert!(errors[0].contains("1 or greater"));
    }

    #[test]
    fn parse_review_filters_accepts_boolean_and_sort_synonyms() {
        for raw in ["true", "1", "yes"] {
            let f = parse_review_filters(&query(&[("verifiedOnly", raw)])).unwrap();
            assert_eq!(f.verified_only, Some(true), "{raw} should parse as true");
        }
        for raw in ["false", "0", "no"] {
            let f = parse_review_filters(&query(&[("verifiedOnly", raw)])).unwrap();
            assert_eq!(f.verified_only, Some(false), "{raw} should parse as false");
        }
        assert_eq!(
            parse_review_filters(&query(&[("sortOrder", "DESC")]))
                .unwrap()
                .sort_order,
            Some(SortOrder::Desc),
            "sort order should be case-insensitive"
        );
    }

    #[test]
    fn filter_reviews_applies_the_rating_range_inclusively() {
        let reviews = vec![
            review(1, 1, true, 1),
            review(2, 3, true, 1),
            review(3, 5, true, 1),
        ];
        let filters = parse_review_filters(&query(&[("minRating", "3"), ("maxRating", "5")]))
            .unwrap();

        let filtered = filter_reviews(&reviews, &filters);
        assert_eq!(filtered.len(), 2);
        assert!(filtered.iter().all(|r| r.rating >= 3));
    }

    #[test]
    fn filter_reviews_distinguishes_verified_false_from_absent() {
        let reviews = vec![review(1, 5, true, 1), review(2, 5, false, 1)];

        let only_unverified =
            parse_review_filters(&query(&[("verifiedOnly", "false")])).unwrap();
        assert_eq!(filter_reviews(&reviews, &only_unverified).len(), 1);

        // Absent means no filter, not "only unverified".
        let unfiltered = parse_review_filters(&query(&[])).unwrap();
        assert_eq!(filter_reviews(&reviews, &unfiltered).len(), 2);
    }

    #[test]
    fn filter_reviews_applies_the_date_range() {
        let reviews = vec![review(1, 5, true, 30), review(2, 5, true, 1)];
        let cutoff = chrono::Utc::now() - chrono::Duration::days(7);

        let filters = parse_review_filters(&query(&[(
            "createdAfter",
            &cutoff.to_rfc3339(),
        )]))
        .unwrap();

        let filtered = filter_reviews(&reviews, &filters);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, 2);
    }

    #[test]
    fn filter_reviews_combines_filters_conjunctively() {
        let reviews = vec![
            review(1, 5, true, 1),
            review(2, 5, false, 1),
            review(3, 2, true, 1),
        ];
        let filters =
            parse_review_filters(&query(&[("minRating", "4"), ("verifiedOnly", "true")]))
                .unwrap();

        let filtered = filter_reviews(&reviews, &filters);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, 1);
    }

    #[test]
    fn filter_reviews_returns_everything_for_default_filters() {
        let reviews = vec![review(1, 1, false, 100), review(2, 5, true, 0)];
        let filtered = filter_reviews(&reviews, &ReviewFilters::default());
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn effective_limit_clamps_to_the_maximum() {
        let filters = ReviewFilters {
            limit: Some(u32::MAX),
            ..Default::default()
        };
        assert_eq!(effective_limit(&filters), MAX_REVIEW_PAGE_SIZE);
    }
}
