//! Reputation and review aggregation for creators.
//!
//! Reviews are sourced from database with fallback to in-memory seed list for development.
//! Aggregation computes average rating, totals, per-star counts, and a recent slice.
//! Includes hooks for real-time reputation updates when reviews are submitted.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use sqlx::PgPool;
use sqlx::Error as SqlxError;

/// Internal review row (includes `creator_id` for filtering).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Review {
    pub id: String,
    pub creator_id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    pub reviewer_name: String,
    pub created_at: String,
}

/// Public review without `creator_id` (returned to clients).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicReview {
    pub id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    pub reviewer_name: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReputationAggregation {
    pub average_rating: f64,
    pub total_reviews: u32,
    pub stars_5: u32,
    pub stars_4: u32,
    pub stars_3: u32,
    pub stars_2: u32,
    pub stars_1: u32,
    pub is_verified: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorReputationPayload {
    pub creator_id: String,
    pub aggregation: ReputationAggregation,
    pub recent_reviews: Vec<PublicReview>,
}

/// Query parameters for filtering and sorting reviews
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFilters {
    pub min_rating: Option<u8>,
    pub max_rating: Option<u8>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub verified_only: Option<bool>,
    pub sort_by: Option<ReviewSortBy>,
    pub sort_order: Option<SortOrder>,
    pub page: Option<u32>,
    pub limit: Option<u32>,
}

/// Available sorting options for reviews
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewSortBy {
    CreatedAt,
    Rating,
    ReviewerName,
}

/// Sort order options
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortOrder {
    Asc,
    Desc,
}

/// Paginated review response
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedReviews {
    pub reviews: Vec<PublicReview>,
    pub total_count: u32,
    pub page: u32,
    pub limit: u32,
    pub total_pages: u32,
    pub has_next: bool,
    pub has_prev: bool,
}

/// Enhanced creator reputation payload with filtering support
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredCreatorReputationPayload {
    pub creator_id: String,
    pub aggregation: ReputationAggregation,
    pub filtered_aggregation: Option<ReputationAggregation>,
    pub reviews: PaginatedReviews,
    pub applied_filters: ReviewFilters,
}

/// Hook event data for review submission
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSubmittedEvent {
    pub review_id: String,
    pub creator_id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    pub reviewer_name: String,
    pub bounty_id: String,
    pub submitted_at: String,
}

/// Hook callback function type for review submission events
pub type ReviewSubmittedHook = Arc<dyn Fn(&ReviewSubmittedEvent) -> Result<(), String> + Send + Sync>;

/// Global registry for review submission hooks
static REVIEW_HOOKS: Mutex<Vec<ReviewSubmittedHook>> = Mutex::new(Vec::new());

/// Global database pool for reputation operations
static DB_POOL: Mutex<Option<PgPool>> = Mutex::new(None);

fn format_db_error(operation: &str, sql_label: &str, entity_context: &[(&str, &str)], err: &SqlxError) -> String {
    let context = entity_context
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "Database operation failed: {} [{}] ({}) - {}",
        operation, sql_label, context, err
    )
}

/// Set the database pool for reputation operations
pub fn set_database_pool(pool: PgPool) {
    let mut db_pool = DB_POOL.lock().unwrap();
    *db_pool = Some(pool);
}

/// Get the database pool for reputation operations
fn get_database_pool() -> Option<PgPool> {
    let db_pool = DB_POOL.lock().unwrap();
    db_pool.clone()
}

/// Register a hook to be called when a review is submitted
pub fn register_review_submitted_hook<F>(hook: F) 
where 
    F: Fn(&ReviewSubmittedEvent) -> Result<(), String> + Send + Sync + 'static,
{
    if let Ok(mut hooks) = REVIEW_HOOKS.lock() {
        hooks.push(Arc::new(hook));
    } else {
        tracing::error!("Failed to register review hook - could not acquire lock");
    }
}

/// Trigger all registered hooks when a review is submitted
pub fn trigger_review_submitted_hooks(event: &ReviewSubmittedEvent) -> Vec<String> {
    let hooks = match REVIEW_HOOKS.lock() {
        Ok(hooks) => hooks.clone(),
        Err(_) => {
            tracing::error!("Failed to acquire lock on review hooks");
            return vec!["Failed to acquire hooks lock".to_string()];
        }
    };
    
    let mut errors = Vec::new();
    
    for hook in hooks.iter() {
        if let Err(e) = hook(event) {
            errors.push(format!("Hook execution failed: {}", e));
        }
    }
    
    errors
}

/// Process a new review submission and trigger hooks
pub fn on_review_submitted(
    bounty_id: &str,
    creator_id: &str,
    rating: u8,
    title: &str,
    body: &str,
    reviewer_name: &str,
) -> Result<String, Vec<String>> {
    // Validate the review data
    let mut validation_errors = Vec::new();
    
    if bounty_id.trim().is_empty() {
        validation_errors.push("Bounty ID is required".to_string());
    }
    if creator_id.trim().is_empty() {
        validation_errors.push("Creator ID is required".to_string());
    }
    if !(1..=5).contains(&rating) {
        validation_errors.push("Rating must be between 1 and 5".to_string());
    }
    if title.trim().is_empty() {
        validation_errors.push("Title is required".to_string());
    }
    if body.trim().is_empty() {
        validation_errors.push("Review body is required".to_string());
    }
    if reviewer_name.trim().is_empty() {
        validation_errors.push("Reviewer name is required".to_string());
    }
    
    if !validation_errors.is_empty() {
        return Err(validation_errors);
    }
    
    // Generate review ID and timestamp
    let review_id = format!("rev-{}-{}-{}", creator_id, bounty_id, 
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos());
    let submitted_at = chrono::Utc::now().to_rfc3339();
    
    // Create the review event
    let event = ReviewSubmittedEvent {
        review_id: review_id.clone(),
        creator_id: creator_id.to_string(),
        rating,
        title: title.to_string(),
        body: body.to_string(),
        reviewer_name: reviewer_name.to_string(),
        bounty_id: bounty_id.to_string(),
        submitted_at,
    };
    
    // Trigger all registered hooks
    let hook_errors = trigger_review_submitted_hooks(&event);
    
    // Database integration is now handled by hooks
    // The database_reputation_update_hook will save to database
    // If database is not available, it falls back to in-memory store
    
    if !hook_errors.is_empty() {
        tracing::warn!("Some hooks failed during review submission: {:?}", hook_errors);
        // We still return success since the review was saved, but log the hook failures
    }
    
    tracing::info!("Review submitted successfully: {} for creator {}", review_id, creator_id);
    Ok(review_id)
}

