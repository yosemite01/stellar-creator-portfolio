//! Fuzzing tests for the escrow contract
//! 
//! These tests use property-based testing and fuzzing strategies to verify:
//! - Double-spend prevention
//! - Escrow safety and correctness
//! - Token balance invariants
//! - Authorization checks
#[cfg(test)]
mod escrow_fuzz_tests {
    extern crate std;
    use std::panic;

    use crate::{EscrowContract, EscrowContractClient, EscrowStatus, ReleaseCondition};
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::{StellarAssetClient, TokenClient};
    use soroban_sdk::{Address, Env, Vec, vec};

    fn setup_token_env(env: &Env, amount: i128) -> (Address, Address, Address) {
        env.mock_all_auths();
        let admin = Address::generate(env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token = sac.address();
        let payer = Address::generate(env);
        let payee = Address::generate(env);
        let stellar = StellarAssetClient::new(env, &token);
        stellar.mint(&payer, &amount);
        (token, payer, payee)
    }

    #[test]
    fn fuzz_invariant_no_double_spend() {
        // Test that funds cannot be released twice
        let env = Env::default();
        let (token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract_id = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &contract_id);

        let escrow_id = contract.deposit(
            &1u64,
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        // First release succeeds
        assert!(contract.release_funds(&payer, &escrow_id));

        // Verify funds were transferred (net of 2.5% fee)
        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&payee), 975i128);
        assert_eq!(token_client.balance(&contract_id), 25i128);

        // Second release attempt fails
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.release_funds(&payer, &escrow_id);
        }));
        assert!(result.is_err(), "Second release should panic");
    }

    #[test]
    fn fuzz_invariant_balance_conservation() {
        // Test that total token balance is conserved through operations
        let env = Env::default();
        let amounts = vec![&env, 100i128, 500i128, 1000i128, 9999i128];

        for amount in amounts {
            let (token, payer, payee) = setup_token_env(&env, amount);
            let contract_id = env.register_contract(None, EscrowContract);
            let contract = EscrowContractClient::new(&env, &contract_id);

            let initial_balance = TokenClient::new(&env, &token).balance(&payer);
            assert_eq!(initial_balance, amount);

            let escrow_id = contract.deposit(
                &1u64,
                &payer,
                &payee,
                &amount,
                &token,
                &ReleaseCondition::OnCompletion,
            );

            let token_client = TokenClient::new(&env, &token);

            // After deposit, escrow holds the funds
            assert_eq!(token_client.balance(&contract_id), amount);
            assert_eq!(token_client.balance(&payer), 0i128);

            // After release, payee receives them (net of 2.5% fee)
            contract.release_funds(&payee, &escrow_id);
            let fee = (amount * 250) / 10000;
            assert_eq!(token_client.balance(&payee), amount - fee);
            assert_eq!(token_client.balance(&contract_id), fee);
        }
    }

    #[test]
    fn fuzz_invariant_refund_prevents_double_release() {
        // Test that refunding prevents release
        let env = Env::default();
        let (token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let escrow_id = contract.deposit(
            &1u64,
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        // Refund first
        assert!(contract.refund_escrow(&payer, &escrow_id));

        // Release after refund must fail
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.release_funds(&payee, &escrow_id);
        }));
        assert!(result.is_err(), "Release after refund should panic");
    }

    #[test]
    fn fuzz_invariant_authorization_enforcement() {
        // Test that only authorized parties can operate
        let env = Env::default();
        let (token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let escrow_id = contract.deposit(
            &1u64,
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );

        // Third party cannot release
        let stranger = Address::generate(&env);
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.release_funds(&stranger, &escrow_id);
        }));
        assert!(result.is_err(), "Unauthorized party should not release");

        // Payee cannot refund
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.refund_escrow(&payee, &escrow_id);
        }));
        assert!(result.is_err(), "Payee should not refund");
    }

    #[test]
    fn fuzz_invariant_positive_amount_required() {
        // Test that zero and negative amounts are rejected
        let env = Env::default();
        let (token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        // Zero amount should fail
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.deposit(
                &1u64,
                &payer,
                &payee,
                &0i128,
                &token,
                &ReleaseCondition::OnCompletion,
            );
        }));
        assert!(result.is_err(), "Zero amount should be rejected");

        // Negative amount should fail
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.deposit(
                &1u64,
                &payer,
                &payee,
                &-100i128,
                &token,
                &ReleaseCondition::OnCompletion,
            );
        }));
        assert!(result.is_err(), "Negative amount should be rejected");
    }

    #[test]
    fn fuzz_invariant_timelock_release_condition() {
        // Test that timelock condition is enforced
        let env = Env::default();
        let (token, payer, payee) = setup_token_env(&env, 1000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        // Set current time to 1000
        env.ledger().with_mut(|l| {
            l.timestamp = 1000;
        });

        // Create escrow with timelock at 2000
        let escrow_id = contract.deposit(
            &1u64,
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::Timelock(2000),
        );

        // Try to release before timelock - should fail
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.release_funds(&payee, &escrow_id);
        }));
        assert!(result.is_err(), "Release before timelock should fail");

        // Advance time to 2000
        env.ledger().with_mut(|l| {
            l.timestamp = 2000;
        });

        // Release should now succeed
        assert!(contract.release_funds(&payee, &escrow_id));
    }

    #[test]
    fn fuzz_invariant_escrow_counter_increments() {
        // Test that escrow IDs increment without gaps
        let env = Env::default();
        let (token, payer, payee) = setup_token_env(&env, 5000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let mut ids = Vec::new(&env);
        for _ in 0..10 {
            ids.push_back(
                contract.deposit(
                    &1u64,
                    &payer,
                    &payee,
                    &(500i128),
                    &token,
                    &ReleaseCondition::OnCompletion,
                )
            );
        }

        // Verify sequential IDs
        for (i, id) in ids.iter().enumerate() {
            assert_eq!(id, (i + 1) as u64, "IDs should increment sequentially");
        }

        // Verify we can retrieve all escrows
        for id in ids {
            let escrow = contract.get_escrow(&id);
            assert_eq!(escrow.id, id);
            assert_eq!(escrow.status, EscrowStatus::Active);
        }
    }

    #[test]
    fn fuzz_invariant_concurrent_escrows() {
        // Test multiple concurrent escrows don't interfere
        let env = Env::default();
        let (token, payer, payee) = setup_token_env(&env, 10000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        let mut escrow_ids = Vec::new(&env);
        for _ in 0..5 {
            escrow_ids.push_back(
                contract.deposit(
                    &1u64,
                    &payer,
                    &payee,
                    &(1000i128),
                    &token,
                    &ReleaseCondition::OnCompletion,
                )
            );
        }

        // Release every other escrow
        for (i, id) in escrow_ids.iter().enumerate() {
            if i % 2 == 0 {
                assert!(contract.release_funds(&payer, &id));
            }
        }

        // Verify states
        for (i, id) in escrow_ids.iter().enumerate() {
            let escrow = contract.get_escrow(&id);
            if i % 2 == 0 {
                assert_eq!(escrow.status, EscrowStatus::Released);
            } else {
                assert_eq!(escrow.status, EscrowStatus::Active);
            }
        }
    }

    #[test]
    fn fuzz_invariant_status_transitions() {
        // Test valid and invalid status transitions
        let env = Env::default();
        let (token, payer, payee) = setup_token_env(&env, 2000i128);
        let contract = EscrowContractClient::new(&env, &env.register_contract(None, EscrowContract));

        // Test valid transition: Active -> Released
        let id1 = contract.deposit(
            &1u64,
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );
        assert_eq!(contract.get_escrow(&id1).status, EscrowStatus::Active);
        contract.release_funds(&payer, &id1);
        assert_eq!(contract.get_escrow(&id1).status, EscrowStatus::Released);

        // Test valid transition: Active -> Refunded
        let id2 = contract.deposit(
            &1u64,
            &payer,
            &payee,
            &1000i128,
            &token,
            &ReleaseCondition::OnCompletion,
        );
        assert_eq!(contract.get_escrow(&id2).status, EscrowStatus::Active);
        contract.refund_escrow(&payer, &id2);
        assert_eq!(contract.get_escrow(&id2).status, EscrowStatus::Refunded);

        // Test invalid transitions from Released
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.refund_escrow(&payer, &id1);
        }));
        assert!(result.is_err(), "Cannot refund released escrow");

        // Test invalid transitions from Refunded
        let result = panic::catch_unwind(panic::AssertUnwindSafe(|| {
            contract.release_funds(&payee, &id2);
        }));
        assert!(result.is_err(), "Cannot release refunded escrow");
    }
}
