#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::Client as TokenClient, Address, Env,
    String, Vec,
};

#[derive(Clone, Copy, PartialEq, Debug)]
#[contracttype]
pub enum EscrowStatus {
    Active = 0,
    Released = 1,
    Refunded = 2,
    Disputed = 3,
    EmergencyWithdrawn = 4,
}

#[derive(Clone)]
#[contracttype]
pub enum ReleaseCondition {
    OnCompletion,
    Timelock(u64),
}

#[derive(Clone, Copy, PartialEq)]
#[contracttype]
pub enum DisputeOutcome {
    HoldInEscrow = 0,
    ReleaseToPayee = 1,
    RefundToPayer = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct DisputeEvidence {
    pub submitter: Address,
    pub content: String,
    pub submitted_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Dispute {
    pub escrow_id: u64,
    pub initiator: Address,
    pub reason: String,
    pub initiated_at: u64,
    pub evidence_count: u32,
    pub resolved: bool,
    pub outcome: Option<DisputeOutcome>,
    pub resolution_timestamp: Option<u64>,
}

#[contracttype]
pub struct EscrowAccount {
    pub id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub token: Address,
    pub status: EscrowStatus,
    pub release_condition: ReleaseCondition,
    pub created_at: u64,
}

#[contracttype]
pub enum DataKey {
    EscrowCounter,
    Escrow(u64),
    Governance,
    Arbitrator,
    Dispute(u64),
    Evidence(u64, u32),
    PartialRefundBalance(u64),
}

// =============================================================================
// SECURITY INVARIANTS (for formal verification / audit reference)
// =============================================================================
// INV-1: An escrow's amount is always > 0 (enforced at deposit).
// INV-2: An escrow transitions: Active → Released | Refunded only.
//        Once Released or Refunded, status never changes again.
// INV-3: Only payer or payee may call release_funds.
// INV-4: Only payer may call refund_escrow (auth enforced via require_auth).
// INV-5: Timelock release only succeeds when ledger.timestamp >= deadline.
// INV-6: Total token balance held by contract equals sum of all Active escrow amounts.
// =============================================================================

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Creates and funds a new escrow account.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `payer`: Payer address (must authenticate and have sufficient balance).
    /// - `payee`: Recipient address.
    /// - `amount`: Amount to escrow (must be positive).
    /// - `token`: Token contract address for the escrow.
    /// - `release_condition`: Condition for fund release (`OnCompletion` or `Timelock`).
    ///
    /// # Returns
    /// - `u64`: Unique escrow ID.
    ///
    /// # Errors
    /// - Panics if payer fails authentication.
    /// - Panics if amount <= 0.
    /// - Token transfer will fail if insufficient balance/approval.
    ///
    /// # State Changes
    /// - Transfers tokens from payer to contract.
    /// - Increments escrow counter.
    /// - Stores EscrowAccount with `Active` status.
    pub fn deposit(
        env: Env,
        payer: Address,
        payee: Address,
        amount: i128,
        token: Address,
        release_condition: ReleaseCondition,
    ) -> u64 {
        payer.require_auth();
        assert!(amount > 0, "Amount must be positive");

        // #179: Validate token implements the token interface by calling balance().
        // This will trap if `token` is not a valid SEP-41 token contract,
        // preventing funds from being locked with an unrecoverable address.
        let token_client = TokenClient::new(&env, &token);
        let _ = token_client.balance(&payer); // panics if token is invalid
        token_client.transfer(&payer, &env.current_contract_address(), &amount);

        let mut counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0);
        counter += 1;

        let escrow = EscrowAccount {
            id: counter,
            payer,
            payee,
            amount,
            token,
            status: EscrowStatus::Active,
            release_condition,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Escrow(counter), &escrow);
        env.storage()
            .instance()
            .set(&DataKey::EscrowCounter, &counter);

        counter
    }

    /// Retrieves escrow account details by ID.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Unique escrow ID.
    ///
    /// # Returns
    /// - `EscrowAccount`: Full escrow details.
    ///
    /// # Errors
    /// - Panics with "Escrow not found" if ID doesn't exist.
    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowAccount {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found")
    }

