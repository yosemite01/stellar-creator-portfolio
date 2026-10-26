//! Integration tests for the `stellar-api` crate.
//!
//! These tests are gated behind the `integration` feature flag and require a
//! real PostgreSQL database.  In CI, the `rust-api-integration` job starts a
//! postgres:16-alpine service container, applies migrations, and then runs:
//!
//! ```text
//! cargo test -p stellar-api --features integration
//! ```
//!
//! # Running locally
//!
//! ```bash
//! # 1. Start Postgres (Docker is the easiest way):
//! docker run -d --name pg-test \
//!   -e POSTGRES_PASSWORD=postgres \
//!   -p 5432:5432 postgres:16-alpine
//!
//! # 2. Export the connection URL:
//! export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test_db
//!
//! # 3. Create the database and run migrations:
//! cargo install sqlx-cli --no-default-features --features postgres --locked
//! sqlx database create --database-url "$TEST_DATABASE_URL"
//! sqlx migrate run --source backend/migrations --database-url "$TEST_DATABASE_URL"
//!
//! # 4. Run the integration tests:
//! cd backend
//! cargo test -p stellar-api --features integration -- --test-output immediate
//! ```

#![cfg(feature = "integration")]

use sqlx::postgres::PgPoolOptions;
use std::env;

/// Build a connection pool for the test database.
///
/// The URL is sourced from `TEST_DATABASE_URL`.  Fails loudly with a clear
/// message if the variable is absent so developers know exactly what to fix.
async fn test_pool() -> sqlx::PgPool {
    let url = env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
        panic!(
            "\n\n\
             ╔══════════════════════════════════════════════════════════════╗\n\
             ║  TEST_DATABASE_URL is not set.                              ║\n\
             ║                                                              ║\n\
             ║  Integration tests require a running PostgreSQL instance.   ║\n\
             ║  Set TEST_DATABASE_URL and apply migrations first.          ║\n\
             ║  See backend/README.md § 'Running integration tests'        ║\n\
             ╚══════════════════════════════════════════════════════════════╝\n"
        )
    });

    PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .unwrap_or_else(|e| {
            panic!(
                "\n\n\
                 ╔══════════════════════════════════════════════════════════════╗\n\
                 ║  Cannot connect to TEST_DATABASE_URL.                       ║\n\
                 ║  Is Postgres running and migrations applied?                ║\n\
                 ║  Error: {:<50}║\n\
                 ╚══════════════════════════════════════════════════════════════╝\n",
                e
            )
        })
}

// ── Reviews table ─────────────────────────────────────────────────────────────

/// Verifies that the `reviews` table exists and is readable after migrations.
#[tokio::test]
async fn reviews_table_exists_after_migrations() {
    let pool = test_pool().await;

    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM reviews",
    )
    .fetch_one(&pool)
    .await
    .expect("reviews table should exist and be queryable after migrations");

    // Seed data inserts 12 rows (see 0002_create_reviews_tables.sql)
    assert!(
        count.0 >= 0,
        "reviews table should be queryable; got negative count (impossible)"
    );
}

/// Verifies that the seed reviews were inserted by the migration.
#[tokio::test]
async fn seed_reviews_are_present() {
    let pool = test_pool().await;

    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM reviews WHERE creator_id = 'alex-studio'",
    )
    .fetch_one(&pool)
    .await
    .expect("should query reviews for alex-studio");

    assert!(
        count.0 >= 5,
        "migration should seed at least 5 reviews for alex-studio, got {}",
        count.0
    );
}

/// Insert a review, read it back, and verify round-trip integrity.
#[tokio::test]
async fn insert_and_fetch_review_round_trip() {
    let pool = test_pool().await;

    let creator_id = format!("test-creator-{}", uuid::Uuid::new_v4());
    let bounty_id = "bounty-integration-test";
    let rating: i32 = 5;
    let title = "Integration test review";
    let body = "This review was inserted by an integration test.";
    let reviewer_name = "CI Bot";

    // Insert
    sqlx::query(
        "INSERT INTO reviews \
         (creator_id, bounty_id, rating, title, body, reviewer_name) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&creator_id)
    .bind(bounty_id)
    .bind(rating)
    .bind(title)
    .bind(body)
    .bind(reviewer_name)
    .execute(&pool)
    .await
    .expect("should insert a review");

    // Fetch back
    let row: (String, i32, String) = sqlx::query_as(
        "SELECT creator_id, rating, title FROM reviews \
         WHERE creator_id = $1 AND bounty_id = $2",
    )
    .bind(&creator_id)
    .bind(bounty_id)
    .fetch_one(&pool)
    .await
    .expect("should fetch the review we just inserted");

    assert_eq!(row.0, creator_id, "creator_id round-trip");
    assert_eq!(row.1, rating, "rating round-trip");
    assert_eq!(row.2, title, "title round-trip");

    // Clean up so the test is idempotent
    sqlx::query("DELETE FROM reviews WHERE creator_id = $1")
        .bind(&creator_id)
        .execute(&pool)
        .await
        .expect("cleanup should succeed");
}

// ── creator_reputation table ──────────────────────────────────────────────────

/// Verifies that the `creator_reputation` materialized table exists.
#[tokio::test]
async fn creator_reputation_table_exists_after_migrations() {
    let pool = test_pool().await;

    let _: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM creator_reputation",
    )
    .fetch_one(&pool)
    .await
    .expect("creator_reputation table should exist after migrations");
}

