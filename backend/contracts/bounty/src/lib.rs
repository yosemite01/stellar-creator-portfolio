#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Symbol, Vec};

#[derive(Clone)]
#[contracttype]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum BountyStatus {
    Open = 0,
    InProgress = 1,
    Completed = 2,
    Disputed = 3,
    Cancelled = 4,
    PendingCompletion = 5,
    Expired = 6,
}

#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum DisputeResult {
    None = 0,
    CreatorWin = 1,
    FreelancerWin = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct Bounty {
    pub id: u64,
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub budget: i128,
    pub deadline: u64,
    pub status: BountyStatus,
    pub created_at: u64,
    pub token: Address,
    pub escrow_id: Option<u64>,
}

#[contracttype]
#[derive(Clone)]
pub struct BountyApplication {
    pub id: u64,
    pub bounty_id: u64,
    pub freelancer: Address,
    pub proposal: String,
    pub proposed_budget: i128,
    pub timeline: u64,
    pub created_at: u64,
    pub is_withdrawn: bool,
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

// Storage type guidelines:
// - Instance: Frequently accessed, contract-lifetime data (counters, active state)
// - Persistent: Permanent records (bounties, applications, disputes, evidence)
// - Temporary: Short-lived workflow data (not used here, but for future: pending approvals)

// Maximum applications allowed per bounty to prevent spam
pub const MAX_APPLICATIONS_PER_BOUNTY: u32 = 100;

#[contracttype]
pub enum DataKey {
    // Instance storage - frequently accessed counters
    BountyCounter,
    AppCounter,
    // Persistent storage - permanent records
    Bounty(u64),
    Application(u64),
    // Instance storage - active workflow state (cleared after completion)
    SelectedFreelancer(u64),
    // Persistent storage - dispute records
    Dispute(u64),
    EvidenceList(u64),
    // Persistent storage - application tracking for rate limiting
    BountyApplications(u64),
    ApplicationsPerFreelancer(Address),
    // Config
    Deployer,
    EscrowContract,
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
        token: Address,
    ) -> u64 {
        creator.require_auth();

        assert!(
            deadline > env.ledger().timestamp(),
            "Deadline must be in the future"
        );

        // Use instance storage for frequently accessed counter
        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BountyCounter)
            .unwrap_or(0);
        counter += 1;

        let bounty = Bounty {
            id: counter,
            creator: creator.clone(),
            title: title.clone(),
            description,
            budget,
            deadline,
            status: BountyStatus::Open,
            created_at: env.ledger().timestamp(),
            token: token.clone(),
            escrow_id: None,
        };

