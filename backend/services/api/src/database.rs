#[path = "db/mod.rs"]
pub mod db;

use std::env;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DatabaseEngine {
    PostgreSql,
    Sqlite,
}

impl DatabaseEngine {
    pub fn as_str(&self) -> &'static str {
        match self {
            DatabaseEngine::PostgreSql => "postgresql",
            DatabaseEngine::Sqlite => "sqlite",
        }
    }
}

pub fn select_database_engine() -> DatabaseEngine {
    select_database_engine_from(
        env::var("DB_ENGINE").ok().as_deref(),
        env::var("DATABASE_URL").ok().as_deref(),
        env::var("NODE_ENV").ok().as_deref(),
    )
}

fn select_database_engine_from(
    db_engine: Option<&str>,
    database_url: Option<&str>,
    node_env: Option<&str>,
) -> DatabaseEngine {
    if let Some(engine) = db_engine {
        return match engine.trim().to_ascii_lowercase().as_str() {
            "postgres" | "postgresql" | "pg" => DatabaseEngine::PostgreSql,
            "sqlite" | "sqlite3" => DatabaseEngine::Sqlite,
            other => panic!("Unsupported DB_ENGINE '{other}'. Use 'postgresql' or 'sqlite'."),
        };
    }

    if let Some(url) = database_url {
        let normalized = url.trim().to_ascii_lowercase();
        if normalized.starts_with("sqlite:") || normalized.ends_with(".db") {
            return DatabaseEngine::Sqlite;
        }
        if normalized.starts_with("postgres://") || normalized.starts_with("postgresql://") {
            return DatabaseEngine::PostgreSql;
        }
    }

    match node_env {
        Some("test") | Some("development") | Some("local") => DatabaseEngine::Sqlite,
        _ => DatabaseEngine::PostgreSql,
    }
}

// Re-export all database functionality for convenient access
pub use db::creators::{
    Creator, Project, CreatorStats,
    get_mock_creators, filter_creators, get_creator_by_id
};

pub use db::bounties::{
    Bounty, BountyRequest, BountyApplication,
    get_mock_bounties, get_bounty_by_id, create_bounty, apply_for_bounty
};

pub use db::freelancers::{
    Freelancer, FreelancerRegistration,
    get_mock_freelancers, get_freelancer_by_address, 
    filter_freelancers_by_discipline, register_freelancer
};

pub use db::escrows::{
    Escrow, EscrowCreateRequest, EscrowRefundRequest,
    get_mock_escrows, get_escrow_by_id, create_escrow, 
    release_escrow, refund_escrow
};

pub use db::reviews::{
    Review, ReviewSubmission, ReviewAggregation, CreatorReputationPayload,
    get_mock_reviews, reviews_for_creator, aggregate_reviews, 
    recent_reviews, submit_review
};

#[cfg(test)]
mod tests {
    use super::{select_database_engine_from, DatabaseEngine};

    #[test]
    fn defaults_to_postgresql_for_production() {
        assert_eq!(
            select_database_engine_from(None, None, Some("production")),
            DatabaseEngine::PostgreSql,
        );
    }

    #[test]
    fn keeps_sqlite_available_for_local_and_tests() {
        assert_eq!(
            select_database_engine_from(None, None, Some("development")),
            DatabaseEngine::Sqlite,
        );
        assert_eq!(
            select_database_engine_from(Some("sqlite"), None, Some("production")),
            DatabaseEngine::Sqlite,
        );
    }

    #[test]
    fn database_url_selects_engine_when_db_engine_is_absent() {
        assert_eq!(
            select_database_engine_from(None, Some("postgres://user:pass@localhost/app"), None),
            DatabaseEngine::PostgreSql,
        );
        assert_eq!(
            select_database_engine_from(None, Some("sqlite:./stellar.db"), None),
            DatabaseEngine::Sqlite,
        );
    }
}
