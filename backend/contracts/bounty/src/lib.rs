#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum BountyStatus {
    Open = 0,
    InProgress = 1,
    Completed = 2,
    Disputed = 3,
    Cancelled = 4,
    PendingCompletion = 5,
}

#[contracttype]
pub struct Bounty {
    pub id: u64,
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub budget: i128,
    pub deadline: u64,
    pub status: BountyStatus,
    pub created_at: u64,
}

#[contracttype]
pub struct BountyApplication {
    pub id: u64,
    pub bounty_id: u64,
    pub freelancer: Address,
    pub proposal: String,
    pub proposed_budget: i128,
    pub timeline: u64,
    pub created_at: u64,
}

#[contracttype]
pub enum DataKey {
    BountyCounter,
    AppCounter,
    Bounty(u64),
    Application(u64),
    SelectedFreelancer(u64),
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

        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BountyCounter)
            .unwrap_or(0);
        counter += 1;

        let bounty = Bounty {
            id: counter,
            creator,
            title,
            description,
            budget,
            deadline,
            status: BountyStatus::Open,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Bounty(counter), &bounty);
        env.storage()
            .persistent()
            .set(&DataKey::BountyCounter, &counter);

        counter
    }

    pub fn get_bounty(env: Env, bounty_id: u64) -> Bounty {
        env.storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
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

        let mut counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::AppCounter)
            .unwrap_or(0);
        counter += 1;

        let application = BountyApplication {
            id: counter,
            bounty_id,
            freelancer,
            proposal,
            proposed_budget,
            timeline,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Application(counter), &application);
        env.storage()
            .persistent()
            .set(&DataKey::AppCounter, &counter);

        counter
    }

    pub fn get_application(env: Env, application_id: u64) -> BountyApplication {
        env.storage()
            .persistent()
            .get(&DataKey::Application(application_id))
            .expect("Application not found")
    }

    pub fn select_freelancer(env: Env, bounty_id: u64, application_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        bounty.creator.require_auth();

        let application: BountyApplication = env
            .storage()
            .persistent()
            .get(&DataKey::Application(application_id))
            .expect("Application not found");

        assert!(
            application.bounty_id == bounty_id,
            "Application does not match bounty"
        );

        env.storage().persistent().set(
            &DataKey::SelectedFreelancer(bounty_id),
            &application.freelancer,
        );

        bounty.status = BountyStatus::InProgress;
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &bounty);

        true
    }

    /// Called by the selected freelancer to signal work is done.
    /// Transitions the bounty from InProgress -> PendingCompletion.
    pub fn submit_completion(env: Env, bounty_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        assert!(bounty.status == BountyStatus::InProgress, "Bounty not in progress");

        let freelancer: Address = env
            .storage()
            .persistent()
            .get(&DataKey::SelectedFreelancer(bounty_id))
            .expect("No freelancer selected");

        freelancer.require_auth();

        bounty.status = BountyStatus::PendingCompletion;
        env.storage().persistent().set(&DataKey::Bounty(bounty_id), &bounty);

        true
    }

    /// Called by the bounty creator to approve the freelancer's completion submission.
    /// Transitions the bounty from PendingCompletion -> Completed.
    pub fn complete_bounty(env: Env, bounty_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        bounty.creator.require_auth();
        assert!(
            bounty.status == BountyStatus::InProgress,
            "Bounty not in progress"
            bounty.status == BountyStatus::PendingCompletion,
            "Bounty not pending completion"
        );

        // Verify work was submitted before allowing completion
        let submission_key = Symbol::new(&env, &format!("work_submission_{}", bounty_id));
        let submission: Option<WorkSubmission> = env.storage().persistent().get(&submission_key);

        if let Some(mut sub) = submission {
            // Mark submission as approved
            sub.approved = true;
            env.storage().persistent().set(&submission_key, &sub);
        } else {
            // Allow completion without submission for backward compatibility
            // But in new workflow, creator should call submit_work first
        }

        bounty.status = BountyStatus::Completed;
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &bounty);

        true
    }

    pub fn cancel_bounty(env: Env, bounty_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        bounty.creator.require_auth();
        assert!(
            bounty.status == BountyStatus::Open,
            "Only open bounties can be cancelled"
        );

        bounty.status = BountyStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &bounty);

        true
    }

    pub fn get_bounties_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::BountyCounter)
            .unwrap_or(0)
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
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
        );

        assert_eq!(bounty_id, 1);
        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.creator, creator);
        assert_eq!(bounty.budget, 5000i128);
    }

    #[test]
    fn test_apply_for_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
        );

        let app_id = client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I can do this!"),
            &4500i128,
            &30u64,
        );

        assert_eq!(app_id, 1);
        let application = client.get_application(&app_id);
        assert_eq!(application.freelancer, freelancer);
    }

    #[test]
    fn test_completion_workflow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
    fn test_submit_work_and_complete() {
        let env = Env::default();
        let contract =
            BountyContractClient::new(&env, &env.register_contract(None, BountyContract));

        let creator = Address::random(&env);
        let freelancer = Address::random(&env);

        // Create bounty
        let bounty_id = contract.create_bounty(
            &creator,
            &String::from_slice(&env, "Test Bounty"),
            &String::from_slice(&env, "Test Description"),
            &5000i128,
            &100u64,
        );

        let app_id = client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I can do this!"),
        // Apply for bounty
        let app_id = contract.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_slice(&env, "I can do this!"),
            &4500i128,
            &30u64,
        );

        client.select_freelancer(&bounty_id, &app_id);

        // Freelancer submits completion
        let result = client.submit_completion(&bounty_id);
        assert!(result);
        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::PendingCompletion);

        // Creator approves completion
        let result = client.complete_bounty(&bounty_id);
        assert!(result);
        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Completed);
        // Select freelancer
        contract.select_freelancer(&bounty_id, &app_id);

        // Submit work (freelancer)
        let work_url = String::from_slice(&env, "https://github.com/freelancer/project/pull/1");
        let notes = String::from_slice(&env, "Completed all requirements");
        let result = contract.submit_work(&bounty_id, &work_url, &notes);
        assert_eq!(result, true);

        // Verify submission
        let submission = contract.get_work_submission(&bounty_id);
        assert!(submission.is_some());
        let sub = submission.unwrap();
        assert_eq!(sub.freelancer, freelancer);
        assert_eq!(sub.approved, false);

        // Complete bounty (creator)
        let result = contract.complete_bounty(&bounty_id);
        assert_eq!(result, true);

        // Verify completion
        let bounty = contract.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Completed);

        // Verify submission approved
        let submission = contract.get_work_submission(&bounty_id);
        let sub = submission.unwrap();
        assert_eq!(sub.approved, true);
    }
}
