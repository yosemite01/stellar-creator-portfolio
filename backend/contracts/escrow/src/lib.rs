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

<<<<<<< HEAD
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
=======
/// Immutable multi-sig configuration stored with the escrow.
#[derive(Clone)]
#[contracttype]
pub struct MultiSigConfig {
    /// Ordered list of authorized signatories (no duplicates).
    pub signatories: soroban_sdk::Vec<Address>,
    /// Minimum number of approvals required to release funds.
    pub threshold: u32,
}

/// Optional wrapper for MultiSigConfig (Soroban SDK does not support Option<CustomContractType>).
#[derive(Clone)]
#[contracttype]
pub enum OptionalMultiSigConfig {
    None,
    Some(MultiSigConfig),
>>>>>>> c2f18b71 (Update escrow contract with new implementation and test snapshots)
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
    pub multi_sig: OptionalMultiSigConfig,
}

#[contracttype]
pub enum DataKey {
    EscrowCounter,
    Escrow(u64),
<<<<<<< HEAD
    Governance,
    Arbitrator,
    Dispute(u64),
    Evidence(u64, u32),
    PartialRefundBalance(u64),
=======
    Approvals(u64),
>>>>>>> c2f18b71 (Update escrow contract with new implementation and test snapshots)
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
        multi_sig: OptionalMultiSigConfig,
    ) -> u64 {
        payer.require_auth();
        assert!(amount > 0, "Amount must be positive");

<<<<<<< HEAD
        // #179: Validate token implements the token interface by calling balance().
        // This will trap if `token` is not a valid SEP-41 token contract,
        // preventing funds from being locked with an unrecoverable address.
        let token_client = TokenClient::new(&env, &token);
        let _ = token_client.balance(&payer); // panics if token is invalid
        token_client.transfer(&payer, &env.current_contract_address(), &amount);
=======
        // Validate MultiSigConfig if provided
        if let OptionalMultiSigConfig::Some(ref cfg) = multi_sig {
            assert!(!cfg.signatories.is_empty(), "Signatory list must not be empty");
            assert!(cfg.threshold > 0, "Threshold must be positive");
            assert!(
                cfg.threshold <= cfg.signatories.len(),
                "Threshold exceeds signatory count"
            );
            // Duplicate detection using nested iteration (no_std compatible)
            let len = cfg.signatories.len();
            let mut i = 0u32;
            while i < len {
                let mut j = i + 1;
                while j < len {
                    assert!(
                        cfg.signatories.get(i).unwrap() != cfg.signatories.get(j).unwrap(),
                        "Duplicate signatory"
                    );
                    j += 1;
                }
                i += 1;
            }
        }

        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&payer, env.current_contract_address(), &amount);