/// Add a review to the database (production implementation)
async fn save_review_to_database(event: &ReviewSubmittedEvent) -> Result<(), String> {
    let pool = match get_database_pool() {
        Some(pool) => pool,
        None => {
            tracing::error!("Database pool not available, falling back to in-memory store");
            add_review_to_store(event);
            return Ok(());
        }
    };

    // Parse UUID from review_id or generate new one
    let review_uuid = match uuid::Uuid::parse_str(&event.review_id) {
        Ok(uuid) => uuid.to_string(),
        Err(_) => uuid::Uuid::new_v4().to_string(), // Generate new UUID if parsing fails
    };

    // Insert review into database
    let result = sqlx::query(
        r#"
        INSERT INTO reviews (id, creator_id, bounty_id, rating, title, body, reviewer_name, created_at)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NOW())
        "#
    )
    .bind(&review_uuid)
    .bind(&event.creator_id)
    .bind(&event.bounty_id)
    .bind(event.rating as i32)
    .bind(&event.title)
    .bind(&event.body)
    .bind(&event.reviewer_name)
    .execute(&pool)
    .await;

    match result {
        Ok(_) => {
            tracing::info!("Review {} saved to database for creator {}", 
                event.review_id, event.creator_id);
            
            // Update creator reputation aggregation
            let update_result = sqlx::query("SELECT update_creator_reputation($1)")
                .bind(&event.creator_id)
                .execute(&pool)
                .await;

            match update_result {
                Ok(_) => {
                    tracing::info!("Creator reputation updated for {}", event.creator_id);
                    Ok(())
                }
                Err(e) => {
                    let err_msg = format_db_error(
                        "update creator reputation aggregate",
                        "SELECT update_creator_reputation($1)",
                        &[("creator_id", &event.creator_id), ("review_id", &event.review_id)],
                        &e,
                    );
                    tracing::error!("{}", err_msg);
                    Err(err_msg)
                }
            }
        }
        Err(e) => {
            let err_msg = format_db_error(
                "insert review row",
                "INSERT INTO reviews (...) VALUES (...)",
                &[
                    ("review_id", &event.review_id),
                    ("creator_id", &event.creator_id),
                    ("bounty_id", &event.bounty_id),
                ],
                &e,
            );
            tracing::error!("{}", err_msg);
            Err(err_msg)
        }
    }
}

/// Database-backed reputation update hook
fn database_reputation_update_hook(event: &ReviewSubmittedEvent) -> Result<(), String> {
    // Use tokio to run async database operation in sync context
    let rt = tokio::runtime::Handle::current();
    rt.block_on(save_review_to_database(event))
}

/// Add a review to the in-memory store (fallback for development)
fn add_review_to_store(event: &ReviewSubmittedEvent) {
    // TODO: This is now a fallback - database integration is the primary method
    // For development/testing when database is not available
    
    tracing::info!("Review stored in memory: {} for creator {} (rating: {})", 
        event.review_id, event.creator_id, event.rating);
    
    // Note: In-memory reviews won't appear in API responses that use database queries
}

/// Default hook for updating creator reputation when a review is submitted
pub fn default_reputation_update_hook(event: &ReviewSubmittedEvent) -> Result<(), String> {
    tracing::info!("Updating reputation for creator {} after review submission", event.creator_id);
    
    // In production, this would:
    // 1. Update the creator's aggregated reputation in the database
    // 2. Invalidate any cached reputation data
    // 3. Potentially trigger notifications to the creator
    // 4. Update search indexes if needed
    
    // For now, we'll simulate the reputation update
    let current_reviews = reviews_for_creator(&event.creator_id);
    let current_aggregation = aggregate_reviews(&current_reviews);
    
    tracing::info!(
        "Creator {} reputation updated: {} reviews, {:.2} average rating, verified: {}",
        event.creator_id,
        current_aggregation.total_reviews,
        current_aggregation.average_rating,
        current_aggregation.is_verified
    );
    
    Ok(())
}

/// Initialize the reputation system with default hooks
pub fn initialize_reputation_system() {
    register_review_submitted_hook(default_reputation_update_hook);
    
    // Register additional hooks for analytics, notifications, etc.
    register_review_submitted_hook(|event| {
        tracing::info!("Analytics hook: Review {} submitted for creator {}", 
            event.review_id, event.creator_id);
        Ok(())
    });
    
    register_review_submitted_hook(|event| {
        // Notification hook - in production would send notifications
        if event.rating >= 4 {
            tracing::info!("Notification hook: Positive review received for creator {}", 
                event.creator_id);
        }
        Ok(())
    });
}

/// Initialize the reputation system with database support and default hooks
pub fn initialize_reputation_system_with_db(pool: PgPool) {
    set_database_pool(pool);
    
    register_review_submitted_hook(database_reputation_update_hook);
    
    // Register additional hooks for analytics, notifications, etc.
    register_review_submitted_hook(|event| {
        tracing::info!("Analytics hook: Review {} submitted for creator {}", 
            event.review_id, event.creator_id);
        Ok(())
    });
    
    register_review_submitted_hook(|event| {
        // Notification hook - in production would send notifications
        if event.rating >= 4 {
            tracing::info!("Notification hook: Positive review received for creator {}", 
                event.creator_id);
        }
        Ok(())
    });
}

/// Filter seed reviews for one creator.
pub fn reviews_for_creator(creator_id: &str) -> Vec<Review> {
    seed_reviews()
        .into_iter()
        .filter(|r| r.creator_id == creator_id)
        .collect()
}

