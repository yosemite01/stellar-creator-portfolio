#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_creators_module() {
        let creators = crate::database::db::creators::get_mock_creators();
        assert!(!creators.is_empty());
        
        let filtered = crate::database::db::creators::filter_creators(
            creators.clone(), 
            Some("UI/UX Design".to_string()), 
            None
        );
        assert!(!filtered.is_empty());
        
        let creator = crate::database::db::creators::get_creator_by_id("alex-studio");
        assert!(creator.is_some());
    }

    #[test]
    fn test_bounties_module() {
        let bounties = crate::database::db::bounties::get_mock_bounties();
        assert!(!bounties.is_empty());
        
        let bounty = crate::database::db::bounties::get_bounty_by_id(1);
        assert!(bounty.is_some());
        
        let request = crate::database::db::bounties::BountyRequest {
            creator: "test-creator".to_string(),
            title: "Test Bounty".to_string(),
            description: "Test Description".to_string(),
            budget: 1000,
            deadline: 1234567890,
        };
        
        let created = crate::database::db::bounties::create_bounty(request);
        assert_eq!(created.title, "Test Bounty");
    }

    #[test]
    fn test_freelancers_module() {
        let freelancers = crate::database::db::freelancers::get_mock_freelancers();
        assert!(!freelancers.is_empty());
        
        let freelancer = crate::database::db::freelancers::get_freelancer_by_address("GABC123DEF456GHI789");
        assert!(freelancer.is_some());
        
        let filtered = crate::database::db::freelancers::filter_freelancers_by_discipline(
            freelancers.clone(), 
            "UI/UX Design"
        );
        assert!(!filtered.is_empty());
    }

    #[test]
    fn test_escrows_module() {
        let escrows = crate::database::db::escrows::get_mock_escrows();
        assert!(!escrows.is_empty());
        
        let escrow = crate::database::db::escrows::get_escrow_by_id(1);
        assert!(escrow.is_some());
        
        let request = crate::database::db::escrows::EscrowCreateRequest {
            bounty_id: "test-bounty".to_string(),
            payer_address: "GPAYER".to_string(),
            payee_address: "GPAYEE".to_string(),
            amount: 1000,
            token: "GUSDC".to_string(),
            timelock: Some(1234567890),
        };
        
        let created = crate::database::db::escrows::create_escrow(request);
        assert_eq!(created.amount, 1000);
    }

    #[test]
    fn test_reviews_module() {
        let reviews = crate::database::db::reviews::get_mock_reviews();
        assert!(!reviews.is_empty());
        
        let creator_reviews = crate::database::db::reviews::reviews_for_creator("alex-studio");
        assert!(!creator_reviews.is_empty());
        
        let aggregation = crate::database::db::reviews::aggregate_reviews(&creator_reviews);
        assert!(aggregation.total_reviews > 0);
        assert!(aggregation.average_rating > 0.0);
        
        let submission = crate::database::db::reviews::ReviewSubmission {
            bounty_id: "test-bounty".to_string(),
            creator_id: "test-creator".to_string(),
            rating: 5,
            title: "Great work".to_string(),
            body: "Excellent job!".to_string(),
            reviewer_name: "Test Reviewer".to_string(),
        };
        
        let result = crate::database::db::reviews::submit_review(submission);
        assert!(result.is_ok());
    }
}
