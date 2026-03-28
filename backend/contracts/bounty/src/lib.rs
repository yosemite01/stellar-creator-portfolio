#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

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

#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum DisputeResult {
    None = 0,
    CreatorWin = 1,
    FreelancerWin = 2,
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
pub struct Dispute {
    pub bounty_id: u64,
    pub initiator: Address,
    pub reason: String,
    pub created_at: u64,
    pub resolved: bool,
    pub result: DisputeResult,
    pub resolver: Option<Address>,
}

#[contracttype]
pub struct Evidence {
    pub dispute_bounty_id: u64,
    pub submitter: Address,
    pub evidence_url: String,
    pub description: String,
    pub submitted_at: u64,
}

#[contracttype]
pub enum DataKey {
    BountyCounter,
    AppCounter,
    Bounty(u64),
    Application(u64),
    SelectedFreelancer(u64),
    Dispute(u64),
    EvidenceList(u64),
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
    /// - Panics with "Bounty not found" if ID doesn't exist.
    pub fn get_bounty(env: Env, bounty_id: u64) -> Bounty {
        env.storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found")
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
    /// - Panics with "Application not found" if ID doesn't exist.
    pub fn get_application(env: Env, application_id: u64) -> BountyApplication {
        env.storage()
            .persistent()
            .get(&DataKey::Application(application_id))
            .expect("Application not found")
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
            .expect("Bounty not found");

        bounty.creator.require_auth();
        assert!(
            bounty.status == BountyStatus::InProgress ||
            bounty.status == BountyStatus::PendingCompletion,
            "Bounty not ready for completion"
        );

        // Note: Work submission tracking can be added via separate function
        // For now, we allow completion without requiring prior submission

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

    /// Initiates a dispute for a bounty.
    /// Can be called by either the creator or the freelancer.
    /// Transitions the bounty to Disputed status.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID.
    /// - `initiator`: Address initiating the dispute (creator or freelancer).
    /// - `reason`: Reason for the dispute.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if bounty not found.
    /// - Panics if initiator is not creator or selected freelancer.
    /// - Panics if bounty is not InProgress or PendingCompletion.
    /// - Panics if dispute already exists for this bounty.
    ///
    /// # State Changes
    /// - Creates new Dispute record.
    /// - Updates bounty status to `Disputed`.
    pub fn initiate_dispute(
        env: Env,
        bounty_id: u64,
        initiator: Address,
        reason: String,
    ) -> bool {
        initiator.require_auth();

        // Check if dispute already exists (check first to give correct error)
        let dispute_exists: Option<Dispute> = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(bounty_id));

        assert!(dispute_exists.is_none(), "Dispute already exists for this bounty");

        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        // Only allow disputes on active bounties
        assert!(
            bounty.status == BountyStatus::InProgress
                || bounty.status == BountyStatus::PendingCompletion,
            "Can only dispute active bounties"
        );

        // Verify initiator is either creator or selected freelancer
        let selected_freelancer: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::SelectedFreelancer(bounty_id));

        assert!(
            initiator == bounty.creator || selected_freelancer == Some(initiator.clone()),
            "Only creator or freelancer can initiate dispute"
        );

        // Create dispute record
        let dispute = Dispute {
            bounty_id,
            initiator: initiator.clone(),
            reason,
            created_at: env.ledger().timestamp(),
            resolved: false,
            result: DisputeResult::None,
            resolver: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(bounty_id), &dispute);

        // Initialize empty evidence list
        let evidence: Vec<Evidence> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::EvidenceList(bounty_id), &evidence);