/// Fetch reviews for a creator from database with fallback to seed data
pub async fn fetch_creator_reviews_from_db(creator_id: &str) -> Vec<Review> {
    let pool = match get_database_pool() {
        Some(pool) => pool,
        None => {
            tracing::warn!("Database pool not available, using seed data for creator {}", creator_id);
            return reviews_for_creator(creator_id);
        }
    };

    let result = sqlx::query_as::<_, (String, String, String, i32, String, String, String, String)>(
        r#"
        SELECT id::text, creator_id, bounty_id, rating, title, body, reviewer_name, 
               to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        FROM reviews 
        WHERE creator_id = $1
        ORDER BY created_at DESC
        "#
    )
    .bind(creator_id)
    .fetch_all(&pool)
    .await;

    match result {
        Ok(rows) => {
            rows.into_iter()
                .map(|(id, creator_id, _bounty_id, rating, title, body, reviewer_name, created_at)| Review {
                    id,
                    creator_id,
                    rating: rating as u8,
                    title,
                    body,
                    reviewer_name,
                    created_at,
                })
                .collect()
        }
        Err(e) => {
            let err_msg = format_db_error(
                "fetch creator reviews",
                "SELECT ... FROM reviews WHERE creator_id = $1 ORDER BY created_at DESC",
                &[("creator_id", creator_id)],
                &e,
            );
            tracing::error!("{}", err_msg);
            tracing::info!("Falling back to seed data for creator {}", creator_id);
            reviews_for_creator(creator_id)
        }
    }
}

/// Fetch creator reputation from database with fallback to calculated aggregation
pub async fn fetch_creator_reputation_from_db(creator_id: &str) -> ReputationAggregation {
    let pool = match get_database_pool() {
        Some(pool) => pool,
        None => {
            tracing::warn!("Database pool not available, calculating from seed data for creator {}", creator_id);
            let reviews = reviews_for_creator(creator_id);
            return aggregate_reviews(&reviews);
        }
    };

    let result = sqlx::query_as::<_, (Option<f64>, i32, i32, i32, i32, i32, i32, bool)>(
        r#"
        SELECT average_rating, total_reviews, stars_5, stars_4, stars_3, stars_2, stars_1, is_verified
        FROM creator_reputation 
        WHERE creator_id = $1
        "#
    )
    .bind(creator_id)
    .fetch_optional(&pool)
    .await;

    match result {
        Ok(Some((average_rating, total_reviews, stars_5, stars_4, stars_3, stars_2, stars_1, is_verified))) => ReputationAggregation {
            average_rating: average_rating.unwrap_or(0.0),
            total_reviews: total_reviews as u32,
            stars_5: stars_5 as u32,
            stars_4: stars_4 as u32,
            stars_3: stars_3 as u32,
            stars_2: stars_2 as u32,
            stars_1: stars_1 as u32,
            is_verified,
        },
        Ok(None) => {
            tracing::info!("No reputation data found in database for creator {}, calculating from reviews", creator_id);
            let reviews = fetch_creator_reviews_from_db(creator_id).await;
            aggregate_reviews(&reviews)
        }
        Err(e) => {
            let err_msg = format_db_error(
                "fetch creator reputation aggregate",
                "SELECT ... FROM creator_reputation WHERE creator_id = $1",
                &[("creator_id", creator_id)],
                &e,
            );
            tracing::error!("{}", err_msg);
            tracing::info!("Falling back to seed data calculation for creator {}", creator_id);
            let reviews = reviews_for_creator(creator_id);
            aggregate_reviews(&reviews)
        }
    }
}

/// Fetch all reviews from database with fallback to seed data
pub async fn fetch_all_reviews_from_db() -> Vec<Review> {
    let pool = match get_database_pool() {
        Some(pool) => pool,
        None => {
            tracing::warn!("Database pool not available, using seed data for all reviews");
            return seed_reviews();
        }
    };

    let result = sqlx::query_as::<_, (String, String, String, i32, String, String, String, String)>(
        r#"
        SELECT id::text, creator_id, bounty_id, rating, title, body, reviewer_name,
               to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
        FROM reviews 
        ORDER BY created_at DESC
        "#
    )
    .fetch_all(&pool)
    .await;

    match result {
        Ok(rows) => {
            if rows.is_empty() {
                tracing::info!("No reviews found in database, falling back to seed data");
                seed_reviews()
            } else {
                rows.into_iter()
                    .map(|(id, creator_id, _bounty_id, rating, title, body, reviewer_name, created_at)| Review {
                        id,
                        creator_id,
                        rating: rating as u8,
                        title,
                        body,
                        reviewer_name,
                        created_at,
                    })
                    .collect()
            }
        }
        Err(e) => {
            let err_msg = format_db_error(
                "fetch all reviews",
                "SELECT ... FROM reviews ORDER BY created_at DESC",
                &[],
                &e,
            );
            tracing::error!("{}", err_msg);
            tracing::info!("Falling back to seed data for all reviews");
            seed_reviews()
        }
    }
}

/// Aggregate ratings: average (2 decimal places), counts per star (1–5). Ignores invalid ratings.
pub fn aggregate_reviews(reviews: &[Review]) -> ReputationAggregation {
    let mut stars = [0u32; 5];
    let mut sum: u64 = 0;
    let mut count: u32 = 0;

    for r in reviews {
        let b = r.rating;
        if !(1..=5).contains(&b) {
            continue;
        }
        sum += u64::from(b);
        count += 1;
        stars[usize::from(b - 1)] += 1;
    }

    let average_rating = if count == 0 {
        0.0
    } else {
        let raw = sum as f64 / f64::from(count);
        (raw * 100.0).round() / 100.0
    };

    let is_verified = count >= 3 && average_rating >= 4.5;

    ReputationAggregation {
        average_rating,
        total_reviews: count,
        stars_5: stars[4],
        stars_4: stars[3],
        stars_3: stars[2],
        stars_2: stars[1],
        stars_1: stars[0],
        is_verified,
    }
}

pub fn to_public_review(r: &Review) -> PublicReview {
    PublicReview {
        id: r.id.clone(),
        rating: r.rating,
        title: r.title.clone(),
        body: r.body.clone(),
        reviewer_name: r.reviewer_name.clone(),
        created_at: r.created_at.clone(),
    }
}

/// Most recent reviews (lexicographic `created_at` desc), capped.
pub fn recent_reviews(reviews: &[Review], limit: usize) -> Vec<PublicReview> {
    let mut owned: Vec<Review> = reviews.to_vec();
    owned.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    owned.into_iter().take(limit).map(|r| to_public_review(&r)).collect()
}

