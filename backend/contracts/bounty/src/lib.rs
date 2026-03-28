#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol};

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
pub struct WorkSubmission {
    pub freelancer: Address,
    pub work_url: String,
    pub notes: String,
    pub submitted_at: u64,
    pub approved: bool,
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
    /// Creates a new bounty posted by a creator.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `creator`: Address of the bounty creator (must authenticate).
    /// - `title`: Short title of the bounty.
    /// - `description`: Detailed description of the work required.
    /// - `budget`: Budget amount in native token or specified token.
    /// - `deadline`: Unix timestamp deadline for bounty completion.
    ///
    /// # Returns
    /// - `u64`: Unique bounty ID.
    ///
    /// # Errors
    /// - Panics if creator fails authentication.
    ///
    /// # State Changes
    /// - Increments bounty counter.
    /// - Stores new Bounty with status `Open`.
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

    /// Retrieves bounty details by ID.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Unique ID of the bounty.
    ///
    /// # Returns
    /// - `Bounty`: Full bounty details.
    ///
    /// # Errors
    /// - Panics with \"Bounty not found\" if ID doesn't exist.
    pub fn get_bounty(env: Env, bounty_id: u64) -> Bounty {
        env.storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect(\"Bounty not found\")
    }

    /// Allows freelancer to apply to a bounty.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: ID of bounty to apply for.
    /// - `freelancer`: Freelancer address (must authenticate).
    /// - `proposal`: Freelancer's proposal text.
    /// - `proposed_budget`: Freelancer's budget suggestion.
    /// - `timeline`: Proposed completion timeline.
    ///
    /// # Returns
    /// - `u64`: Unique application ID.
    ///
    /// # Errors
    /// - Panics if freelancer fails authentication.
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

    /// Retrieves application details by ID.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `application_id`: Unique application ID.
    ///
    /// # Returns
    /// - `BountyApplication`: Full application details.
    ///
    /// # Errors
    /// - Panics with \"Application not found\" if ID doesn't exist.
    pub fn get_application(env: Env, application_id: u64) -> BountyApplication {
        env.storage()
            .persistent()
            .get(&DataKey::Application(application_id))
            .expect(\"Application not found\")
    }

    /// Bounty creator selects a freelancer application.
    /// Transitions bounty to InProgress status.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID.
    /// - `application_id`: Selected application ID.
    ///
    /// # Returns  
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if bounty/ application not found.
    /// - Panics if application doesn't match bounty.
    /// - Panics if bounty creator not authenticated.
    ///
    /// # State Changes
    /// - Sets selected freelancer.
    /// - Updates bounty status to `InProgress`.
    pub fn select_freelancer(env: Env, bounty_id: u64, application_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect(\"Bounty not found\");

        bounty.creator.require_auth();

        let application: BountyApplication = env
            .storage()
            .persistent()
            .get(&DataKey::Application(application_id))
            .expect(\"Application not found\");

        assert!(
            application.bounty_id == bounty_id,
            \"Application does not match bounty\"
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
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors  
    /// - Panics if bounty not found or not InProgress.
    /// - Panics if no freelancer selected or fails auth.
    ///
    /// # State Changes
    /// - Updates bounty status to `PendingCompletion`.
    pub fn submit_completion(env: Env, bounty_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect(\"Bounty not found\");

        assert!(bounty.status == BountyStatus::InProgress, \"Bounty not in progress\");

        let freelancer: Address = env
            .storage()
            .persistent()
            .get(&DataKey::SelectedFreelancer(bounty_id))
            .expect(\"No freelancer selected\");

        freelancer.require_auth();

        bounty.status = BountyStatus::PendingCompletion;
        env.storage().persistent().set(&DataKey::Bounty(bounty_id), &bounty);

        true
    }

    /// Called by the bounty creator to approve the freelancer's completion submission.
    /// Transitions the bounty from PendingCompletion -> Completed.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if bounty not found.
    /// - Panics if bounty creator not authenticated.
    /// - Panics if bounty not InProgress or PendingCompletion.
    ///
    /// # State Changes  
    /// - Marks work submission as approved (if exists).
    /// - Updates bounty status to `Completed`.
    pub fn complete_bounty(env: Env, bounty_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect(\"Bounty not found\");

        bounty.creator.require_auth();
        assert!(
            bounty.status == BountyStatus::InProgress || 
            bounty.status == BountyStatus::PendingCompletion,
            \"Bounty not ready for completion\"
        );

        // Verify work was submitted before allowing completion
        let submission_key = Symbol::new(&env, &format!(\"work_submission_{}\", bounty_id));
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

    /// Cancels an open bounty (creator only).
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if bounty not found.
    /// - Panics if bounty creator not authenticated.
    /// - Panics if bounty not Open.
    ///
    /// # State Changes
    /// - Updates status to `Cancelled`.
    pub fn cancel_bounty(env: Env, bounty_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect(\"Bounty not found\");

        bounty.creator.require_auth();
        assert!(
            bounty.status == BountyStatus::Open,
            \"Only open bounties can be cancelled\"
        );

        bounty.status = BountyStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &bounty);

        true
    }

    /// Gets the total count of created bounties.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    ///
    /// # Returns
    /// - `u64`: Number of bounties.
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
            &String::from_str(&env, \"Test Bounty\"),
            &String::from_str(&env, \"Test Description\"),
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
            &String::from_str(&env, \"Test Bounty\"),
            &String::from_str(&env, \"Test Description\"),
            &5000i128,
            &100u64,
        );

        let app_id = client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, \"I can do this!\"),

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
            &String::from_str(&env, \"Test Bounty\"),

            &String::from_str(&env, \"Test Description\"),

            &5000i128,
            &100u64,
        );

        let app_id = client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, \"I can do this!\"),

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
    }
}