        // Persistent storage for permanent bounty record
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(counter), &bounty);
        // Instance storage for counter
        env.storage()
            .instance()
            .set(&DataKey::BountyCounter, &counter);

        // Emit BountyCreated event
        env.events().publish(
            (Symbol::new(&env, "bounty_create"), counter),
            (&title, budget, deadline),
        );

        counter
    }

    /// Registers the trusted escrow contract address.
    ///
    /// Only the deployer (first caller) may set the escrow contract address.
    pub fn set_escrow_contract(env: Env, setter: Address, escrow: Address) -> bool {
        setter.require_auth();

        let maybe_deployer: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Deployer);

        if let Some(deployer) = maybe_deployer {
            if deployer != setter {
                panic!("Only deployer may set escrow contract");
            }
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::Deployer, &setter);
        }

        env.storage()
            .persistent()
            .set(&DataKey::EscrowContract, &escrow);

        true
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

        let bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        assert!(
            bounty.status == BountyStatus::Open,
            "Bounty is not open for applications"
        );
        assert!(
            env.ledger().timestamp() <= bounty.deadline,
            "Bounty deadline has passed"
        );

        // Use instance storage for frequently accessed counter
        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AppCounter)
            .unwrap_or(0);
        counter += 1;

        let application = BountyApplication {
            id: counter,
            bounty_id,
            freelancer: freelancer.clone(),
            proposal: proposal.clone(),
            proposed_budget,
            timeline,
            created_at: env.ledger().timestamp(),
            is_withdrawn: false,
        };

        // Persistent storage for permanent application record
        env.storage()
            .persistent()
            .set(&DataKey::Application(counter), &application);
        // Instance storage for counter
        env.storage()
            .instance()
            .set(&DataKey::AppCounter, &counter);

        // Track application ID under the bounty
        let mut app_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::BountyApplications(bounty_id))
            .unwrap_or(Vec::new(&env));
        app_ids.push_back(counter);
        env.storage()
            .persistent()
            .set(&DataKey::BountyApplications(bounty_id), &app_ids);

        // Emit BountyApplied event
        env.events().publish(
            (Symbol::new(&env, "bounty_apply"), bounty_id, counter),
            (&freelancer, &proposal, proposed_budget),
        );

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

    /// Allows a freelancer to withdraw their own pending application.
    ///
    /// Only the original applicant may withdraw, and only while the bounty is
    /// still `Open` (i.e. before a freelancer has been selected / bounty moved
    /// to `InProgress`). The application record is marked `is_withdrawn = true`
    /// rather than deleted so that on-chain history is preserved.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `application_id`: ID of the application to withdraw.
    /// - `freelancer`: Address of the applicant (must authenticate).
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics with "Application not found" if `application_id` doesn't exist.
    /// - Panics with "Not the application owner" if `freelancer` is not the
    ///   original applicant.
    /// - Panics with "Application already withdrawn" if already withdrawn.
    /// - Panics with "Bounty not found" if the referenced bounty doesn't exist.
    /// - Panics with "Cannot withdraw after freelancer has been selected" if the
    ///   bounty is no longer `Open`.
    ///
    /// # State Changes
    /// - Sets `application.is_withdrawn = true` on the stored application record.
    pub fn withdraw_application(
        env: Env,
        application_id: u64,
        freelancer: Address,
    ) -> bool {
        freelancer.require_auth();

        // Load and validate the application
        let mut application: BountyApplication = env
            .storage()
            .persistent()
            .get(&DataKey::Application(application_id))
            .expect("Application not found");

        // Ownership check — only the submitting freelancer may withdraw
        assert!(
            application.freelancer == freelancer,
            "Not the application owner"
        );

        // Idempotency guard — prevent double-withdrawal
        assert!(
            !application.is_withdrawn,
            "Application already withdrawn"
        );

        // State guard — cannot withdraw once a freelancer has been selected
        let bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(application.bounty_id))
            .expect("Bounty not found");

        assert!(
            bounty.status == BountyStatus::Open,
            "Cannot withdraw after freelancer has been selected"
        );

        // Mark as withdrawn and persist
        application.is_withdrawn = true;
        env.storage()
            .persistent()
            .set(&DataKey::Application(application_id), &application);

        // Emit ApplicationWithdrawn event
        env.events().publish(
            (Symbol::new(&env, "app_withdraw"), application.bounty_id, application_id),
            &freelancer,
        );

        true
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

        assert!(
            bounty.status == BountyStatus::Open,
            "Bounty is not open"
        );
        assert!(
            env.ledger().timestamp() <= bounty.deadline,
            "Bounty deadline has passed"
        );

        let application: BountyApplication = env
            .storage()
            .persistent()
            .get(&DataKey::Application(application_id))
            .expect("Application not found");

        assert!(
            application.bounty_id == bounty_id,
            "Application does not match bounty"
        );

        let escrow_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::EscrowContract)
            .expect("Escrow contract not configured");

        let escrow_id: u64 = env.invoke_contract(
            &escrow_contract,
            &soroban_sdk::symbol_short!("deposit"),
            (
                bounty.creator.clone(),
                application.freelancer.clone(),
                bounty.budget,
                bounty.token.clone(),
                ReleaseCondition::OnCompletion,
            ),
        );

        // Use instance storage for active workflow state
        env.storage().instance().set(
            &DataKey::SelectedFreelancer(bounty_id),
            &application.freelancer,
        );

        let mut updated_bounty = bounty;
        updated_bounty.status = BountyStatus::InProgress;
        updated_bounty.escrow_id = Some(escrow_id);
        
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &updated_bounty);

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
        assert!(
            env.ledger().timestamp() <= bounty.deadline,
            "Bounty deadline has passed"
        );

        // Use instance storage for active workflow state
        let freelancer: Address = env
            .storage()
            .instance()
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

        if let Some(escrow_id) = bounty.escrow_id {
            let escrow_contract: Address = env
                .storage()
                .persistent()
                .get(&DataKey::EscrowContract)
                .expect("Escrow contract not configured");
                
            env.invoke_contract::<bool>(
                &escrow_contract,
                &soroban_sdk::symbol_short!("release_funds"),
                (escrow_id, bounty.creator.clone()),
            );
        }

        let mut updated_bounty = bounty;
        updated_bounty.status = BountyStatus::Completed;
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &updated_bounty);

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
            .instance()
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
            .instance()
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
        // Instance storage for frequently accessed counter
        env.storage()
            .instance()
            .get(&DataKey::BountyCounter)
            .unwrap_or(0)
    }

    /// Expires a bounty that has passed its deadline.
    /// Can be called by anyone to enforce deadline expiration.
    /// Only Open or InProgress bounties can be expired.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `bounty_id`: Bounty ID to expire.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if bounty not found.
    /// - Panics if deadline has not passed yet.
    /// - Panics if bounty is not Open or InProgress.
    ///
    /// # State Changes
    /// - Updates bounty status to `Expired`.
    pub fn expire_bounty(env: Env, bounty_id: u64) -> bool {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(bounty_id))
            .expect("Bounty not found");

        assert!(
            env.ledger().timestamp() > bounty.deadline,
            "Bounty deadline has not passed yet"
        );
        assert!(
            bounty.status == BountyStatus::Open || bounty.status == BountyStatus::InProgress,
            "Only open or in-progress bounties can be expired"
        );

        bounty.status = BountyStatus::Expired;
        env.storage()
            .persistent()
            .set(&DataKey::Bounty(bounty_id), &bounty);

        // Emit BountyExpired event
        env.events().publish(
            (Symbol::new(&env, "bounty_expire"), bounty_id),
            (bounty.deadline, env.ledger().timestamp()),
        );

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::Env;

    #[test]
    fn test_create_bounty() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),

            &String::from_str(&env, "Test Description"),

            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);
        let random = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);
        let admin = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);
        let admin = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);
        let admin = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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
        let token = Address::generate(&env);
        let escrow = env.register(MockEscrowContract, ());
        client.set_escrow_contract(&creator, &escrow);
        let freelancer = Address::generate(&env);

        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &100u64,
            &token,
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

    // ===== Deadline Enforcement Tests =====

    #[test]
    #[should_panic(expected = "Deadline must be in the future")]
    fn test_create_bounty_deadline_in_past() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);

        // Set ledger timestamp to 1000, try deadline of 500 (in the past)
        env.ledger().set_timestamp(1000);

        client.create_bounty(
            &creator,
            &String::from_str(&env, "Late Bounty"),
            &String::from_str(&env, "Should fail"),
            &5000i128,
            &500u64,
        );
    }

    #[test]
    #[should_panic(expected = "Bounty deadline has passed")]
    fn test_apply_after_deadline() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(BountyContract, ());
        let client = BountyContractClient::new(&env, &contract_id);

        let creator = Address::generate(&env);
        let freelancer = Address::generate(&env);

        // Create bounty with deadline at 1000
        let bounty_id = client.create_bounty(
            &creator,
            &String::from_str(&env, "Test Bounty"),
            &String::from_str(&env, "Test Description"),
            &5000i128,
            &1000u64,
        );

        // Advance time past deadline
        env.ledger().set_timestamp(1001);

        // Should fail - deadline passed
        client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "Too late!"),
            &4500i128,
            &30u64,
        );
    }

    #[test]
    #[should_panic(expected = "Bounty deadline has passed")]
    fn test_select_freelancer_after_deadline() {
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
            &1000u64,
        );

        let app_id = client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I can do this!"),
            &4500i128,
            &30u64,
        );

        // Advance time past deadline
        env.ledger().set_timestamp(1001);

        // Should fail - deadline passed
        client.select_freelancer(&bounty_id, &app_id);
    }

    #[test]
    #[should_panic(expected = "Bounty deadline has passed")]
    fn test_submit_completion_after_deadline() {
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
            &1000u64,
        );

        let app_id = client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I can do this!"),
            &4500i128,
            &30u64,
        );

        client.select_freelancer(&bounty_id, &app_id);

        // Advance time past deadline
        env.ledger().set_timestamp(1001);

        // Should fail - deadline passed
        client.submit_completion(&bounty_id);
    }

    #[test]
    fn test_expire_open_bounty() {
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
            &1000u64,
        );

        // Advance time past deadline
        env.ledger().set_timestamp(1001);

        let result = client.expire_bounty(&bounty_id);
        assert!(result);

        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Expired);
    }

    #[test]
    fn test_expire_in_progress_bounty() {
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
            &1000u64,
        );

        let app_id = client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I can do this!"),
            &4500i128,
            &30u64,
        );

        client.select_freelancer(&bounty_id, &app_id);

        // Advance time past deadline
        env.ledger().set_timestamp(1001);

        let result = client.expire_bounty(&bounty_id);
        assert!(result);

        let bounty = client.get_bounty(&bounty_id);
        assert_eq!(bounty.status, BountyStatus::Expired);
    }

    #[test]
    #[should_panic(expected = "Bounty deadline has not passed yet")]
    fn test_expire_bounty_before_deadline() {
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
            &1000u64,
        );

        // Try to expire before deadline
        client.expire_bounty(&bounty_id);
    }

    #[test]
    #[should_panic(expected = "Only open or in-progress bounties can be expired")]
    fn test_expire_completed_bounty() {
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
            &1000u64,
        );

        let app_id = client.apply_for_bounty(
            &bounty_id,
            &freelancer,
            &String::from_str(&env, "I can do this!"),
            &4500i128,
            &30u64,
        );

        client.select_freelancer(&bounty_id, &app_id);
        client.complete_bounty(&bounty_id);

        // Advance time past deadline
        env.ledger().set_timestamp(1001);

        // Should fail - completed bounties can't be expired
        client.expire_bounty(&bounty_id);
    }
}