>>>>>>> c2f18b71 (Update escrow contract with new implementation and test snapshots)

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
            multi_sig,
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

        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        match escrow.multi_sig.clone() {
            OptionalMultiSigConfig::Some(cfg) => {
                // Multi-sig path: any caller may trigger release once quorum is reached.
                // Quorum check: approval count must meet threshold.
                let approvals: soroban_sdk::Vec<Address> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Approvals(escrow_id))
                    .unwrap_or_else(|| soroban_sdk::Vec::new(&env));
                assert!(approvals.len() >= cfg.threshold, "Quorum not reached");
            }
            OptionalMultiSigConfig::None => {
                // Single-sig path: caller must be payer or payee.
                assert!(
                    caller == escrow.payer || caller == escrow.payee,
                    "Unauthorized"
                );
            }
        }

        assert!(
            Self::can_release(env.clone(), escrow_id),
            "Release condition not met"
        );

        let token_client = TokenClient::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.payee,
            &escrow.amount,
        );

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
<<<<<<< HEAD
=======

    /// Records a signatory's approval for a multi-sig escrow release.
    ///
    /// # Parameters
    /// - `env`: Soroban environment.
    /// - `escrow_id`: Escrow ID.
    /// - `signatory`: Address of the approving signatory (must authenticate).
    ///
    /// # Returns
    /// - `u32`: Updated approval count after this call.
    ///
    /// # Errors
    /// - Panics with "Escrow not found" if escrow does not exist.
    /// - Panics with "Escrow not active" if escrow is not in Active status.
    /// - Panics with "Not a multi-sig escrow" if escrow has no MultiSigConfig.
    /// - Panics with "Unauthorized" if signatory is not in the signatory list.
    ///
    /// # Idempotency
    /// - If the signatory has already approved, the call is a no-op and returns
    ///   the current approval count unchanged.
    pub fn approve_release(env: Env, escrow_id: u64, signatory: Address) -> u32 {
        signatory.require_auth();

        let escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        assert!(escrow.status == EscrowStatus::Active, "Escrow not active");

        let cfg = match escrow.multi_sig {
            OptionalMultiSigConfig::Some(ref c) => c.clone(),
            OptionalMultiSigConfig::None => panic!("Not a multi-sig escrow"),
        };

        // Verify signatory is authorized
        let mut authorized = false;
        let sig_len = cfg.signatories.len();
        let mut i = 0u32;
        while i < sig_len {
            if cfg.signatories.get(i).unwrap() == signatory {
                authorized = true;
                break;
            }
            i += 1;
        }
        assert!(authorized, "Unauthorized");

        // Load existing approvals (default to empty vec)
        let mut approvals: soroban_sdk::Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Approvals(escrow_id))
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env));

        // Idempotency: skip write if already present
        let app_len = approvals.len();
        let mut already_approved = false;
        let mut j = 0u32;
        while j < app_len {
            if approvals.get(j).unwrap() == signatory {
                already_approved = true;
                break;
            }
            j += 1;
        }

        if !already_approved {
            approvals.push_back(signatory);
            env.storage()
                .persistent()
                .set(&DataKey::Approvals(escrow_id), &approvals);
        }

        approvals.len()
    }

    pub fn get_approvals(env: Env, escrow_id: u64) -> soroban_sdk::Vec<Address> {
        let escrow: EscrowAccount = env
            .storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .expect("Escrow not found");

        match escrow.multi_sig {
            OptionalMultiSigConfig::Some(_) => env
                .storage()
                .persistent()
                .get(&DataKey::Approvals(escrow_id))
                .unwrap_or_else(|| soroban_sdk::Vec::new(&env)),
            OptionalMultiSigConfig::None => soroban_sdk::Vec::new(&env),
        }
    }

    pub fn get_approval_count(env: Env, escrow_id: u64) -> u32 {
        Self::get_approvals(env, escrow_id).len()
    }
}
>>>>>>> c2f18b71 (Update escrow contract with new implementation and test snapshots)

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
    extern crate std;

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

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
        assert_eq!(id, 1);
        assert_eq!(client.get_escrow_count(), 1);

        let id2 = client.deposit(&payer, &payee, &200, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &1000, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        client.deposit(&payer, &payee, &0, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        client.deposit(&payer, &payee, &-1, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &300, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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
        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::Timelock(deadline), &OptionalMultiSigConfig::None);

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

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::Timelock(9999), &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &500, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
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

        let id = client.deposit(&payer, &payee, &100, &token, &ReleaseCondition::OnCompletion, &OptionalMultiSigConfig::None);
        assert!(client.can_release(&id));
    }

    // -------------------------------------------------------------------------
    // Task 2.2: MultiSigConfig validation tests
    // -------------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "Signatory list must not be empty")]
    fn test_deposit_multisig_empty_signatories_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let cfg = MultiSigConfig {
            signatories: soroban_sdk::Vec::new(&env),
            threshold: 1,
        };
        client.deposit(
            &payer,
            &payee,
            &500,
            &token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::Some(cfg),
        );
    }

    #[test]
    #[should_panic(expected = "Threshold must be positive")]
    fn test_deposit_multisig_zero_threshold_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let sig1 = Address::generate(&env);
        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1);

        let cfg = MultiSigConfig {
            signatories: sigs,
            threshold: 0,
        };
        client.deposit(
            &payer,
            &payee,
            &500,
            &token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::Some(cfg),
        );
    }

    #[test]
    #[should_panic(expected = "Threshold exceeds signatory count")]
    fn test_deposit_multisig_threshold_exceeds_signatories_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let sig1 = Address::generate(&env);
        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1);

        let cfg = MultiSigConfig {
            signatories: sigs,
            threshold: 2, // 2 > 1 signatory
        };
        client.deposit(
            &payer,
            &payee,
            &500,
            &token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::Some(cfg),
        );
    }

    #[test]
    #[should_panic(expected = "Duplicate signatory")]
    fn test_deposit_multisig_duplicate_signatory_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let sig1 = Address::generate(&env);
        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());
        sigs.push_back(sig1); // duplicate

        let cfg = MultiSigConfig {
            signatories: sigs,
            threshold: 1,
        };
        client.deposit(
            &payer,
            &payee,
            &500,
            &token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::Some(cfg),
        );
    }

    #[test]
    fn test_deposit_multisig_valid_config_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);
        let sig3 = Address::generate(&env);
        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1);
        sigs.push_back(sig2);
        sigs.push_back(sig3);

        let cfg = MultiSigConfig {
            signatories: sigs,
            threshold: 2, // 2-of-3
        };
        let id = client.deposit(
            &payer,
            &payee,
            &500,
            &token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::Some(cfg),
        );
        assert_eq!(id, 1);
        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Active);
    }

    // -------------------------------------------------------------------------
    // Task 3.1: approve_release unit tests
    // -------------------------------------------------------------------------

    /// Helper: create a multi-sig escrow and return (contract_id, client, escrow_id, signatories).
    fn setup_multisig_escrow<'a>(
        env: &'a Env,
        payer: &Address,
        payee: &Address,
        token: &Address,
        signatories: soroban_sdk::Vec<Address>,
        threshold: u32,
    ) -> (Address, EscrowContractClient<'a>, u64) {
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(env, &contract_id);
        let cfg = MultiSigConfig { signatories, threshold };
        let id = client.deposit(
            payer,
            payee,
            &500,
            token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::Some(cfg),
        );
        (contract_id, client, id)
    }

    #[test]
    fn test_approve_release_1_of_1() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

        let count = client.approve_release(&id, &sig1);
        assert_eq!(count, 1);
    }

    #[test]
    fn test_approve_release_2_of_3() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);
        let sig3 = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());
        sigs.push_back(sig2.clone());
        sigs.push_back(sig3.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 2);

        let count1 = client.approve_release(&id, &sig1);
        assert_eq!(count1, 1);

        let count2 = client.approve_release(&id, &sig2);
        assert_eq!(count2, 2);
    }

    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_approve_release_unauthorized_signatory_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);
        let outsider = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

        client.approve_release(&id, &outsider);
    }

    #[test]
    fn test_approve_release_idempotent() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

        let count1 = client.approve_release(&id, &sig1);
        let count2 = client.approve_release(&id, &sig1);
        let count3 = client.approve_release(&id, &sig1);
        assert_eq!(count1, 1);
        assert_eq!(count2, 1);
        assert_eq!(count3, 1);
    }

    // -------------------------------------------------------------------------
    // Task 7.1: approve_release rejects non-Active escrows (Requirements 6.4)
    // -------------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn test_approve_release_on_released_escrow_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

        // Approve to reach quorum, then release funds (status → Released)
        client.approve_release(&id, &sig1);
        client.release_funds(&id, &payer);

        // Now approve should panic with "Escrow not active"
        client.approve_release(&id, &sig1);
    }

    #[test]
    #[should_panic(expected = "Escrow not active")]
    fn test_approve_release_on_refunded_escrow_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

        // Refund the escrow (status → Refunded)
        client.refund_escrow(&id);

        // Now approve should panic with "Escrow not active"
        client.approve_release(&id, &sig1);
    }

    #[test]
    #[should_panic(expected = "Not a multi-sig escrow")]
    fn test_approve_release_on_single_sig_escrow_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let id = client.deposit(
            &payer,
            &payee,
            &500,
            &token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::None,
        );

        let random = Address::generate(&env);
        client.approve_release(&id, &random);
    }

    // -------------------------------------------------------------------------
    // Task 4.1: release_funds multi-sig unit tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_multisig_release_at_quorum_2_of_3() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);
        let sig3 = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());
        sigs.push_back(sig2.clone());
        sigs.push_back(sig3.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 2);

        // Approve with 2 signatories to reach quorum
        client.approve_release(&id, &sig1);
        client.approve_release(&id, &sig2);

        // Any caller can trigger release once quorum is reached
        let any_caller = Address::generate(&env);
        let result = client.release_funds(&id, &any_caller);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }

    #[test]
    #[should_panic(expected = "Quorum not reached")]
    fn test_multisig_release_below_quorum_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);
        let sig3 = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());
        sigs.push_back(sig2.clone());
        sigs.push_back(sig3.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 2);

        // Only 1 approval — below threshold of 2
        client.approve_release(&id, &sig1);

        // Should panic with "Quorum not reached"
        client.release_funds(&id, &payer);
    }

    #[test]
    fn test_multisig_release_any_caller_once_quorum_reached() {
        let env = Env::default();
        env.mock_all_auths();
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);
        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());
        sigs.push_back(sig2.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 2);

        // Reach quorum
        client.approve_release(&id, &sig1);
        client.approve_release(&id, &sig2);

        // A completely unrelated address triggers the release
        let stranger = Address::generate(&env);
        let result = client.release_funds(&id, &stranger);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Released);
    }

    // -------------------------------------------------------------------------
    // Task 2.3: Property test for invalid multi-sig config rejection
    // Feature: escrow-multi-sig, Property 2: invalid config rejected
    // Validates: Requirements 1.3, 1.4, 1.5, 6.1
    // -------------------------------------------------------------------------

    /// Helper: attempt a deposit with the given config and return whether it panicked.
    fn deposit_panics(
        env: &Env,
        contract_id: &Address,
        token: &Address,
        payer: &Address,
        payee: &Address,
        cfg: OptionalMultiSigConfig,
    ) -> bool {
        // Soroban's Env is not UnwindSafe, so we drive the call through the
        // generated client which invokes the contract via the test host.
        // We detect rejection by catching the panic that Soroban raises.
        let client = EscrowContractClient::new(env, contract_id);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.deposit(
                payer,
                payee,
                &500,
                token,
                &ReleaseCondition::OnCompletion,
                &cfg,
            );
        }));
        result.is_err()
    }

    proptest::proptest! {
        // Property 2: Deposit validation rejects invalid multi-sig configs
        // For any MultiSigConfig where threshold == 0, signatories is empty,
        // threshold > len(signatories), or signatories contains duplicates,
        // the deposit call SHALL panic.
        #[test]
        fn prop_invalid_multisig_config_rejected(
            // Case selector: 0=empty list, 1=zero threshold, 2=threshold>N, 3=duplicate
            case in 0u8..4u8,
            // Number of distinct signatories for cases 2 and 3 (1..=5)
            n_sigs in 1usize..=5usize,
            // For case 2: threshold offset above N (1..=3)
            excess in 1u32..=3u32,
            // For case 3: which index to duplicate (0..=4, clamped to n_sigs-1)
            dup_idx in 0usize..5usize,
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let contract_id = env.register(EscrowContract, ());

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            let panicked = match case {
                // Case 0: empty signatory list, threshold=1
                0 => {
                    let cfg = MultiSigConfig {
                        signatories: soroban_sdk::Vec::new(&env),
                        threshold: 1,
                    };
                    deposit_panics(&env, &contract_id, &token, &payer, &payee,
                        OptionalMultiSigConfig::Some(cfg))
                }
                // Case 1: zero threshold, one valid signatory
                1 => {
                    let sig = Address::generate(&env);
                    let mut sigs = soroban_sdk::Vec::new(&env);
                    sigs.push_back(sig);
                    let cfg = MultiSigConfig { signatories: sigs, threshold: 0 };
                    deposit_panics(&env, &contract_id, &token, &payer, &payee,
                        OptionalMultiSigConfig::Some(cfg))
                }
                // Case 2: threshold > N signatories
                2 => {
                    let mut sigs = soroban_sdk::Vec::new(&env);
                    for _ in 0..n_sigs {
                        sigs.push_back(Address::generate(&env));
                    }
                    let threshold = n_sigs as u32 + excess;
                    let cfg = MultiSigConfig { signatories: sigs, threshold };
                    deposit_panics(&env, &contract_id, &token, &payer, &payee,
                        OptionalMultiSigConfig::Some(cfg))
                }
                // Case 3: duplicate signatory
                _ => {
                    // Build n_sigs distinct addresses, then duplicate one
                    let mut addrs: std::vec::Vec<Address> = (0..n_sigs)
                        .map(|_| Address::generate(&env))
                        .collect();
                    let dup = addrs[dup_idx % n_sigs].clone();
                    addrs.push(dup);

                    let mut sigs = soroban_sdk::Vec::new(&env);
                    for a in &addrs {
                        sigs.push_back(a.clone());
                    }
                    // threshold=1 so only the duplicate check can fire
                    let cfg = MultiSigConfig { signatories: sigs, threshold: 1 };
                    deposit_panics(&env, &contract_id, &token, &payer, &payee,
                        OptionalMultiSigConfig::Some(cfg))
                }
            };

            proptest::prop_assert!(panicked, "Expected deposit to panic for invalid config (case {})", case);
        }
    }

    // -------------------------------------------------------------------------
    // Task 3.3: Property test for unauthorized signatory rejection
    // Feature: escrow-multi-sig, Property 5: unauthorized signatory rejected
    // Validates: Requirements 2.2
    // -------------------------------------------------------------------------
    proptest::proptest! {
        /// Property 5: Unauthorized signatory rejection
        /// For any Multi_Sig_Escrow and any address NOT in the signatory list,
        /// calling `approve_release` SHALL be rejected with "Unauthorized".
        #[test]
        fn prop_unauthorized_signatory_rejected(
            n_sigs in 1usize..=4usize,
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            // Build n_sigs distinct signatories
            let mut sigs = soroban_sdk::Vec::new(&env);
            for _ in 0..n_sigs {
                sigs.push_back(Address::generate(&env));
            }

            let (_cid, client, id) =
                setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

            // Generate a fresh address that is NOT in the signatory list
            let outsider = Address::generate(&env);

            // approve_release with the outsider must panic with "Unauthorized"
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.approve_release(&id, &outsider);
            }));

            proptest::prop_assert!(
                result.is_err(),
                "Expected approve_release to panic for unauthorized address"
            );
        }
    }

    // -------------------------------------------------------------------------
    // Task 4.2: Property test for quorum gate
    // Feature: escrow-multi-sig, Property 4: quorum gate
    // Validates: Requirements 3.1, 3.2, 3.3
    // -------------------------------------------------------------------------
    proptest::proptest! {
        /// Property 4: Quorum gate
        /// For any Multi_Sig_Escrow with threshold T and K recorded approvals
        /// where K < T, calling `release_funds` SHALL fail. Once K >= T,
        /// calling `release_funds` SHALL succeed and transfer funds to the payee.
        #[test]
        fn prop_quorum_gate(
            n_sigs in 1usize..=4usize,
            threshold in 1u32..=4u32,
            k_approvals in 0usize..=4usize,
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            // Clamp threshold to n_sigs so the config is always valid
            let threshold = threshold.min(n_sigs as u32);
            // Clamp k to n_sigs (can't approve more times than there are signatories)
            let k = k_approvals.min(n_sigs);

            // Build n_sigs distinct signatories
            let signatories: std::vec::Vec<Address> = (0..n_sigs)
                .map(|_| Address::generate(&env))
                .collect();
            let mut sigs = soroban_sdk::Vec::new(&env);
            for s in &signatories {
                sigs.push_back(s.clone());
            }

            let (_cid, client, id) =
                setup_multisig_escrow(&env, &payer, &payee, &token, sigs, threshold);

            // Submit k distinct approvals
            for i in 0..k {
                client.approve_release(&id, &signatories[i]);
            }

            let any_caller = Address::generate(&env);

            if (k as u32) < threshold {
                // Below quorum — release_funds must panic
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.release_funds(&id, &any_caller);
                }));
                proptest::prop_assert!(
                    result.is_err(),
                    "Expected release_funds to panic when k={} < threshold={}", k, threshold
                );
            } else {
                // At or above quorum — release_funds must succeed
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.release_funds(&id, &any_caller)
                }));
                proptest::prop_assert!(
                    result.is_ok(),
                    "Expected release_funds to succeed when k={} >= threshold={}", k, threshold
                );
                let escrow = client.get_escrow(&id);
                proptest::prop_assert_eq!(
                    escrow.status,
                    EscrowStatus::Released,
                    "Expected escrow status to be Released after successful release"
                );
            }
        }
    }

    // -------------------------------------------------------------------------
    // Task 4.3: Property test for single-sig backward compatibility
    // Feature: escrow-multi-sig, Property 1: single-sig backward compat
    // Validates: Requirements 5.1, 5.2
    // -------------------------------------------------------------------------
    proptest::proptest! {
        /// Property 1: Single-sig backward compatibility
        /// For any escrow created without a MultiSigConfig, calling `release_funds`
        /// with the payer or payee as caller and a satisfied release condition SHALL
        /// succeed, and calling it with any other address SHALL fail — identical to
        /// pre-feature behavior.
        #[test]
        fn prop_single_sig_backward_compat(
            amount in 1i128..=10000i128,
            caller_is_payer in proptest::bool::ANY,
            use_third_party in proptest::bool::ANY,
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            let contract_id = env.register(EscrowContract, ());
            let client = EscrowContractClient::new(&env, &contract_id);

            // Create a single-sig escrow (no MultiSigConfig)
            let id = client.deposit(
                &payer,
                &payee,
                &amount,
                &token,
                &ReleaseCondition::OnCompletion,
                &OptionalMultiSigConfig::None,
            );

            if use_third_party {
                // A random address that is neither payer nor payee must be rejected
                let stranger = Address::generate(&env);
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.release_funds(&id, &stranger);
                }));
                proptest::prop_assert!(
                    result.is_err(),
                    "Expected release_funds to panic for third-party caller on single-sig escrow"
                );
            } else {
                // Payer or payee must succeed
                let caller = if caller_is_payer { &payer } else { &payee };
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    client.release_funds(&id, caller)
                }));
                proptest::prop_assert!(
                    result.is_ok(),
                    "Expected release_funds to succeed for {} on single-sig escrow",
                    if caller_is_payer { "payer" } else { "payee" }
                );
                let escrow = client.get_escrow(&id);
                proptest::prop_assert_eq!(
                    escrow.status,
                    EscrowStatus::Released,
                    "Expected escrow status to be Released after successful release"
                );
            }
        }
    }

    // -------------------------------------------------------------------------
    // Task 3.2: Property test for approval idempotence
    // Feature: escrow-multi-sig, Property 3: approval idempotent
    // Validates: Requirements 2.3
    // -------------------------------------------------------------------------
    proptest::proptest! {
        /// Property 3: Approval idempotence
        /// For any Multi_Sig_Escrow and any authorized signatory, calling
        /// `approve_release` N times (N ≥ 1) SHALL result in exactly one
        /// approval recorded for that signatory — the approval count SHALL be
        /// the same after the first call as after any subsequent call.
        #[test]
        fn prop_approval_idempotent(
            // Number of times to call approve_release (1..=5)
            n_calls in 1u32..=5u32,
            // Which of the 3 signatories to use (0..3)
            sig_idx in 0usize..3usize,
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            // Build a 3-signatory, 1-of-3 multi-sig escrow
            let sig0 = Address::generate(&env);
            let sig1 = Address::generate(&env);
            let sig2 = Address::generate(&env);
            let mut sigs = soroban_sdk::Vec::new(&env);
            sigs.push_back(sig0.clone());
            sigs.push_back(sig1.clone());
            sigs.push_back(sig2.clone());

            let (_cid, client, id) =
                setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

            let chosen = [&sig0, &sig1, &sig2][sig_idx];

            // Call approve_release n_calls times for the same signatory
            let mut last_count = 0u32;
            for _ in 0..n_calls {
                last_count = client.approve_release(&id, chosen);
            }

            // Regardless of n_calls, the count for this signatory must be 1
            proptest::prop_assert_eq!(last_count, 1u32,
                "Expected approval count == 1 after {} calls, got {}", n_calls, last_count);
        }
    }

    // -------------------------------------------------------------------------
    // Task 6.1: Unit tests for get_approvals
    // -------------------------------------------------------------------------

    #[test]
    fn test_get_approvals_multisig_no_approvals_returns_empty() {
        let env = Env::default();
        env.mock_all_auths();

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let sig1 = Address::generate(&env);
        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1);

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

        let approvals = client.get_approvals(&id);
        assert_eq!(approvals.len(), 0);
    }

    #[test]
    fn test_get_approvals_multisig_after_approvals_returns_those_addresses() {
        let env = Env::default();
        env.mock_all_auths();

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);
        let sig3 = Address::generate(&env);
        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());
        sigs.push_back(sig2.clone());
        sigs.push_back(sig3.clone());

        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 2);

        client.approve_release(&id, &sig1);
        client.approve_release(&id, &sig3);

        let approvals = client.get_approvals(&id);
        assert_eq!(approvals.len(), 2);
        assert!(approvals.contains(&sig1));
        assert!(approvals.contains(&sig3));
        assert!(!approvals.contains(&sig2));
    }

    #[test]
    fn test_get_approvals_single_sig_returns_empty() {
        let env = Env::default();
        env.mock_all_auths();

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let id = client.deposit(
            &payer,
            &payee,
            &1000,
            &token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::None,
        );

        let approvals = client.get_approvals(&id);
        assert_eq!(approvals.len(), 0);
    }

    #[test]
    #[should_panic(expected = "Escrow not found")]
    fn test_get_approvals_nonexistent_escrow_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        client.get_approvals(&9999);
    }

    #[test]
    fn test_get_approval_count_returns_correct_count() {
        let env = Env::default();
        env.mock_all_auths();

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);
        let sig3 = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let mut signatories = soroban_sdk::Vec::new(&env);
        signatories.push_back(sig1.clone());
        signatories.push_back(sig2.clone());
        signatories.push_back(sig3.clone());

        let id = client.deposit(
            &payer,
            &payee,
            &1000,
            &token,
            &ReleaseCondition::OnCompletion,
            &OptionalMultiSigConfig::Some(MultiSigConfig {
                signatories,
                threshold: 2,
            }),
        );

        assert_eq!(client.get_approval_count(&id), 0);

        client.approve_release(&id, &sig1);
        assert_eq!(client.get_approval_count(&id), 1);

        client.approve_release(&id, &sig2);
        assert_eq!(client.get_approval_count(&id), 2);

        client.approve_release(&id, &sig3);
        assert_eq!(client.get_approval_count(&id), 3);
    }

    // -------------------------------------------------------------------------
    // Task 6.3: Property test for approval round-trip
    // Feature: escrow-multi-sig, Property 6: approval round-trip
    // Validates: Requirements 4.1, 4.4
    // -------------------------------------------------------------------------
    proptest::proptest! {
        /// Property 6: Approval round-trip
        /// For any Multi_Sig_Escrow, after a set of distinct authorized signatories
        /// submit approvals, `get_approvals` SHALL return exactly those addresses
        /// (no more, no fewer), and `get_approval_count` SHALL equal the size of
        /// that set.
        #[test]
        fn prop_approval_round_trip(
            n_sigs in 1usize..=5usize,
            k_approve in 0usize..=5usize,
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            // Build n_sigs distinct signatories
            let signatories: std::vec::Vec<Address> = (0..n_sigs)
                .map(|_| Address::generate(&env))
                .collect();
            let mut sigs = soroban_sdk::Vec::new(&env);
            for s in &signatories {
                sigs.push_back(s.clone());
            }

            // threshold=1 so quorum is not a concern for this test
            let (_cid, client, id) =
                setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 1);

            // k = min(k_approve, n_sigs) distinct approvals from the first k signatories
            let k = k_approve.min(n_sigs);
            for i in 0..k {
                client.approve_release(&id, &signatories[i]);
            }

            // get_approvals must return exactly k addresses
            let approvals = client.get_approvals(&id);
            proptest::prop_assert_eq!(
                approvals.len() as usize,
                k,
                "get_approvals returned {} addresses, expected {}", approvals.len(), k
            );

            // get_approval_count must equal k
            let count = client.get_approval_count(&id);
            proptest::prop_assert_eq!(
                count as usize,
                k,
                "get_approval_count returned {}, expected {}", count, k
            );

            // Each of the k approving signatories must appear in the returned list
            for i in 0..k {
                proptest::prop_assert!(
                    approvals.contains(&signatories[i]),
                    "Signatory {} not found in get_approvals result", i
                );
            }
        }
    }

    // -------------------------------------------------------------------------
    // Task 7.2: Property test for no approvals/release after terminal state
    // Feature: escrow-multi-sig, Property 7: no approvals after terminal
    // Validates: Requirements 6.4
    // -------------------------------------------------------------------------
    proptest::proptest! {
        /// Property 7: Finality — no approvals after terminal state
        /// For any escrow that has transitioned to Released or Refunded,
        /// calling `approve_release` SHALL be rejected, and calling
        /// `release_funds` SHALL be rejected.
        #[test]
        fn prop_no_approvals_after_terminal(
            // Number of signatories: 1..=3
            n_sigs in 1usize..=3usize,
            // Threshold: 1..=n_sigs (clamped below)
            threshold_raw in 1u32..=3u32,
            // true = reach quorum and release; false = refund
            do_release in proptest::bool::ANY,
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            // Clamp threshold to n_sigs so the config is always valid
            let threshold = threshold_raw.min(n_sigs as u32);

            // Build n_sigs distinct signatories
            let signatories: std::vec::Vec<Address> = (0..n_sigs)
                .map(|_| Address::generate(&env))
                .collect();
            let mut sigs = soroban_sdk::Vec::new(&env);
            for s in &signatories {
                sigs.push_back(s.clone());
            }

            let (_cid, client, id) =
                setup_multisig_escrow(&env, &payer, &payee, &token, sigs, threshold);

            if do_release {
                // Approve up to threshold, then release
                for i in 0..(threshold as usize) {
                    client.approve_release(&id, &signatories[i]);
                }
                let any_caller = Address::generate(&env);
                client.release_funds(&id, &any_caller);
            } else {
                // Refund without any approvals (payer auth is mocked)
                client.refund_escrow(&id);
            }

            // After terminal state: approve_release must be rejected
            let approve_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.approve_release(&id, &signatories[0]);
            }));
            proptest::prop_assert!(
                approve_result.is_err(),
                "Expected approve_release to panic after terminal state (do_release={})", do_release
            );

            // After terminal state: release_funds must also be rejected
            let release_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let any_caller = Address::generate(&env);
                client.release_funds(&id, &any_caller);
            }));
            proptest::prop_assert!(
                release_result.is_err(),
                "Expected release_funds to panic after terminal state (do_release={})", do_release
            );
        }
    }

    // -------------------------------------------------------------------------
    // Task 8.1: Verify payer refund works on multi-sig escrows
    // Requirements: 5.3
    // -------------------------------------------------------------------------

    #[test]
    fn test_refund_multisig_escrow_zero_approvals() {
        let env = Env::default();
        env.mock_all_auths();

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());
        sigs.push_back(sig2.clone());

        // 2-of-2 multi-sig escrow, zero approvals submitted
        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 2);

        // Payer can refund with 0 approvals
        let result = client.refund_escrow(&id);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);
    }

    #[test]
    fn test_refund_multisig_escrow_below_threshold() {
        let env = Env::default();
        env.mock_all_auths();

        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        let sig1 = Address::generate(&env);
        let sig2 = Address::generate(&env);
        let sig3 = Address::generate(&env);
        let token = setup_token(&env, &payer);

        let mut sigs = soroban_sdk::Vec::new(&env);
        sigs.push_back(sig1.clone());
        sigs.push_back(sig2.clone());
        sigs.push_back(sig3.clone());

        // 3-of-3 multi-sig escrow; only 1 approval submitted (below threshold)
        let (_cid, client, id) =
            setup_multisig_escrow(&env, &payer, &payee, &token, sigs, 3);

        client.approve_release(&id, &sig1);
        assert_eq!(client.get_approval_count(&id), 1);

        // Payer can still refund even though approvals < threshold
        let result = client.refund_escrow(&id);
        assert!(result);

        let escrow = client.get_escrow(&id);
        assert_eq!(escrow.status, EscrowStatus::Refunded);
    }

    // -------------------------------------------------------------------------
    // Task 8.2: Property test for payer refund always available
    // Feature: escrow-multi-sig, Property 8: payer refund always available
    // Validates: Requirements 5.3
    // -------------------------------------------------------------------------
    proptest::proptest! {
        /// Property 8: Payer refund always available
        /// For any Active Multi_Sig_Escrow regardless of approval count, the payer
        /// SHALL be able to call `refund_escrow` and receive the full escrowed
        /// amount back.
        #[test]
        fn prop_payer_refund_always_available(
            // Number of signatories: 1..=3
            n_sigs in 1usize..=3usize,
            // Threshold: 1..=n_sigs (clamped below)
            threshold_raw in 1u32..=3u32,
            // Number of approvals to submit before refund: 0..=n_sigs (clamped below)
            k_approvals in 0usize..=3usize,
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            // Clamp threshold to n_sigs so the config is always valid
            let threshold = threshold_raw.min(n_sigs as u32);

            // Build n_sigs distinct signatories
            let signatories: std::vec::Vec<Address> = (0..n_sigs)
                .map(|_| Address::generate(&env))
                .collect();
            let mut sigs = soroban_sdk::Vec::new(&env);
            for s in &signatories {
                sigs.push_back(s.clone());
            }

            let (_cid, client, id) =
                setup_multisig_escrow(&env, &payer, &payee, &token, sigs, threshold);

            // Submit k approvals where k < threshold (keep escrow Active)
            // Clamp k so it never reaches threshold and never exceeds n_sigs
            let k = k_approvals.min(n_sigs).min((threshold as usize).saturating_sub(1));
            for i in 0..k {
                client.approve_release(&id, &signatories[i]);
            }

            // Payer must be able to refund regardless of approval count
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                client.refund_escrow(&id)
            }));
            proptest::prop_assert!(
                result.is_ok(),
                "Expected refund_escrow to succeed for payer with k={} approvals (threshold={})",
                k, threshold
            );

            // Escrow status must be Refunded
            let escrow = client.get_escrow(&id);
            proptest::prop_assert_eq!(
                escrow.status,
                EscrowStatus::Refunded,
                "Expected escrow status to be Refunded after payer refund"
            );
        }
    }

    // -------------------------------------------------------------------------
    // Task 9.1: Property test for balance invariant
    // Feature: escrow-multi-sig, Property 9: balance invariant
    // Validates: Requirements 6.3, 5.4
    // -------------------------------------------------------------------------
    proptest::proptest! {
        /// Property 9: Balance invariant preserved
        /// For any sequence of deposits, approvals, releases, and refunds, the
        /// token balance held by the contract SHALL equal the sum of amounts of
        /// all Active escrows.
        #[test]
        fn prop_balance_invariant(
            // Number of escrows to create upfront (1..=3)
            n_escrows in 1usize..=3usize,
            // Sequence of operations: each op is (op_type, escrow_index)
            // op_type: 0=approve, 1=release, 2=refund
            ops in proptest::collection::vec(
                (0u8..3u8, 0usize..3usize),
                1..=5,
            ),
        ) {
            let env = Env::default();
            env.mock_all_auths();

            let payer = Address::generate(&env);
            let payee = Address::generate(&env);
            let token = setup_token(&env, &payer);

            // Register a single contract to hold all escrows
            let contract_id = env.register(EscrowContract, ());
            let client = EscrowContractClient::new(&env, &contract_id);

            // Create n_escrows multi-sig escrows (1-of-1 for simplicity so
            // a single approve is enough to reach quorum)
            let amount: i128 = 100;
            let mut escrow_ids: std::vec::Vec<u64> = std::vec::Vec::new();
            let mut signatories_per_escrow: std::vec::Vec<Address> = std::vec::Vec::new();

            for _ in 0..n_escrows {
                let sig = Address::generate(&env);
                let mut sigs = soroban_sdk::Vec::new(&env);
                sigs.push_back(sig.clone());
                let cfg = MultiSigConfig { signatories: sigs, threshold: 1 };
                let id = client.deposit(
                    &payer,
                    &payee,
                    &amount,
                    &token,
                    &ReleaseCondition::OnCompletion,
                    &OptionalMultiSigConfig::Some(cfg),
                );
                escrow_ids.push(id);
                signatories_per_escrow.push(sig);
            }

            // After deposits: contract balance == n_escrows * amount
            let token_client = token::Client::new(&env, &token);
            let contract_balance = token_client.balance(&contract_id);
            let expected: i128 = n_escrows as i128 * amount;
            proptest::prop_assert_eq!(
                contract_balance,
                expected,
                "After deposits: contract balance {} != expected {}", contract_balance, expected
            );

            // Apply the random sequence of operations
            for (op_type, escrow_idx) in &ops {
                let idx = escrow_idx % n_escrows;
                let id = escrow_ids[idx];

                // Check current escrow status — skip if not Active
                let escrow = client.get_escrow(&id);
                if escrow.status != EscrowStatus::Active {
                    continue;
                }

                match op_type {
                    // Approve: submit approval from the escrow's signatory
                    0 => {
                        client.approve_release(&id, &signatories_per_escrow[idx]);
                    }
                    // Release: attempt release (succeeds only if quorum reached)
                    1 => {
                        let approval_count = client.get_approval_count(&id);
                        let threshold = match &escrow.multi_sig {
                            OptionalMultiSigConfig::Some(cfg) => cfg.threshold,
                            OptionalMultiSigConfig::None => 0,
                        };
                        if approval_count >= threshold {
                            let any_caller = Address::generate(&env);
                            client.release_funds(&id, &any_caller);
                        }
                    }
                    // Refund: payer refunds the escrow
                    _ => {
                        client.refund_escrow(&id);
                    }
                }

                // After each operation: contract balance == sum of Active escrow amounts
                let contract_balance = token_client.balance(&contract_id);
                let active_sum: i128 = escrow_ids.iter().map(|eid| {
                    let e = client.get_escrow(eid);
                    if e.status == EscrowStatus::Active { e.amount } else { 0 }
                }).sum();

                proptest::prop_assert_eq!(
                    contract_balance,
                    active_sum,
                    "Balance invariant violated: contract_balance={} != active_sum={}", contract_balance, active_sum
                );
            }
        }
    }
}