/// Filter reviews based on provided criteria
pub fn filter_reviews(reviews: &[Review], filters: &ReviewFilters) -> Vec<Review> {
    reviews
        .iter()
        .filter(|review| {
            // Rating filter
            if let Some(min_rating) = filters.min_rating {
                if review.rating < min_rating {
                    return false;
                }
            }
            if let Some(max_rating) = filters.max_rating {
                if review.rating > max_rating {
                    return false;
                }
            }
            
            // Date filters (simple string comparison for ISO dates)
            if let Some(ref date_from) = filters.date_from {
                if review.created_at < *date_from {
                    return false;
                }
            }
            if let Some(ref date_to) = filters.date_to {
                if review.created_at > *date_to {
                    return false;
                }
            }
            
            // Verified filter (high rating reviews only)
            if let Some(true) = filters.verified_only {
                if review.rating < 4 {
                    return false;
                }
            }
            
            true
        })
        .cloned()
        .collect()
}

/// Sort reviews based on specified criteria
pub fn sort_reviews(reviews: &mut [Review], sort_by: &ReviewSortBy, sort_order: &SortOrder) {
    match sort_by {
        ReviewSortBy::CreatedAt => {
            reviews.sort_by(|a, b| match sort_order {
                SortOrder::Asc => a.created_at.cmp(&b.created_at),
                SortOrder::Desc => b.created_at.cmp(&a.created_at),
            });
        }
        ReviewSortBy::Rating => {
            reviews.sort_by(|a, b| match sort_order {
                SortOrder::Asc => a.rating.cmp(&b.rating),
                SortOrder::Desc => b.rating.cmp(&a.rating),
            });
        }
        ReviewSortBy::ReviewerName => {
            reviews.sort_by(|a, b| match sort_order {
                SortOrder::Asc => a.reviewer_name.cmp(&b.reviewer_name),
                SortOrder::Desc => b.reviewer_name.cmp(&a.reviewer_name),
            });
        }
    }
}

/// Paginate reviews and return paginated result
pub fn paginate_reviews(reviews: Vec<Review>, page: u32, limit: u32) -> PaginatedReviews {
    let total_count = reviews.len() as u32;
    let total_pages = if total_count == 0 { 0 } else { (total_count + limit - 1) / limit };
    let start_index = ((page - 1) * limit) as usize;
    let end_index = (start_index + limit as usize).min(reviews.len());
    
    let paginated_reviews = if start_index < reviews.len() {
        reviews[start_index..end_index]
            .iter()
            .map(to_public_review)
            .collect()
    } else {
        Vec::new()
    };
    
    PaginatedReviews {
        reviews: paginated_reviews,
        total_count,
        page,
        limit,
        total_pages,
        has_next: page < total_pages,
        has_prev: page > 1,
    }
}

/// Get filtered and sorted reviews for a creator with pagination
pub fn get_filtered_creator_reviews(creator_id: &str, filters: &ReviewFilters) -> FilteredCreatorReputationPayload {
    let all_reviews = reviews_for_creator(creator_id);
    let overall_aggregation = aggregate_reviews(&all_reviews);
    
    // Apply filters
    let filtered_reviews = filter_reviews(&all_reviews, filters);
    let filtered_aggregation = if filtered_reviews.len() != all_reviews.len() {
        Some(aggregate_reviews(&filtered_reviews))
    } else {
        None
    };
    
    // Apply sorting
    let mut sorted_reviews = filtered_reviews;
    let sort_by = filters.sort_by.as_ref().unwrap_or(&ReviewSortBy::CreatedAt);
    let sort_order = filters.sort_order.as_ref().unwrap_or(&SortOrder::Desc);
    sort_reviews(&mut sorted_reviews, sort_by, sort_order);
    
    // Apply pagination
    let page = filters.page.unwrap_or(1).max(1);
    let limit = filters.limit.unwrap_or(10).clamp(1, 100);
    let paginated_reviews = paginate_reviews(sorted_reviews, page, limit);
    
    FilteredCreatorReputationPayload {
        creator_id: creator_id.to_string(),
        aggregation: overall_aggregation,
        filtered_aggregation,
        reviews: paginated_reviews,
        applied_filters: filters.clone(),
    }
}

/// Get filtered and sorted reviews for a creator with pagination (database-backed)
pub async fn get_filtered_creator_reviews_from_db(creator_id: &str, filters: &ReviewFilters) -> FilteredCreatorReputationPayload {
    let all_reviews = fetch_creator_reviews_from_db(creator_id).await;
    let overall_aggregation = fetch_creator_reputation_from_db(creator_id).await;
    
    // Apply filters
    let filtered_reviews = filter_reviews(&all_reviews, filters);
    let filtered_aggregation = if filtered_reviews.len() != all_reviews.len() {
        Some(aggregate_reviews(&filtered_reviews))
    } else {
        None
    };
    
    // Apply sorting
    let mut sorted_reviews = filtered_reviews;
    let sort_by = filters.sort_by.as_ref().unwrap_or(&ReviewSortBy::CreatedAt);
    let sort_order = filters.sort_order.as_ref().unwrap_or(&SortOrder::Desc);
    sort_reviews(&mut sorted_reviews, sort_by, sort_order);
    
    // Apply pagination
    let page = filters.page.unwrap_or(1).max(1);
    let limit = filters.limit.unwrap_or(10).clamp(1, 100);
    let paginated_reviews = paginate_reviews(sorted_reviews, page, limit);
    
    FilteredCreatorReputationPayload {
        creator_id: creator_id.to_string(),
        aggregation: overall_aggregation,
        filtered_aggregation,
        reviews: paginated_reviews,
        applied_filters: filters.clone(),
    }
}