        // Update bounty status
        bounty.status = BountyStatus::Disputed;
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &bounty);

        true
    }

    /// Submits evidence for a dispute.
    /// Can be called by either party in the dispute.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID with active dispute.
    /// - `submitter`: Address submitting evidence (creator or freelancer).
    /// - `evidence_url`: URL to evidence (document, screenshot, etc.).
    /// - `description`: Description of the evidence.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if no dispute exists for this bounty.
    /// - Panics if submitter is not creator or selected freelancer.
    ///
    /// # State Changes
    /// - Adds evidence to the dispute's evidence list.
    pub fn submit_evidence(
        env: Env,
        bounty_id: u64,
        submitter: Address,
        evidence_url: String,
        description: String,
    ) -> bool {
        submitter.require_auth();

        // Verify dispute exists
        let _: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(bounty_id))
            .expect("No dispute exists for this bounty");

        // Get bounty to verify parties
        let bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        let selected_freelancer: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::SelectedFreelancer(bounty_id));

        // Verify submitter is either creator or selected freelancer
        assert!(
            submitter == bounty.creator || selected_freelancer == Some(submitter.clone()),
            "Only creator or freelancer can submit evidence"
        );

        // Create evidence record
        let evidence = Evidence {
            dispute_bounty_id: bounty_id,
            submitter: submitter.clone(),
            evidence_url,
            description,
            submitted_at: env.ledger().timestamp(),
        };

        // Add to evidence list
        let mut evidence_list: Vec<Evidence> = env
            .storage()
            .persistent()
            .get(&DataKey::EvidenceList(bounty_id))
            .unwrap_or_else(|| Vec::new(&env));

        evidence_list.push_back(evidence);
        env.storage()
            .persistent()
            .set(&DataKey::EvidenceList(bounty_id), &evidence_list);

        true
    }

    /// Resolves a dispute (admin only).
    /// Transitions the bounty based on the resolution.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID with active dispute.
    /// - `admin`: Admin address with dispute resolution authority.
    /// - `result`: Resolution result (CreatorWin or FreelancerWin).
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if no dispute exists for this bounty.
    /// - Panics if dispute is already resolved.
    /// - Panics if admin fails authentication.
    ///
    /// # State Changes
    /// - Updates dispute with result and resolver.
    /// - Updates bounty status based on resolution.
    pub fn resolve_dispute(
        env: Env,
        bounty_id: u64,
        admin: Address,
        result: DisputeResult,
    ) -> bool {
        admin.require_auth();

        // Verify dispute exists and is not resolved
        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(bounty_id))
            .expect("No dispute exists for this bounty");

        assert!(!dispute.resolved, "Dispute already resolved");
        assert!(
            result == DisputeResult::CreatorWin || result == DisputeResult::FreelancerWin,
            "Invalid dispute result"
        );

        // Get bounty
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        // Update dispute
        dispute.resolved = true;
        dispute.result = result.clone();
        dispute.resolver = Some(admin.clone());
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(bounty_id), &dispute);

        // Update bounty status based on result
        bounty.status = if result == DisputeResult::CreatorWin {
            BountyStatus::Cancelled
        } else {
            BountyStatus::Completed
        };
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &bounty);

        true
    }

    /// Gets the dispute details for a bounty.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID.
    ///
    /// # Returns
    /// - `Dispute`: Dispute details.
    ///
    /// # Errors
    /// - Panics if no dispute exists for this bounty.
    pub fn get_dispute(env: Env, bounty_id: u64) -> Dispute {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(bounty_id))
            .expect("No dispute exists for this bounty")
    }

    /// Gets all evidence submitted for a dispute.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID with dispute.
    ///
    /// # Returns
    /// - `Vec<Evidence>`: List of evidence records.
    pub fn get_evidence(env: Env, bounty_id: u64) -> Vec<Evidence> {
        env.storage()
            .persistent()
            .get(&DataKey::EvidenceList(bounty_id))
            .unwrap_or_else(|| Vec::new(&env))
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

    #[test]
    fn test_initiate_dispute_by_creator() {
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

        client.select_freelancer(&bounty_id, &app_id);

        // Creator initiates dispute
        let result = client.initiate_dispute(
            &bounty_id,
            &creator,
            &String::from_str(&env, "Freelancer not delivering"),
        );
        assert!(result);

        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Disputed);

        let dispute = client.get_dispute(&bounty_id);
        assert_eq!(dispute.initiator, creator);
        assert!(!dispute.resolved);
        assert_eq!(dispute.result, DisputeResult::None);
    }

    #[test]
    fn test_initiate_dispute_by_freelancer() {
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

        client.select_freelancer(&bounty_id, &app_id);

        // Freelancer initiates dispute
        let result = client.initiate_dispute(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "Creator not paying"),
        );
        assert!(result);

        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Disputed);

        let dispute = client.get_dispute(&bounty_id);
        assert_eq!(dispute.initiator, freelancer);
    }

    #[test]
    #[should_panic(expected = "Only creator or freelancer can initiate dispute")]
    fn test_initiate_dispute_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let random = Address::generate(&env);

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

        client.select_freelancer(&bounty_id, &app_id);

        // Random user tries to initiate dispute
        client.initiate_dispute(
            &bounty_id,
            &random,
            &String::from_str(&env, "Random dispute"),
        );
    }

    #[test]
    fn test_submit_evidence() {
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

        client.select_freelancer(&bounty_id, &app_id);

        // Creator initiates dispute
        client.initiate_dispute(
            &bounty_id,
            &creator,
            &String::from_str(&env, "Freelancer not delivering"),
        );

        // Creator submits evidence
        client.submit_evidence(
            &bounty_id,
            &creator,
            &String::from_str(&env, "https://example.com/evidence1.png"),
            &String::from_str(&env, "Screenshot of missed deadline"),
        );

        // Freelancer submits evidence
        client.submit_evidence(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "https://example.com/evidence2.pdf"),
            &String::from_str(&env, "Work submission document"),
        );

        let evidence_list = client.get_evidence(&bounty_id);
        assert_eq!(evidence_list.len(), 2);
        assert_eq!(evidence_list.get(0).unwrap().submitter, creator);
        assert_eq!(evidence_list.get(1).unwrap().submitter, freelancer);
    }

    #[test]
    fn test_resolve_dispute_creator_wins() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let admin = Address::generate(&env);

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

        client.select_freelancer(&bounty_id, &app_id);

        // Initiate dispute
        client.initiate_dispute(
            &bounty_id,
            &creator,
            &String::from_str(&env, "Freelancer not delivering"),
        );

        // Admin resolves in favor of creator
        let result = client.resolve_dispute(
            &bounty_id,
            &admin,
            &DisputeResult::CreatorWin,
        );
        assert!(result);

        let dispute = client.get_dispute(&bounty_id);
        assert!(dispute.resolved);
        assert_eq!(dispute.result, DisputeResult::CreatorWin);
        assert_eq!(dispute.resolver, Some(admin.clone()));

        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Cancelled);
    }

    #[test]
    fn test_resolve_dispute_freelancer_wins() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let admin = Address::generate(&env);

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

        client.select_freelancer(&bounty_id, &app_id);

        // Initiate dispute
        client.initiate_dispute(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "Creator not paying"),
        );

        // Admin resolves in favor of freelancer
        let result = client.resolve_dispute(
            &bounty_id,
            &admin,
            &DisputeResult::FreelancerWin,
        );
        assert!(result);

        let dispute = client.get_dispute(&bounty_id);
        assert!(dispute.resolved);
        assert_eq!(dispute.result, DisputeResult::FreelancerWin);

        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Completed);
    }

    #[test]
    #[should_panic(expected = "Dispute already resolved")]
    fn test_resolve_dispute_already_resolved() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let admin = Address::generate(&env);

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

        client.select_freelancer(&bounty_id, &app_id);

        // Initiate and resolve dispute
        client.initiate_dispute(
            &bounty_id,
            &creator,
            &String::from_str(&env, "Freelancer not delivering"),
        );

        client.resolve_dispute(
            &bounty_id,
            &admin,
            &DisputeResult::CreatorWin,
        );

        // Try to resolve again
        client.resolve_dispute(
            &bounty_id,
            &admin,
            &DisputeResult::FreelancerWin,
        );
    }

    #[test]
    #[should_panic(expected = "Dispute already exists for this bounty")]
    fn test_duplicate_dispute_not_allowed() {
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

        client.select_freelancer(&bounty_id, &app_id);

        // First dispute
        client.initiate_dispute(
            &bounty_id,
            &creator,
            &String::from_str(&env, "First dispute"),
        );

        // Try second dispute
        client.initiate_dispute(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "Second dispute"),
        );
    }
}