    /// Releases escrowed funds to payee if conditions met.
    /// Can be called by payer or payee.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    /// - `caller`: Caller address (must be payer or payee, authenticates).
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if escrow not found or not active.
    /// - Panics if caller unauthorized (not payer/payee).
    /// - Panics if release condition not satisfied.
    /// - Token transfer fails if issues.
    ///
    /// # State Changes
    /// - Transfers full amount to payee.
    /// - Updates status to `Released`.
    pub fn release_funds(env: Env, escrow_id: u64, caller: Address) -> bool {
        caller.require_auth();

        let mut escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        assert!(
            caller == escrow.payer || caller == escrow.payee,
            "Unauthorized"
        );
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");
        assert!(
            Self::can_release(env.clone(), escrow_id),
            "Release condition not met"
        );

        let token_client = TokenClient::new(&env, &escrow.token);

        // Query governance contract for platform fee (basis points, e.g. 500 = 5%)
        let fee_bps: u32 = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Governance)
            .map(|governance| {
                env.invoke_contract(
                    &governance,
                    &symbol_short!("get_fee"),
                    soroban_sdk::Vec::new(&env),
                )
            })
            .unwrap_or(0);

        let fee_amount = if fee_bps > 0 {
            (escrow.amount * fee_bps as i128) / 10_000
        } else {
            0
        };
        let payee_amount = escrow.amount - fee_amount;

        if fee_amount > 0 {
            let governance: Address = env
                .storage()
                .persistent()
                .get(&DataKey::Governance)
                .expect("Governance not set");
            token_client.transfer(&env.current_contract_address(), &governance, &fee_amount);
        }
        token_client.transfer(&env.current_contract_address(), &escrow.payee, &payee_amount);