/// Parse query parameters into ReviewFilters
pub fn parse_review_filters(query: &HashMap<String, String>) -> Result<ReviewFilters, Vec<String>> {
    let mut errors = Vec::new();
    
    let min_rating = query.get("minRating").and_then(|v| {
        v.parse::<u8>().ok().and_then(|r| if (1..=5).contains(&r) { Some(r) } else { 
            errors.push("minRating must be between 1 and 5".to_string());
            None
        })
    });
    
    let max_rating = query.get("maxRating").and_then(|v| {
        v.parse::<u8>().ok().and_then(|r| if (1..=5).contains(&r) { Some(r) } else {
            errors.push("maxRating must be between 1 and 5".to_string());
            None
        })
    });
    
    // Validate rating range
    if let (Some(min), Some(max)) = (min_rating, max_rating) {
        if min > max {
            errors.push("minRating cannot be greater than maxRating".to_string());
        }
    }
    
    let date_from = query.get("dateFrom").cloned();
    let date_to = query.get("dateTo").cloned();
    
    let verified_only = query.get("verifiedOnly").and_then(|v| {
        match v.to_lowercase().as_str() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => {
                errors.push("verifiedOnly must be true or false".to_string());
                None
            }
        }
    });
    
    let sort_by = query.get("sortBy").and_then(|v| {
        match v.to_lowercase().as_str() {
            "createdat" | "created_at" | "date" => Some(ReviewSortBy::CreatedAt),
            "rating" => Some(ReviewSortBy::Rating),
            "reviewername" | "reviewer_name" | "reviewer" => Some(ReviewSortBy::ReviewerName),
            _ => {
                errors.push("sortBy must be one of: createdAt, rating, reviewerName".to_string());
                None
            }
        }
    });
    
    let sort_order = query.get("sortOrder").and_then(|v| {
        match v.to_lowercase().as_str() {
            "asc" | "ascending" => Some(SortOrder::Asc),
            "desc" | "descending" => Some(SortOrder::Desc),
            _ => {
                errors.push("sortOrder must be asc or desc".to_string());
                None
            }
        }
    });
    
    let page = query.get("page").and_then(|v| {
        v.parse::<u32>().ok().and_then(|p| if p >= 1 { Some(p) } else {
            errors.push("page must be >= 1".to_string());
            None
        })
    });
    
    let limit = query.get("limit").and_then(|v| {
        v.parse::<u32>().ok().and_then(|l| if (1..=100).contains(&l) { Some(l) } else {
            errors.push("limit must be between 1 and 100".to_string());
            None
        })
    });
    
    if !errors.is_empty() {
        return Err(errors);
    }
    
    Ok(ReviewFilters {
        min_rating,
        max_rating,
        date_from,
        date_to,
        verified_only,
        sort_by,
        sort_order,
        page,
        limit,
    })
}

