#![no_std]

extern crate alloc;
use alloc::format;

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, String, Symbol, Vec, Map, 
    IntoVal, FromVal, TryFromVal,
};

/// Bounty Status Enum
#[derive(Clone, Copy, PartialEq)]
#[contracttype]
pub enum BountyStatus {
    Open = 0,
    InProgress = 1,
    Completed = 2,
    Disputed = 3,
    Cancelled = 4,
}

/// Bounty Struct
#[contracttype]
pub struct Bounty {
    pub id: u64,
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub budget: i128,
    pub deadline: u64,
    pub status: BountyStatus,
    pub selected_freelancer: Option<Address>,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

/// Bounty Application Struct
#[contracttype]
pub struct BountyApplication {
    pub id: u64,
    pub bounty_id: u64,
    pub freelancer: Address,
    pub proposal: String,
    pub proposed_budget: i128,
    pub timeline: u64, // in days
    pub status: String, // "pending", "accepted", "rejected"
    pub created_at: u64,
}

#[contract]
pub struct BountyContract;

#[contractimpl]
impl BountyContract {
    pub fn create_bounty(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        budget: i128,
        deadline: u64,
    ) -> u64 {
        creator.require_auth();

        let bounty_counter_key = Symbol::new(&env, "bounty_counter");
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&bounty_counter_key)
            .unwrap_or(0);

        counter += 1;
        let bounty_id = counter;

        let bounty = Bounty {
            id: bounty_id,
            creator: creator.clone(),
            title,
            description,
            budget,
            deadline,
            status: BountyStatus::Open,
            selected_freelancer: None,
            created_at: env.ledger().timestamp(),
            completed_at: None,
        };

        let bounty_key = Symbol::new(&env, &format!("bounty_{}", bounty_id));
        env.storage().persistent().set(&bounty_key, &bounty);
        env.storage()
            .persistent()
            .set(&bounty_counter_key, &counter);

        bounty_id
    }

    pub fn get_bounty(env: Env, bounty_id: u64) -> Bounty {
        let bounty_key = Symbol::new(&env, &format!("bounty_{}", bounty_id));
        env.storage()
            .persistent()
            .get::<Symbol, Bounty>(&bounty_key)
            .expect("Bounty not found")
    }

    pub fn apply_for_bounty(
        env: Env,
        bounty_id: u64,
        freelancer: Address,
        proposal: String,
        proposed_budget: i128,
        timeline: u64,
    ) -> u64 {
        freelancer.require_auth();

        let app_counter_key = Symbol::new(&env, "application_counter");
        let mut counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&app_counter_key)
            .unwrap_or(0);

        counter += 1;
        let application_id = counter;

        let application = BountyApplication {
            id: application_id,
            bounty_id,
            freelancer,
            proposal,
            proposed_budget,
            timeline,
            status: String::from_slice(&env, "pending"),
            created_at: env.ledger().timestamp(),
        };

        let app_key = Symbol::new(&env, &format!("application_{}", application_id));
        env.storage().persistent().set(&app_key, &application);
        env.storage()
            .persistent()
            .set(&app_counter_key, &counter);

        application_id
    }

    pub fn get_application(env: Env, application_id: u64) -> BountyApplication {
        let app_key = Symbol::new(&env, &format!("application_{}", application_id));
        env.storage()
            .persistent()
            .get::<Symbol, BountyApplication>(&app_key)
            .expect("Application not found")
    }

    pub fn select_freelancer(
        env: Env,
        bounty_id: u64,
        application_id: u64,
    ) -> bool {
        let bounty_key = Symbol::new(&env, &format!("bounty_{}", bounty_id));
        let mut bounty = env
            .storage()
            .persistent()
            .get::<Symbol, Bounty>(&bounty_key)
            .expect("Bounty not found");

        bounty.creator.require_auth();

        let application = Self::get_application(env.clone(), application_id);
        assert_eq!(application.bounty_id, bounty_id, "Application does not match bounty");

        bounty.selected_freelancer = Some(application.freelancer);
        bounty.status = BountyStatus::InProgress;

        env.storage().persistent().set(&bounty_key, &bounty);

        true
    }

    pub fn complete_bounty(env: Env, bounty_id: u64) -> bool {
        let bounty_key = Symbol::new(&env, &format!("bounty_{}", bounty_id));
        let mut bounty = env
            .storage()
            .persistent()
            .get::<Symbol, Bounty>(&bounty_key)
            .expect("Bounty not found");

        bounty.creator.require_auth();
        assert!(bounty.status == BountyStatus::InProgress, "Bounty not in progress");

        bounty.status = BountyStatus::Completed;
        bounty.completed_at = Some(env.ledger().timestamp());

        env.storage().persistent().set(&bounty_key, &bounty);

        true
    }

    pub fn cancel_bounty(env: Env, bounty_id: u64) -> bool {
        let bounty_key = Symbol::new(&env, &format!("bounty_{}", bounty_id));
        let mut bounty = env
            .storage()
            .persistent()
            .get::<Symbol, Bounty>(&bounty_key)
            .expect("Bounty not found");

        bounty.creator.require_auth();
        assert!(bounty.status == BountyStatus::Open, "Only open bounties can be cancelled");

        bounty.status = BountyStatus::Cancelled;

        env.storage().persistent().set(&bounty_key, &bounty);

        true
    }

    pub fn get_bounties_count(env: Env) -> u64 {
        let bounty_counter_key = Symbol::new(&env, "bounty_counter");
        env.storage()
            .persistent()
            .get::<Symbol, u64>(&bounty_counter_key)
            .unwrap_or(0)
    }

    pub fn get_applications(env: Env, bounty_id: u64) -> Vec<BountyApplication> {
        let mut applications = Vec::new(&env);
        let app_counter_key = Symbol::new(&env, "application_counter");
        let counter: u64 = env
            .storage()
            .persistent()
            .get::<Symbol, u64>(&app_counter_key)
            .unwrap_or(0);

        for i in 1..=counter {
            let app_key = Symbol::new(&env, &format!("application_{}", i));
            if let Some(app) = env
                .storage()
                .persistent()
                .get::<Symbol, BountyApplication>(&app_key)
            {
                if app.bounty_id == bounty_id {
                    applications.push_back(app);
                }
            }
        }

        applications
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_create_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register_contract(None, BountyContract));

        let creator = Address::generate(&env);
        let title = String::from_slice(&env, "Test Bounty");
        let description = String::from_slice(&env, "Test Description");

        let bounty_id = contract.create_bounty(
            &creator,
            &title,
            &description,
            &5000i128,
            &100u64,
        );

        assert_eq!(bounty_id, 1);

        let bounty = contract.get_bounty(&bounty_id);
        assert_eq!(bounty.creator, creator);
        assert_eq!(bounty.budget, 5000i128);
    }

    #[test]
    fn test_apply_for_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract = BountyContractClient::new(&env, &env.register_contract(None, BountyContract));

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_slice(&env, "Test Bounty"),
            &String::from_slice(&env, "Test Description"),
            &5000i128,
            &100u64,
        );

        let app_id = contract.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_slice(&env, "I can do this!"),
            &4500i128,
            &30u64,
        );

        assert_eq!(app_id, 1);

        let application = contract.get_application(&app_id);
        assert_eq!(application.freelancer, freelancer);
    }
}