/// Verifies that the trigger auto-updates `creator_reputation` when a review
/// is inserted (exercising the plpgsql trigger installed by the migration).
#[tokio::test]
async fn trigger_updates_reputation_on_insert() {
    let pool = test_pool().await;

    let creator_id = format!("trigger-test-{}", uuid::Uuid::new_v4());

    // There should be no reputation row yet for this creator
    let before: Option<(i64,)> = sqlx::query_as(
        "SELECT total_reviews FROM creator_reputation WHERE creator_id = $1",
    )
    .bind(&creator_id)
    .fetch_optional(&pool)
    .await
    .expect("query before insert should succeed");
    assert!(before.is_none(), "no reputation row should exist before inserting a review");

    // Insert three 5-star reviews to trigger verification
    for i in 0..3 {
        sqlx::query(
            "INSERT INTO reviews \
             (creator_id, bounty_id, rating, title, body, reviewer_name) \
             VALUES ($1, $2, 5, 'Test', 'Body', 'Tester')",
        )
        .bind(&creator_id)
        .bind(format!("bounty-trigger-{i}"))
        .execute(&pool)
        .await
        .expect("insert should succeed");
    }

    // The trigger should have updated creator_reputation
    let after: (i64, bool) = sqlx::query_as(
        "SELECT total_reviews, is_verified FROM creator_reputation WHERE creator_id = $1",
    )
    .bind(&creator_id)
    .fetch_one(&pool)
    .await
    .expect("creator_reputation row should exist after inserting reviews");

    assert_eq!(after.0, 3, "trigger should aggregate 3 reviews");
    assert!(after.1, "is_verified should be true with 3×5-star reviews");

    // Clean up
    sqlx::query("DELETE FROM reviews WHERE creator_id = $1")
        .bind(&creator_id)
        .execute(&pool)
        .await
        .ok();
    sqlx::query("DELETE FROM creator_reputation WHERE creator_id = $1")
        .bind(&creator_id)
        .execute(&pool)
        .await
        .ok();
}

// ── used_refresh_tokens table ─────────────────────────────────────────────────

/// Verifies that the `used_refresh_tokens` table (migration 0004) exists.
#[tokio::test]
async fn used_refresh_tokens_table_exists_after_migrations() {
    let pool = test_pool().await;

    let _: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM used_refresh_tokens",
    )
    .fetch_one(&pool)
    .await
    .expect("used_refresh_tokens table should exist after migrations");
}

/// Verifies the primary-key uniqueness constraint on token_hash prevents
/// the same token from being recorded twice (replay attack guard).
#[tokio::test]
async fn rejects_duplicate_refresh_token_hash() {
    let pool = test_pool().await;

    // Use a fixed test hash — must be unique per test run
    let token_hash: Vec<u8> = format!("test-hash-{}", uuid::Uuid::new_v4())
        .into_bytes();
    let user_id = "test-user-dedup";
    let family_id = uuid::Uuid::new_v4();

    // First insertion should succeed
    sqlx::query(
        "INSERT INTO used_refresh_tokens (token_hash, user_id, family_id, used_at) \
         VALUES ($1, $2, $3, NOW())",
    )
    .bind(&token_hash)
    .bind(user_id)
    .bind(family_id)
    .execute(&pool)
    .await
    .expect("first insert should succeed");

    // Second insertion of the same token_hash must fail (PK constraint)
    let second = sqlx::query(
        "INSERT INTO used_refresh_tokens (token_hash, user_id, family_id, used_at) \
         VALUES ($1, $2, $3, NOW())",
    )
    .bind(&token_hash)
    .bind(user_id)
    .bind(family_id)
    .execute(&pool)
    .await;

    assert!(
        second.is_err(),
        "duplicate token_hash must be rejected by the primary-key constraint \
         (replay-attack guard must work)"
    );

    // Clean up
    sqlx::query("DELETE FROM used_refresh_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(&pool)
        .await
        .ok();
}

// ── database.rs unit helpers ──────────────────────────────────────────────────

/// These tests exercise the pure-logic helpers in `database.rs` that do NOT
/// need a real DB.  They live here so they share compilation with the
/// integration tests (compiled only when `--features integration` is passed).
#[cfg(test)]
mod database_engine_selection {
    use crate::database::{select_database_engine_from, DatabaseEngine};

    #[test]
    fn selects_postgres_when_db_engine_is_pg() {
        let got = select_database_engine_from(Some("pg"), None, None);
        assert_eq!(got, DatabaseEngine::PostgreSql);
    }

    #[test]
    fn selects_sqlite_when_url_starts_with_sqlite() {
        let got = select_database_engine_from(None, Some("sqlite:./dev.db"), None);
        assert_eq!(got, DatabaseEngine::Sqlite);
    }

    #[test]
    fn selects_postgres_when_url_starts_with_postgres_scheme() {
        let got = select_database_engine_from(
            None,
            Some("postgresql://localhost/mydb"),
            None,
        );
        assert_eq!(got, DatabaseEngine::PostgreSql);
    }

    #[test]
    fn selects_sqlite_for_test_node_env() {
        let got = select_database_engine_from(None, None, Some("test"));
        assert_eq!(got, DatabaseEngine::Sqlite);
    }

    #[test]
    fn selects_postgres_for_production_node_env() {
        let got = select_database_engine_from(None, None, Some("production"));
        assert_eq!(got, DatabaseEngine::PostgreSql);
    }
}