        escrow.status = EscrowStatus::Released;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        true
    }

    /// Refunds escrow to payer (payer only).
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if escrow not found or not active.
    /// - Panics if payer fails authentication.
    ///
    /// # State Changes
    /// - Transfers full amount back to payer.
    /// - Updates status to `Refunded`.
    pub fn refund_escrow(env: Env, escrow_id: u64) -> bool {
        let mut escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        escrow.payer.require_auth();
        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.payer,
            &escrow.amount,
        );

        escrow.status = EscrowStatus::Refunded;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);

        true
    }

    /// Performs a partial refund of escrowed funds.
    /// Only payer or arbitrator can initiate partial refunds on active escrows.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    /// - `caller`: Address initiating partial refund (must be payer or arbitrator).
    /// - `refund_amount`: Amount to refund (must be > 0 and <= remaining balance).
    ///
    /// # Returns
    /// - `(bool, i128)`: Returns `(true, remaining_balance)` on success.
    ///
    /// # Errors
    /// - Panics if escrow not found.
    /// - Panics if escrow not in Active or Disputed status.
    /// - Panics if caller is not payer or arbitrator.
    /// - Panics if refund_amount <= 0.
    /// - Panics if refund_amount > remaining balance.
    /// - Token transfer fails if issues.
    ///
    /// # State Changes
    /// - Transfers refund_amount to payer.
    /// - Updates remaining balance (stored in PartialRefundBalance key).
    /// - If refund equals remaining balance, updates status to Refunded.
    /// - Emits partial_refund event with amount and remaining balance.
    pub fn partial_refund(
        env: Env,
        escrow_id: u64,
        caller: Address,
        refund_amount: i128,
    ) -> (bool, i128) {
        caller.require_auth();

        // Validate refund amount
        assert!(refund_amount > 0, \"Refund amount must be greater than zero\");

        let mut escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect(\"Escrow not found\");

        // Check status - only allow partial refunds on Active or Disputed escrows
        assert!(
            escrow.status == EscrowStatus::Active || escrow.status == EscrowStatus::Disputed,
            \"Can only partially refund active or disputed escrows\"
        );

        // Authorization: only payer or arbitrator
        let is_payer = caller == escrow.payer;
        let is_arbitrator = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Arbitrator)
            .map(|arb| caller == arb)
            .unwrap_or(false);

        assert!(
            is_payer || is_arbitrator,
            \"Only payer or arbitrator can initiate partial refund\"
        );

        // Get current remaining balance
        let remaining_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PartialRefundBalance(escrow_id))
            .unwrap_or(escrow.amount);

        // Validate refund amount doesn't exceed remaining balance
        assert!(
            refund_amount <= remaining_balance,
            \"Refund amount exceeds remaining balance\"
        );

        // Calculate new remaining balance
        let new_remaining_balance = remaining_balance - refund_amount;

        // Transfer refund amount to payer
        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.payer,
            &refund_amount,
        );

        // Update remaining balance
        if new_remaining_balance > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::PartialRefundBalance(escrow_id), &new_remaining_balance);
        } else {
            // If no balance remaining, mark escrow as fully refunded
            escrow.status = EscrowStatus::Refunded;
            env.storage()
                .persistent()
                .set(&DataKey::Escrow(escrow_id), &escrow);
            // Remove the balance tracking key
            env.storage()
                .persistent()
                .remove(&DataKey::PartialRefundBalance(escrow_id));
        }

        // Emit partial refund event
        env.events().publish(
            (symbol_short!("partial_ref"), escrow_id),
            (caller, refund_amount, new_remaining_balance),
        );

        (true, new_remaining_balance)
    }

    /// Checks if escrow release conditions are met.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    ///
    /// # Returns
    /// - `bool`: `true` if releasable.
    ///
    /// # Errors
    /// - Panics if escrow not found.
    ///
    /// # Logic
    /// - `OnCompletion`: Always true.
    /// - `Timelock(deadline)`: True if current timestamp >= deadline.
    pub fn can_release(env: Env, escrow_id: u64) -> bool {
        let escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        match escrow.release_condition {
            ReleaseCondition::OnCompletion => true,
            ReleaseCondition::Timelock(deadline) => env.ledger().timestamp() >= deadline,
        }
    }

    /// Gets total number of escrows created.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    ///
    /// # Returns
    /// - `u64`: Escrow count.
    pub fn get_escrow_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowCounter)
            .unwrap_or(0)
    }

    /// Sets the governance contract address.
    /// Can only be called once by an authorized caller.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `caller`: Authorized caller.
    /// - `governance`: Governance contract address.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if caller fails authentication.
    /// - Panics if governance already set.
    pub fn set_governance(env: Env, caller: Address, governance: Address) -> bool {
        caller.require_auth();
        if env.storage().persistent().has(&DataKey::Governance) {
            panic!("Governance already set");
        }
        env.storage().persistent().set(&DataKey::Governance, &governance);
        true
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, Env};

    fn setup_token(env: &Env, admin: &Address) -> Address {
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token_admin = token::StellarAssetClient::new(env, &token_id.address());
        token_admin.mint(admin, &1_000_000);
        token_id.address()
    }

    /// Sets the arbitrator address.
    /// Can only be called once by an authorized caller (admin).
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `caller`: Caller address (must be admin).
    /// - `arbitrator`: Arbitrator address.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if caller not admin.
    /// - Panics if arbitrator already set.
    pub fn set_arbitrator(env: Env, caller: Address, arbitrator: Address) -> bool {
        caller.require_auth();

        let governance: Address = env.storage().persistent().get(&DataKey::Governance).expect("Governance not set");

        let is_admin: bool = env.invoke_contract(
            &governance,
            &symbol_short!("is_admin"),
            (caller.clone(),).into_val(&env),
        );

        assert!(is_admin, "Unauthorized: not an admin");

        if env.storage().persistent().has(&DataKey::Arbitrator) {
            panic!("Arbitrator already set");
        }

        env.storage().persistent().set(&DataKey::Arbitrator, &arbitrator);
        true
    }

    /// Initiates a dispute for an active escrow.
    /// Only payer or payee can initiate a dispute.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    /// - `initiator`: Address initiating dispute (must be payer or payee, must authenticate).
    /// - `reason`: Dispute reason (1-500 characters).
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if initiator not authenticated.
    /// - Panics if escrow not found or not active.
    /// - Panics if initiator is not payer or payee.
    /// - Panics if reason is empty or over 500 characters.
    /// - Panics if dispute already exists for this escrow.
    pub fn initiate_dispute(env: Env, escrow_id: u64, initiator: Address, reason: String) -> bool {
        initiator.require_auth();

        assert!(reason.len() > 0, "Reason cannot be empty");
        assert!(reason.len() <= 500, "Reason must be at most 500 characters");

        let mut escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        assert!(escrow.status == EscrowStatus::Active, "Can only dispute active escrows");
        assert!(
            initiator == escrow.payer || initiator == escrow.payee,
            "Only payer or payee can initiate dispute"
        );

        if env.storage().persistent().has(&DataKey::Dispute(escrow_id)) {
            panic!("Dispute already exists for this escrow");
        }

        let dispute = Dispute {
            escrow_id,
            initiator: initiator.clone(),
            reason,
            initiated_at: env.ledger().timestamp(),
            evidence_count: 0,
            resolved: false,
            outcome: None,
            resolution_timestamp: None,
        };

        escrow.status = EscrowStatus::Disputed;
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &escrow);
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(escrow_id), &dispute);

        env.events().publish(
            (symbol_short!("dispute_init"), escrow_id),
            (initiator, env.ledger().timestamp()),
        );

        true
    }

    /// Submits evidence for a dispute.
    /// Only payer or payee can submit evidence (max 10 pieces per dispute).
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    /// - `submitter`: Address submitting evidence (must authenticate).
    /// - `evidence_text`: Evidence content (1-1000 characters).
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if submitter not authenticated.
    /// - Panics if dispute not found or already resolved.
    /// - Panics if submitter is not payer or payee.
    /// - Panics if evidence text is empty or exceeds 1000 characters.
    /// - Panics if max evidence pieces reached (10).
    pub fn submit_evidence(
        env: Env,
        escrow_id: u64,
        submitter: Address,
        evidence_text: String,
    ) -> bool {
        submitter.require_auth();

        assert!(evidence_text.len() > 0, "Evidence cannot be empty");
        assert!(evidence_text.len() <= 1000, "Evidence must be at most 1000 characters");

        let escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        assert!(
            submitter == escrow.payer || submitter == escrow.payee,
            "Only payer or payee can submit evidence"
        );

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(escrow_id))
            .expect("Dispute not found");

        assert!(!dispute.resolved, "Cannot submit evidence to resolved dispute");
        assert!(
            dispute.evidence_count < 10,
            "Maximum evidence pieces (10) reached"
        );

        let evidence = DisputeEvidence {
            submitter: submitter.clone(),
            content: evidence_text,
            submitted_at: env.ledger().timestamp(),
        };

        let evidence_index = dispute.evidence_count;
        dispute.evidence_count += 1;

        env.storage()
            .persistent()
            .set(&DataKey::Evidence(escrow_id, evidence_index), &evidence);
        env.storage()
            .persistent()
            .set(&DataKey::Dispute(escrow_id), &dispute);

        env.events().publish(
            (symbol_short!("ev_submit"), escrow_id),
            (submitter, evidence_index, env.ledger().timestamp()),
        );

        true
    }

    /// Resolves a dispute with a specified outcome.
    /// Only arbitrator can resolve disputes.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `arbitrator`: Arbitrator address (must authenticate).
    /// - `escrow_id`: Escrow ID.
    /// - `outcome`: Resolution outcome.
    /// - `payee_amount`: Amount for payee if splitting (used with SplitBetween).
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if arbitrator not authenticated.
    /// - Panics if arbitrator address doesn't match registered arbitrator.
    /// - Panics if dispute not found or already resolved.
    /// - Panics if escrow not found or not disputed.
    /// - Token transfer fails if issues.
    ///
    /// # State Changes
    /// - Transfers tokens according to outcome.
    /// - Updates dispute with outcome and resolution timestamp.
    /// - Updates escrow status to Released or Refunded.
    pub fn resolve_dispute(
        env: Env,
        arbitrator: Address,
        escrow_id: u64,
        outcome: DisputeOutcome,
        payee_amount: Option<i128>,
    ) -> bool {
        arbitrator.require_auth();

        let registered_arbitrator: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Arbitrator)
            .expect("Arbitrator not set");

        assert!(arbitrator == registered_arbitrator, "Unauthorized: not the arbitrator");

        let escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        assert!(escrow.status == EscrowStatus::Disputed, "Escrow not disputed");

        let mut dispute: Dispute = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(escrow_id))
            .expect("Dispute not found");

        assert!(!dispute.resolved, "Dispute already resolved");

        let token_client = TokenClient::new(&env, &escrow.token);
        let mut final_escrow = escrow.clone();

        match outcome {
            DisputeOutcome::HoldInEscrow => {
                // Funds remain in escrow, no transfer
                final_escrow.status = EscrowStatus::Disputed;
            }
            DisputeOutcome::ReleaseToPayee => {
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.payee,
                    &escrow.amount,
                );
                final_escrow.status = EscrowStatus::Released;
            }
            DisputeOutcome::RefundToPayer => {
                token_client.transfer(
                    &env.current_contract_address(),
                    &escrow.payer,
                    &escrow.amount,
                );
                final_escrow.status = EscrowStatus::Refunded;
            }
        }

        dispute.resolved = true;
        dispute.outcome = Some(outcome);
        dispute.resolution_timestamp = Some(env.ledger().timestamp());

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(escrow_id), &dispute);
        env.storage()
            .persistent()
            .set(&DataKey::Escrow(escrow_id), &final_escrow);

        env.events().publish(
            (symbol_short!("dispute_res"), escrow_id),
            (outcome as u32, env.ledger().timestamp()),
        );

        true
    }

    /// Retrieves a dispute by escrow ID.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    ///
    /// # Returns
    /// - `Dispute`: Full dispute details.
    ///
    /// # Errors
    /// - Panics if dispute not found.
    pub fn get_dispute(env: Env, escrow_id: u64) -> Dispute {
        env.storage()
            .persistent()
            .get(&DataKey::Dispute(escrow_id))
            .expect("Dispute not found")
    }

    /// Retrieves evidence for a dispute.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    /// - `evidence_index`: Evidence index (0-based).
    ///
    /// # Returns
    /// - `DisputeEvidence`: Evidence details.
    ///
    /// # Errors
    /// - Panics if evidence not found.
    pub fn get_evidence(env: Env, escrow_id: u64, evidence_index: u32) -> DisputeEvidence {
        env.storage()
            .persistent()
            .get(&DataKey::Evidence(escrow_id, evidence_index))
            .expect("Evidence not found")
    }

    /// Emergency withdrawal of stuck funds from disputed escrow.
    /// Only callable by governance admin.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `caller`: Caller address (must be admin).
    /// - `escrow_id`: Escrow ID.
    /// - `recipient`: Address to receive the funds.
    ///
    /// # Returns
    /// - `bool`: Always `true` on success.
    ///
    /// # Errors
    /// - Panics if caller not authenticated.
    /// - Panics if caller not admin.
    /// - Panics if escrow not found or not disputed.
    /// - Token transfer fails if issues.
    ///
    /// # State Changes
    /// - Transfers full amount to recipient.
    /// - Updates status to `EmergencyWithdrawn`.
    /// - Emits event.
    pub fn emergency_withdraw(env: Env, caller: Address, escrow_id: u64, recipient: Address) -> bool {
        caller.require_auth();

        let governance: Address = env.storage().persistent().get(&DataKey::Governance).expect("Governance not set");

        let is_admin: bool = env.invoke_contract(
            &governance,
            &symbol_short!("is_admin"),
            (caller.clone(),).into_val(&env),
        );

        assert!(is_admin, "Unauthorized: not an admin");

        let mut escrow: EscrowAccount = env.storage().persistent().get(&DataKey::Escrow(escrow_id)).expect("Escrow not found");

        assert!(escrow.status == EscrowStatus::Disputed, "Can only emergency withdraw disputed escrows");

        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(&env.current_contract_address(), &recipient, &escrow.amount);

        escrow.status = EscrowStatus::EmergencyWithdrawn;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);

        env.events().publish((symbol_short!("emergency_withdraw"), escrow_id), (recipient, escrow.amount));

        true
    }
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_escrow_count_starts_at_zero() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        assert_eq!(client.get_escrow_count(), 0);
    }

    #[test]
    fn test_emergency_withdraw_success() {
    #[test]
    fn test_deposit_increments_counter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        // Set governance
        client.set_governance(&admin, &governance);

        // Mock is_admin to return true
        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", admin.clone())).returns(true);
        });

        // Deposit
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Set status to Disputed
        env.as_contract(&contract_id, || {
            let mut escrow: EscrowAccount = env.storage().persistent().get(&DataKey::Escrow(escrow_id)).unwrap();
            escrow.status = EscrowStatus::Disputed;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
        });

        // Emergency withdraw
        assert!(client.emergency_withdraw(&admin, &escrow_id, &payee));

        // Check status
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::EmergencyWithdrawn);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: not an admin")]
    fn test_emergency_withdraw_unauthorized() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(id, 1);
        assert_eq!(client.get_escrow_count(), 1);

        let id2 = client.deposit(&payer, &payee, &200, &token, &ReleaseCondition::OnCompletion);
        assert_eq!(id2, 2);
        assert_eq!(client.get_escrow_count(), 2);
    }

    #[test]
    fn test_deposit_stores_correct_data() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let rando = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        // Mock is_admin to return false for rando
        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", rando.clone())).returns(false);
        });

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        env.as_contract(&contract_id, || {
            let mut escrow: EscrowAccount = env.storage().persistent().get(&DataKey::Escrow(escrow_id)).unwrap();
            escrow.status = EscrowStatus::Disputed;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
        });

        // Should panic
        client.emergency_withdraw(&rando, &escrow_id, &payee);
    }

    #[test]
    #[should_panic(expected = "Can only emergency withdraw disputed escrows")]
    fn test_emergency_withdraw_not_disputed() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", admin.clone())).returns(true);
        });

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Status is Active, not Disputed
        // Should panic
        client.emergency_withdraw(&admin, &escrow_id, &payee);
    }

    // -------------------------------------------------------------------------
    // Tests for dispute mechanism (Issue #178)
    // -------------------------------------------------------------------------

    #[test]
    fn test_initiate_dispute_by_payer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Payer initiates dispute
        assert!(client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Payment not received")));

        let dispute = client.get_dispute(&escrow_id);
        assert_eq!(dispute.escrow_id, escrow_id);
        assert_eq!(dispute.initiator, payer);
        assert!(!dispute.resolved);
        assert_eq!(dispute.evidence_count, 0);

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Disputed);
    }

    #[test]
    fn test_initiate_dispute_by_payee() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Payee initiates dispute
        assert!(client.initiate_dispute(&escrow_id, &payee, &String::from_str(&env, "Funds locked unfairly")));

        let dispute = client.get_dispute(&escrow_id);
        assert_eq!(dispute.initiator, payee);
    }

    #[test]
    #[should_panic(expected = "Only payer or payee can initiate dispute")]
    fn test_initiate_dispute_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let rando = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Random address tries to initiate dispute
        client.initiate_dispute(&escrow_id, &rando, &String::from_str(&env, "I want this"));
    }

    #[test]
    #[should_panic(expected = "Can only dispute active escrows")]
    fn test_initiate_dispute_not_active() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Release the escrow
        client.release_funds(&escrow_id, &payer);

        // Try to dispute released escrow
        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Too late"));
    }

    #[test]
    #[should_panic(expected = "Reason cannot be empty")]
    fn test_initiate_dispute_empty_reason() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, ""));
    }

    #[test]
    #[should_panic(expected = "Reason must be at most 500 characters")]
    fn test_initiate_dispute_reason_too_long() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        let long_reason = String::from_str(&env, "a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1");

        client.initiate_dispute(&escrow_id, &payer, &long_reason);
    }

    #[test]
    #[should_panic(expected = "Dispute already exists for this escrow")]
    fn test_initiate_dispute_duplicate() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // First dispute succeeds
        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "First dispute"));

        // Second dispute should fail
        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Second dispute"));
    }

    #[test]
    fn test_submit_evidence_success() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion);
        let escrow = client.get_escrow(&id);

        assert_eq!(escrow.payer, payer);
        assert_eq!(escrow.payee, payee);
        assert_eq!(escrow.amount, 1000);
        assert_eq!(escrow.status, EscrowStatus::Active);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_deposit_zero_amount_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));

        // Payer submits evidence
        assert!(client.submit_evidence(&escrow_id, &payer, &String::from_str(&env, "Evidence from payer")));

        // Payee submits evidence
        assert!(client.submit_evidence(&escrow_id, &payee, &String::from_str(&env, "Counter evidence")));

        let dispute = client.get_dispute(&escrow_id);
        assert_eq!(dispute.evidence_count, 2);

        let evidence0 = client.get_evidence(&escrow_id, 0);
        assert_eq!(evidence0.submitter, payer);

        let evidence1 = client.get_evidence(&escrow_id, 1);
        assert_eq!(evidence1.submitter, payee);
    }

    #[test]
    #[should_panic(expected = "Only payer or payee can submit evidence")]
    fn test_submit_evidence_unauthorized() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        client.deposit(&payer, &payee, &0, &token, &ReleaseCondition::OnCompletion);
    }

    #[test]
    #[should_panic(expected = "Amount must be positive")]
    fn test_deposit_negative_amount_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let rando = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));

        client.submit_evidence(&escrow_id, &rando, &String::from_str(&env, "Fake evidence"));
    }

    #[test]
    #[should_panic(expected = "Evidence must be at most 1000 characters")]
    fn test_submit_evidence_too_long() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));

        let long_evidence = String::from_str(&env, "a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1234567890a1");

        client.submit_evidence(&escrow_id, &payer, &long_evidence);
    }

    #[test]
    #[should_panic(expected = "Maximum evidence pieces (10) reached")]
    fn test_submit_evidence_max_limit() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        client.deposit(&payer, &payee, &-1, &token, &ReleaseCondition::OnCompletion);
    }

    #[test]
    #[should_panic(expected = "Escrow not found")]
    fn test_get_escrow_not_found_panics() {
        let env = Env::default();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);
        client.get_escrow(&999);
    }

    #[test]
    fn test_release_funds_on_completion() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));

        // Submit 10 pieces of evidence
        for i in 0..10 {
            let evidence = String::from_str(&env, &format!("Evidence {}", i));
            client.submit_evidence(&escrow_id, &payer, &evidence);
        }

        // 11th should fail
        client.submit_evidence(&escrow_id, &payer, &String::from_str(&env, "Evidence 11"));
    }

    #[test]
    fn test_resolve_dispute_release_to_payee() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", admin.clone())).returns(true);
        });

        client.set_arbitrator(&admin, &arbitrator);

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));
        client.submit_evidence(&escrow_id, &payer, &String::from_str(&env, "Payer evidence"));
        client.submit_evidence(&escrow_id, &payee, &String::from_str(&env, "Payee evidence"));

        // Arbitrator resolves in favor of payee
        assert!(client.resolve_dispute(&arbitrator, &escrow_id, &DisputeOutcome::ReleaseToPayee, &None));

        let dispute = client.get_dispute(&escrow_id);
        assert!(dispute.resolved);
        assert_eq!(dispute.outcome, Some(DisputeOutcome::ReleaseToPayee));

        let escrow = client.get_escrow(&escrow_id);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        let result = client.release_funds(&id, &payer);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }

    #[test]
    fn test_resolve_dispute_refund_to_payer() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", admin.clone())).returns(true);
        });

        client.set_arbitrator(&admin, &arbitrator);

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));

        // Arbitrator resolves in favor of payer
        assert!(client.resolve_dispute(&arbitrator, &escrow_id, &DisputeOutcome::RefundToPayer, &None));

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);
    }

    #[test]
    fn test_resolve_dispute_hold_in_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", admin.clone())).returns(true);
        });

        client.set_arbitrator(&admin, &arbitrator);

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));

        // Arbitrator holds funds in escrow
        assert!(client.resolve_dispute(&arbitrator, &escrow_id, &DisputeOutcome::HoldInEscrow, &None));

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Unauthorized: not the arbitrator")]
    fn test_resolve_dispute_unauthorized() {
    fn test_release_funds_by_payee() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let rando = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", admin.clone())).returns(true);
        });

        client.set_arbitrator(&admin, &arbitrator);

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));

        // Random address tries to resolve
        client.resolve_dispute(&rando, &escrow_id, &DisputeOutcome::ReleaseToPayee, &None);
    }

    #[test]
    #[should_panic(expected = "Dispute already resolved")]
    fn test_resolve_dispute_already_resolved() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &300, &token, &ReleaseCondition::OnCompletion);
        let result = client.release_funds(&id, &payee);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_release_funds_unauthorized_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", admin.clone())).returns(true);
        });

        client.set_arbitrator(&admin, &arbitrator);

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute"));

        // First resolution
        client.resolve_dispute(&arbitrator, &escrow_id, &DisputeOutcome::ReleaseToPayee, &None);

        // Second resolution should fail
        client.resolve_dispute(&arbitrator, &escrow_id, &DisputeOutcome::RefundToPayer, &None);
    }

    // -------------------------------------------------------------------------
    // Tests for partial refund mechanism
    // -------------------------------------------------------------------------

    #[test]
    fn test_partial_refund_by_payer() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let random = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        client.release_funds(&id, &random);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn test_release_funds_already_released_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Payer initiates partial refund of 300
        let (success, remaining) = client.partial_refund(&escrow_id, &payer, &300_i128);
        assert!(success);
        assert_eq!(remaining, 700_i128);

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Active);
    }

    #[test]
    fn test_partial_refund_by_arbitrator() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        client.release_funds(&id, &payer);
        // Second release should panic
        client.release_funds(&id, &payer);
    }

    #[test]
    fn test_timelock_release_after_deadline() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);

        env.mock_contract(&governance, |mock| {
            mock.with_args(("is_admin", admin.clone())).returns(true);
        });

        client.set_arbitrator(&admin, &arbitrator);

        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Arbitrator initiates partial refund
        let (success, remaining) = client.partial_refund(&escrow_id, &arbitrator, &250_i128);
        assert!(success);
        assert_eq!(remaining, 750_i128);
    }

    #[test]
    fn test_partial_refund_full_amount() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let deadline = 1000u64;
        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::Timelock(deadline));

        // Before deadline: cannot release
        assert!(!client.can_release(&id));

        // After deadline: can release
        env.ledger().set_timestamp(deadline);
        assert!(client.can_release(&id));

        let result = client.release_funds(&id, &payer);
        assert!(result);
    }

    #[test]
    #[should_panic(expected = "Release condition not met")]
    fn test_timelock_release_before_deadline_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Refund full amount through partial_refund
        let (success, remaining) = client.partial_refund(&escrow_id, &payer, &amount);
        assert!(success);
        assert_eq!(remaining, 0);

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);
    }

    #[test]
    fn test_multiple_partial_refunds() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::Timelock(9999));
        // Timestamp is 0 by default, deadline is 9999 — should panic
        client.release_funds(&id, &payer);
    }

    #[test]
    fn test_refund_escrow() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // First partial refund: 200
        let (success1, remaining1) = client.partial_refund(&escrow_id, &payer, &200_i128);
        assert!(success1);
        assert_eq!(remaining1, 800_i128);

        // Second partial refund: 300
        let (success2, remaining2) = client.partial_refund(&escrow_id, &payer, &300_i128);
        assert!(success2);
        assert_eq!(remaining2, 500_i128);

        // Third partial refund: 500 (remainder)
        let (success3, remaining3) = client.partial_refund(&escrow_id, &payer, &500_i128);
        assert!(success3);
        assert_eq!(remaining3, 0);

        let escrow = client.get_escrow(&escrow_id);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        let result = client.refund_escrow(&id);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);
    }

    #[test]
    #[should_panic(expected = "Refund amount must be greater than zero")]
    fn test_partial_refund_zero_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Try to refund zero amount - should fail
        client.partial_refund(&escrow_id, &payer, &0);
    }

    #[test]
    #[should_panic(expected = "Refund amount must be greater than zero")]
    fn test_partial_refund_negative_amount() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Try to refund negative amount - should fail
        client.partial_refund(&escrow_id, &payer, &-100_i128);
    }

    #[test]
    #[should_panic(expected = "Refund amount exceeds remaining balance")]
    fn test_partial_refund_exceeds_balance() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Try to refund more than balance
        client.partial_refund(&escrow_id, &payer, &1001_i128);
    }

    #[test]
    #[should_panic(expected = "Refund amount exceeds remaining balance")]
    fn test_partial_refund_exceeds_after_multiple() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // First refund: 400
        client.partial_refund(&escrow_id, &payer, &400_i128);

        // Try to refund more than remaining (should be 600)
        client.partial_refund(&escrow_id, &payer, &700_i128);
    }

    #[test]
    #[should_panic(expected = "Only payer or arbitrator can initiate partial refund")]
    fn test_partial_refund_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let rando = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Random address tries to partial refund - should fail
        client.partial_refund(&escrow_id, &rando, &300_i128);
    }

    #[test]
    #[should_panic(expected = "Only payer or arbitrator can initiate partial refund")]
    fn test_partial_refund_payee_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Payee tries to partial refund - should fail (only payer or arbitrator)
        client.partial_refund(&escrow_id, &payee, &300_i128);
    }

    #[test]
    #[should_panic(expected = "Can only partially refund active or disputed escrows")]
    fn test_partial_refund_not_active() {
    #[should_panic(expected = "Escrow not active")]
    fn test_refund_already_refunded_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Release the escrow first
        client.release_funds(&escrow_id, &payer);

        // Try to partial refund released escrow - should fail
        client.partial_refund(&escrow_id, &payer, &300_i128);
    }

    #[test]
    fn test_partial_refund_on_disputed_escrow() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        client.refund_escrow(&id);
        // Second refund should panic
        client.refund_escrow(&id);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn test_refund_after_release_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Initiate dispute
        client.initiate_dispute(&escrow_id, &payer, &String::from_str(&env, "Dispute reason"));

        // Partial refund should work on disputed escrows
        let (success, remaining) = client.partial_refund(&escrow_id, &payer, &400_i128);
        assert!(success);
        assert_eq!(remaining, 600_i128);

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Can only partially refund active or disputed escrows")]
    fn test_partial_refund_refunded_escrow() {
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion);
        client.release_funds(&id, &payer);
        // Refund after release should panic
        client.refund_escrow(&id);
    }

    #[test]
    fn test_on_completion_can_release_always_true() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Full refund first
        client.refund_escrow(&escrow_id);

        // Try to partial refund already refunded escrow
        client.partial_refund(&escrow_id, &payer, &100_i128);
    }

    #[test]
    fn test_partial_refund_balance_tracking() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // First refund: 100
        let (_, rem1) = client.partial_refund(&escrow_id, &payer, &100_i128);
        assert_eq!(rem1, 900);

        // Second refund: 200
        let (_, rem2) = client.partial_refund(&escrow_id, &payer, &200_i128);
        assert_eq!(rem2, 700);

        // Third refund: 50
        let (_, rem3) = client.partial_refund(&escrow_id, &payer, &50_i128);
        assert_eq!(rem3, 650);

        // Verify final balance hasn't changed status
        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Active);
    }

    #[test]
    fn test_partial_refund_integration_with_release() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let governance = Address::generate(&env);
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = env.register_stellar_asset_contract(Address::generate(&env));
        let amount = 1000_i128;

        client.set_governance(&admin, &governance);
        let escrow_id = client.deposit(&payer, &payee, &amount, &token, &ReleaseCondition::OnCompletion);

        // Partial refund 300
        let (_, remaining) = client.partial_refund(&escrow_id, &payer, &300_i128);
        assert_eq!(remaining, 700);

        // Now release remaining 700 to payee
        assert!(client.release_funds(&escrow_id, &payer));

        let escrow = client.get_escrow(&escrow_id);
        assert_eq!(escrow.status, EscrowStatus::Released);
        // Note: Amount field still shows original 1000, but 300 was refunded and 700 released
    }
}


        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(&payer, &payee, &100, &token, &ReleaseCondition::OnCompletion);
        assert!(client.can_release(&id));
    }
}
