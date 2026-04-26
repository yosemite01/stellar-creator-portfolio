#[path = "db/mod.rs"]
pub mod db;

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
