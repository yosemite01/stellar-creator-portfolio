use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BountyRequest {
    pub creator: String,
    pub title: String,
    pub description: String,
    pub budget: i128,
    pub deadline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BountyApplication {
    pub bounty_id: u64,
    pub freelancer: String,
    pub proposal: String,
    pub proposed_budget: i128,
    pub timeline: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Bounty {
    pub id: u64,
    pub title: String,
    pub description: String,
    pub budget: i128,
    pub deadline: u64,
    pub status: String,
    pub creator: String,
}

pub fn get_mock_bounties() -> Vec<Bounty> {
    vec![
        Bounty {
            id: 1,
            title: "Design a landing page".to_string(),
            description: "Create a modern, responsive landing page for a SaaS product".to_string(),
            budget: 5000,
            deadline: 1640995200, // 2021-12-31
            status: "open".to_string(),
            creator: "alex-studio".to_string(),
        },
        Bounty {
            id: 2,
            title: "Build API integration".to_string(),
            description: "Integrate third-party payment API into existing application".to_string(),
            budget: 3000,
            deadline: 1640995200,
            status: "in_progress".to_string(),
            creator: "jordan-dev".to_string(),
        },
    ]
}

pub fn get_bounty_by_id(bounty_id: u64) -> Option<Bounty> {
    let bounties = get_mock_bounties();
    bounties.into_iter().find(|bounty| bounty.id == bounty_id)
}

pub fn create_bounty(request: BountyRequest) -> Bounty {
    Bounty {
        id: 1, // In production, this would be generated
        title: request.title,
        description: request.description,
        budget: request.budget,
        deadline: request.deadline,
        status: "open".to_string(),
        creator: request.creator,
    }
}

pub fn apply_for_bounty(bounty_id: u64, application: BountyApplication) -> Result<(), String> {
    // In production, this would validate and store the application
    if application.proposal.trim().is_empty() {
        return Err("Proposal cannot be empty".to_string());
    }
    if application.proposed_budget <= 0 {
        return Err("Proposed budget must be positive".to_string());
    }
    Ok(())
}