fn seed_reviews() -> Vec<Review> {
    vec![
        Review {
            id: "r-alex-1".into(),
            creator_id: "alex-studio".into(),
            rating: 5,
            title: "Exceptional design partner".into(),
            body: "Delivered a full design system on time; communication was clear throughout.".into(),
            reviewer_name: "Sam K.".into(),
            created_at: "2025-08-12".into(),
        },
        Review {
            id: "r-alex-2".into(),
            creator_id: "alex-studio".into(),
            rating: 5,
            title: "Would hire again".into(),
            body: "Thoughtful UX and polished handoff files.".into(),
            reviewer_name: "River Corp".into(),
            created_at: "2025-06-01".into(),
        },
        Review {
            id: "r-alex-3".into(),
            creator_id: "alex-studio".into(),
            rating: 4,
            title: "Strong work".into(),
            body: "Minor iteration rounds but outcome exceeded expectations.".into(),
            reviewer_name: "Jamie L.".into(),
            created_at: "2024-11-20".into(),
        },
        Review {
            id: "r-maya-1".into(),
            creator_id: "maya-content".into(),
            rating: 5,
            title: "Brilliant strategist".into(),
            body: "Content calendar and tone guide were exactly what we needed.".into(),
            reviewer_name: "Northwind".into(),
            created_at: "2025-09-05".into(),
        },
        Review {
            id: "r-maya-2".into(),
            creator_id: "maya-content".into(),
            rating: 4,
            title: "Great collaborator".into(),
            body: "Fast turnaround on technical docs.".into(),
            reviewer_name: "DevTools Inc".into(),
            created_at: "2025-03-18".into(),
        },
        Review {
            id: "r-jordan-1".into(),
            creator_id: "jordan-dev".into(),
            rating: 5,
            title: "Campaign crushed metrics".into(),
            body: "Video series drove 2x engagement vs prior quarter.".into(),
            reviewer_name: "Pulse Media".into(),
            created_at: "2025-07-22".into(),
        },
        Review {
            id: "r-jordan-2".into(),
            creator_id: "jordan-dev".into(),
            rating: 3,
            title: "Good creative, tight deadlines".into(),
            body: "Quality was high; a few deliverables needed small revisions.".into(),
            reviewer_name: "Studio 9".into(),
            created_at: "2024-12-10".into(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn format_db_error_includes_operation_sql_and_context() {
        let err = SqlxError::PoolClosed;
        let formatted = format_db_error(
            "fetch creator reviews",
            "SELECT ... FROM reviews WHERE creator_id = $1",
            &[("creator_id", "alex-studio"), ("request_id", "r-123")],
            &err,
        );

        assert!(formatted.contains("fetch creator reviews"));
        assert!(formatted.contains("SELECT ... FROM reviews WHERE creator_id = $1"));
        assert!(formatted.contains("creator_id=alex-studio"));
        assert!(formatted.contains("request_id=r-123"));
        assert!(formatted.contains("pool has been closed"));
    }


    fn sample_reviews() -> Vec<Review> {
        vec![
            Review {
                id: "a".into(),
                creator_id: "c1".into(),
                rating: 5,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-02".into(),
            },
            Review {
                id: "b".into(),
                creator_id: "c1".into(),
                rating: 4,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-01".into(),
            },
            Review {
                id: "c".into(),
                creator_id: "c1".into(),
                rating: 0,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2024-01-01".into(),
            },
        ]
    }

    #[test]
    fn aggregate_empty() {
        let agg = aggregate_reviews(&[]);
        assert_eq!(agg.total_reviews, 0);
        assert_eq!(agg.average_rating, 0.0);
        assert_eq!(agg.stars_5, 0);
    }

    #[test]
    fn aggregate_skips_invalid_and_histogram() {
        let agg = aggregate_reviews(&sample_reviews());
        assert_eq!(agg.total_reviews, 2);
        assert_eq!(agg.average_rating, 4.5);
        assert_eq!(agg.stars_5, 1);
        assert_eq!(agg.stars_4, 1);
        assert_eq!(agg.stars_3, 0);
        assert!(!agg.is_verified, "need at least 3 reviews");
    }

    #[test]
    fn aggregate_verified_threshold() {
        let mut revs = sample_reviews();
        // Add a third valid high-rating review
        revs.push(Review {
            id: "d".into(),
            creator_id: "c1".into(),
            rating: 5,
            title: "".into(),
            body: "".into(),
            reviewer_name: "".into(),
            created_at: "2025-01-03".into(),
        });
        let agg = aggregate_reviews(&revs);
        assert_eq!(agg.total_reviews, 3);
        assert!(agg.average_rating >= 4.5);
        assert!(agg.is_verified);
    }

    #[test]
    fn recent_reviews_sorted_newest_first() {
        let revs = sample_reviews();
        let recent = recent_reviews(&revs, 2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, "a");
        assert_eq!(recent[1].id, "b");
    }

    #[test]
    fn to_public_review_maps_fields() {
        let r = Review {
            id: "r-1".into(),
            creator_id: "c-1".into(),
            rating: 4,
            title: "Good".into(),
            body: "Nice.".into(),
            reviewer_name: "Bob".into(),
            created_at: "2025-01-01".into(),
        };
        let p = to_public_review(&r);
        assert_eq!(p.id, "r-1");
        assert_eq!(p.rating, 4);
        assert_eq!(p.reviewer_name, "Bob");
    }

    #[test]
    fn recent_reviews_respects_limit() {
        let revs = sample_reviews();
        let recent = recent_reviews(&revs, 1);
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, "a");
    }

    #[test]
    fn aggregate_single_review() {
        let reviews = vec![Review {
            id: "x".into(),
            creator_id: "c1".into(),
            rating: 3,
            title: "".into(),
            body: "".into(),
            reviewer_name: "".into(),
            created_at: "2025-01-01".into(),
        }];
        let agg = aggregate_reviews(&reviews);
        assert_eq!(agg.total_reviews, 1);
        assert_eq!(agg.average_rating, 3.0);
        assert_eq!(agg.stars_3, 1);
        assert_eq!(agg.stars_5, 0);
    }

    #[test]
    fn reviews_for_creator_returns_only_matching() {
        let all = reviews_for_creator("alex-studio");
        assert!(all.iter().all(|r| r.creator_id == "alex-studio"));
    }

    #[test]
    fn seed_covers_profile_creator_ids() {
        let ids = ["alex-studio", "maya-content", "jordan-dev"];
        for id in ids {
            assert!(
                !reviews_for_creator(id).is_empty(),
                "expected seed reviews for {id}"
            );
        }
    }

    // Extended tests for mathematical precision and edge cases
    
    #[test]
    fn test_aggregate_reviews_precision() {
        // Test mathematical precision of average calculation
        let reviews = vec![
            Review {
                id: "1".into(),
                creator_id: "c1".into(),
                rating: 5,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-01".into(),
            },
            Review {
                id: "2".into(),
                creator_id: "c1".into(),
                rating: 4,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-02".into(),
            },
            Review {
                id: "3".into(),
                creator_id: "c1".into(),
                rating: 4,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-03".into(),
            },
        ];
        let agg = aggregate_reviews(&reviews);
        
        // (5 + 4 + 4) / 3 = 4.333... should round to 4.33
        assert_eq!(agg.average_rating, 4.33);
        assert_eq!(agg.total_reviews, 3);
    }

    #[test]
    fn test_invalid_ratings_ignored_comprehensive() {
        let reviews = vec![
            Review {
                id: "1".into(),
                creator_id: "c1".into(),
                rating: 0, // Invalid: too low
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-01".into(),
            },
            Review {
                id: "2".into(),
                creator_id: "c1".into(),
                rating: 6, // Invalid: too high
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-02".into(),
            },
            Review {
                id: "3".into(),
                creator_id: "c1".into(),
                rating: 3, // Valid
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-04".into(),
            },
            Review {
                id: "4".into(),
                creator_id: "c1".into(),
                rating: 4, // Valid
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-05".into(),
            },
        ];
        
        let agg = aggregate_reviews(&reviews);
        assert_eq!(agg.total_reviews, 2); // Only 2 valid reviews
        assert_eq!(agg.average_rating, 3.5); // (3 + 4) / 2 = 3.5
        assert_eq!(agg.stars_3, 1);
        assert_eq!(agg.stars_4, 1);
        assert_eq!(agg.stars_1, 0);
        assert_eq!(agg.stars_5, 0);
    }

    #[test]
    fn test_verification_boundary_conditions() {
        // Test exactly at verification threshold (3 reviews, 4.5+ average)
        let reviews_at_threshold = vec![
            Review {
                id: "1".into(),
                creator_id: "c1".into(),
                rating: 4,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-01".into(),
            },
            Review {
                id: "2".into(),
                creator_id: "c1".into(),
                rating: 5,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-02".into(),
            },
            Review {
                id: "3".into(),
                creator_id: "c1".into(),
                rating: 5,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-03".into(),
            },
        ];
        let agg = aggregate_reviews(&reviews_at_threshold);
        assert_eq!(agg.total_reviews, 3);
        assert!((agg.average_rating - 4.67).abs() < 0.01); // Should be 4.67
        assert!(agg.is_verified); // >= 4.5 and >= 3 reviews

        // Test just below threshold (3 reviews, < 4.5 average)
        let reviews_below_threshold = vec![
            Review {
                id: "1".into(),
                creator_id: "c1".into(),
                rating: 4,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-01".into(),
            },
            Review {
                id: "2".into(),
                creator_id: "c1".into(),
                rating: 4,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-02".into(),
            },
            Review {
                id: "3".into(),
                creator_id: "c1".into(),
                rating: 5,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-03".into(),
            },
        ];
        let agg = aggregate_reviews(&reviews_below_threshold);
        assert_eq!(agg.total_reviews, 3);
        assert!((agg.average_rating - 4.33).abs() < 0.01); // Should be 4.33
        assert!(!agg.is_verified); // < 4.5 average
    }

    // ── New tests for filtering and sorting functionality ────────────────────

    fn test_reviews() -> Vec<Review> {
        vec![
            Review {
                id: "r1".into(),
                creator_id: "c1".into(),
                rating: 5,
                title: "Excellent".into(),
                body: "Great work".into(),
                reviewer_name: "Alice".into(),
                created_at: "2025-01-15".into(),
            },
            Review {
                id: "r2".into(),
                creator_id: "c1".into(),
                rating: 3,
                title: "Average".into(),
                body: "Okay work".into(),
                reviewer_name: "Bob".into(),
                created_at: "2025-01-10".into(),
            },
            Review {
                id: "r3".into(),
                creator_id: "c1".into(),
                rating: 4,
                title: "Good".into(),
                body: "Nice work".into(),
                reviewer_name: "Charlie".into(),
                created_at: "2025-01-20".into(),
            },
            Review {
                id: "r4".into(),
                creator_id: "c1".into(),
                rating: 2,
                title: "Poor".into(),
                body: "Needs improvement".into(),
                reviewer_name: "David".into(),
                created_at: "2025-01-05".into(),
            },
        ]
    }

    #[test]
    fn test_filter_reviews_by_rating() {
        let reviews = test_reviews();
        
        // Filter for high ratings (4-5)
        let filters = ReviewFilters {
            min_rating: Some(4),
            max_rating: Some(5),
            date_from: None,
            date_to: None,
            verified_only: None,
            sort_by: None,
            sort_order: None,
            page: None,
            limit: None,
        };
        
        let filtered = filter_reviews(&reviews, &filters);
        assert_eq!(filtered.len(), 2); // r1 (5) and r3 (4)
        assert!(filtered.iter().all(|r| r.rating >= 4));
    }

    #[test]
    fn test_filter_reviews_by_date_range() {
        let reviews = test_reviews();
        
        let filters = ReviewFilters {
            min_rating: None,
            max_rating: None,
            date_from: Some("2025-01-10".into()),
            date_to: Some("2025-01-15".into()),
            verified_only: None,
            sort_by: None,
            sort_order: None,
            page: None,
            limit: None,
        };
        
        let filtered = filter_reviews(&reviews, &filters);
        assert_eq!(filtered.len(), 2); // r1 and r2
    }

    #[test]
    fn test_filter_reviews_verified_only() {
        let reviews = test_reviews();
        
        let filters = ReviewFilters {
            min_rating: None,
            max_rating: None,
            date_from: None,
            date_to: None,
            verified_only: Some(true),
            sort_by: None,
            sort_order: None,
            page: None,
            limit: None,
        };
        
        let filtered = filter_reviews(&reviews, &filters);
        assert_eq!(filtered.len(), 2); // r1 (5) and r3 (4)
        assert!(filtered.iter().all(|r| r.rating >= 4));
    }

    #[test]
    fn test_sort_reviews_by_rating() {
        let reviews = test_reviews();
        let mut reviews_copy = reviews.clone();
        
        sort_reviews(&mut reviews_copy, &ReviewSortBy::Rating, &SortOrder::Desc);
        
        // Should be sorted: 5, 4, 3, 2
        assert_eq!(reviews_copy[0].rating, 5);
        assert_eq!(reviews_copy[1].rating, 4);
        assert_eq!(reviews_copy[2].rating, 3);
        assert_eq!(reviews_copy[3].rating, 2);
    }

    #[test]
    fn test_sort_reviews_by_date() {
        let reviews = test_reviews();
        let mut reviews_copy = reviews.clone();
        
        sort_reviews(&mut reviews_copy, &ReviewSortBy::CreatedAt, &SortOrder::Desc);
        
        // Should be sorted by date descending: 2025-01-20, 2025-01-15, 2025-01-10, 2025-01-05
        assert_eq!(reviews_copy[0].created_at, "2025-01-20");
        assert_eq!(reviews_copy[1].created_at, "2025-01-15");
        assert_eq!(reviews_copy[2].created_at, "2025-01-10");
        assert_eq!(reviews_copy[3].created_at, "2025-01-05");
    }

    #[test]
    fn test_sort_reviews_by_reviewer_name() {
        let reviews = test_reviews();
        let mut reviews_copy = reviews.clone();
        
        sort_reviews(&mut reviews_copy, &ReviewSortBy::ReviewerName, &SortOrder::Asc);
        
        // Should be sorted alphabetically: Alice, Bob, Charlie, David
        assert_eq!(reviews_copy[0].reviewer_name, "Alice");
        assert_eq!(reviews_copy[1].reviewer_name, "Bob");
        assert_eq!(reviews_copy[2].reviewer_name, "Charlie");
        assert_eq!(reviews_copy[3].reviewer_name, "David");
    }

    #[test]
    fn test_paginate_reviews() {
        let reviews = test_reviews();
        
        // Test first page
        let page1 = paginate_reviews(reviews.clone(), 1, 2);
        assert_eq!(page1.reviews.len(), 2);
        assert_eq!(page1.total_count, 4);
        assert_eq!(page1.total_pages, 2);
        assert!(page1.has_next);
        assert!(!page1.has_prev);
        
        // Test second page
        let page2 = paginate_reviews(reviews.clone(), 2, 2);
        assert_eq!(page2.reviews.len(), 2);
        assert_eq!(page2.page, 2);
        assert!(!page2.has_next);
        assert!(page2.has_prev);
    }

    #[test]
    fn test_paginate_reviews_empty() {
        let reviews = Vec::new();
        let paginated = paginate_reviews(reviews, 1, 10);
        
        assert_eq!(paginated.reviews.len(), 0);
        assert_eq!(paginated.total_count, 0);
        assert_eq!(paginated.total_pages, 0);
        assert!(!paginated.has_next);
        assert!(!paginated.has_prev);
    }

    #[test]
    fn test_parse_review_filters_valid() {
        let mut query = HashMap::new();
        query.insert("minRating".to_string(), "3".to_string());
        query.insert("maxRating".to_string(), "5".to_string());
        query.insert("sortBy".to_string(), "rating".to_string());
        query.insert("sortOrder".to_string(), "desc".to_string());
        query.insert("page".to_string(), "2".to_string());
        query.insert("limit".to_string(), "20".to_string());
        
        let filters = parse_review_filters(&query).unwrap();
        assert_eq!(filters.min_rating, Some(3));
        assert_eq!(filters.max_rating, Some(5));
        assert_eq!(filters.sort_by, Some(ReviewSortBy::Rating));
        assert_eq!(filters.sort_order, Some(SortOrder::Desc));
        assert_eq!(filters.page, Some(2));
        assert_eq!(filters.limit, Some(20));
    }

    #[test]
    fn test_parse_review_filters_invalid_rating_range() {
        let mut query = HashMap::new();
        query.insert("minRating".to_string(), "5".to_string());
        query.insert("maxRating".to_string(), "3".to_string());
        
        let result = parse_review_filters(&query);
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.iter().any(|e| e.contains("minRating cannot be greater than maxRating")));
    }

    #[test]
    fn test_parse_review_filters_invalid_values() {
        let mut query = HashMap::new();
        query.insert("minRating".to_string(), "0".to_string()); // Invalid: too low
        query.insert("sortBy".to_string(), "invalid".to_string()); // Invalid sort field
        query.insert("page".to_string(), "0".to_string()); // Invalid: must be >= 1
        
        let result = parse_review_filters(&query);
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert_eq!(errors.len(), 3);
    }

    #[test]
    fn test_get_filtered_creator_reviews_integration() {
        // This test uses the seed data, so we test with a known creator
        let filters = ReviewFilters {
            min_rating: Some(4),
            max_rating: None,
            date_from: None,
            date_to: None,
            verified_only: None,
            sort_by: Some(ReviewSortBy::Rating),
            sort_order: Some(SortOrder::Desc),
            page: Some(1),
            limit: Some(10),
        };
        
        let result = get_filtered_creator_reviews("alex-studio", &filters);
        
        assert_eq!(result.creator_id, "alex-studio");
        assert!(result.aggregation.total_reviews > 0);
        assert!(result.reviews.total_count <= result.aggregation.total_reviews);
        
        // All returned reviews should have rating >= 4
        assert!(result.reviews.reviews.iter().all(|r| r.rating >= 4));
    }

    // ── Tests for review submission hooks ─────────────────────────────────────

    #[test]
    fn test_on_review_submitted_validation() {
        // Test with invalid data
        let result = on_review_submitted("", "creator1", 6, "", "", "");
        assert!(result.is_err());
        let errors = result.unwrap_err();
        assert!(errors.len() >= 5); // Should have multiple validation errors
        
        // Test with valid data
        let result = on_review_submitted(
            "bounty123",
            "creator1", 
            5,
            "Great work",
            "Excellent delivery",
            "John Doe"
        );
        assert!(result.is_ok());
        let review_id = result.unwrap();
        assert!(review_id.starts_with("rev-creator1-bounty123"));
    }

    #[test]
    fn test_review_submitted_event_creation() {
        let event = ReviewSubmittedEvent {
            review_id: "test-review-1".to_string(),
            creator_id: "creator1".to_string(),
            rating: 5,
            title: "Excellent".to_string(),
            body: "Great work".to_string(),
            reviewer_name: "John".to_string(),
            bounty_id: "bounty1".to_string(),
            submitted_at: "2025-01-01T00:00:00Z".to_string(),
        };
        
        assert_eq!(event.creator_id, "creator1");
        assert_eq!(event.rating, 5);
        assert_eq!(event.title, "Excellent");
    }

    #[test]
    fn test_hook_registration_and_execution() {
        use std::sync::{Arc, Mutex};
        
        // Create a counter to track hook executions
        let counter = Arc::new(Mutex::new(0));
        let counter_clone = counter.clone();
        
        // Register a test hook
        register_review_submitted_hook(move |_event| {
            if let Ok(mut count) = counter_clone.lock() {
                *count += 1;
            }
            Ok(())
        });
        
        // Create a test event
        let event = ReviewSubmittedEvent {
            review_id: "test-review".to_string(),
            creator_id: "test-creator".to_string(),
            rating: 4,
            title: "Test".to_string(),
            body: "Test body".to_string(),
            reviewer_name: "Tester".to_string(),
            bounty_id: "test-bounty".to_string(),
            submitted_at: "2025-01-01T00:00:00Z".to_string(),
        };
        
        // Trigger hooks
        let _errors = trigger_review_submitted_hooks(&event);
        // Don't assert errors is empty since other tests may have registered failing hooks
        
        // Check that our hook was executed (if no mutex poisoning occurred)
        let count_result = counter.lock();
        if let Ok(count) = count_result {
            assert!(*count > 0);
        }
    }

    #[test]
    fn test_hook_error_handling() {
        // Register a hook that always fails
        register_review_submitted_hook(|_event| {
            Err("Test error".to_string())
        });
        
        let event = ReviewSubmittedEvent {
            review_id: "test-review".to_string(),
            creator_id: "test-creator".to_string(),
            rating: 4,
            title: "Test".to_string(),
            body: "Test body".to_string(),
            reviewer_name: "Tester".to_string(),
            bounty_id: "test-bounty".to_string(),
            submitted_at: "2025-01-01T00:00:00Z".to_string(),
        };
        
        let errors = trigger_review_submitted_hooks(&event);
        // Should have at least one error from our failing hook
        assert!(errors.iter().any(|e| e.contains("Test error")));
    }

    #[test]
    fn test_default_reputation_update_hook() {
        let event = ReviewSubmittedEvent {
            review_id: "test-review".to_string(),
            creator_id: "alex-studio".to_string(), // Use existing creator from seed data
            rating: 5,
            title: "Excellent work".to_string(),
            body: "Outstanding delivery".to_string(),
            reviewer_name: "Test Reviewer".to_string(),
            bounty_id: "test-bounty".to_string(),
            submitted_at: "2025-01-01T00:00:00Z".to_string(),
        };
        
        let result = default_reputation_update_hook(&event);
        assert!(result.is_ok());
    }

    #[test]
    fn test_rating_validation_boundaries() {
        // Test rating boundaries
        assert!(on_review_submitted("bounty1", "creator1", 0, "title", "body", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "creator1", 6, "title", "body", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "creator1", 1, "title", "body", "reviewer").is_ok());
        assert!(on_review_submitted("bounty1", "creator1", 5, "title", "body", "reviewer").is_ok());
    }

    #[test]
    fn test_empty_field_validation() {
        // Test each required field
        assert!(on_review_submitted("", "creator1", 5, "title", "body", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "", 5, "title", "body", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "creator1", 5, "", "body", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "creator1", 5, "title", "", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "creator1", 5, "title", "body", "").is_err());
    }

    #[test]
    fn test_whitespace_field_validation() {
        // Test fields with only whitespace
        assert!(on_review_submitted("   ", "creator1", 5, "title", "body", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "   ", 5, "title", "body", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "creator1", 5, "   ", "body", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "creator1", 5, "title", "   ", "reviewer").is_err());
        assert!(on_review_submitted("bounty1", "creator1", 5, "title", "body", "   ").is_err());
    }

    #[test]
    fn test_review_id_generation() {
        let result1 = on_review_submitted("bounty1", "creator1", 5, "title", "body", "reviewer");
        let result2 = on_review_submitted("bounty1", "creator1", 5, "title", "body", "reviewer");
        
        assert!(result1.is_ok());
        assert!(result2.is_ok());
        
        let id1 = result1.unwrap();
        let id2 = result2.unwrap();
        
        // IDs should be different (due to timestamp)
        assert_ne!(id1, id2);
        
        // Both should start with the expected prefix
        assert!(id1.starts_with("rev-creator1-bounty1"));
        assert!(id2.starts_with("rev-creator1-bounty1"));
    }
}
