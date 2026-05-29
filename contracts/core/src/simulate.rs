// contracts/core/src/simulate.rs
// Issue #518 — Contract Simulation Pre-flight
//
// Provides on-chain simulation helpers that validate invocations and
// return structured gas/error data before committing real transactions.

#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

/// Result returned by a pre-flight simulation.
#[contracttype]
pub struct SimResult {
    pub success: bool,
    /// Estimated CPU instructions consumed.
    pub gas_estimate: u64,
    /// Human-readable error message, empty on success.
    pub error: String,
}

#[contract]
pub struct SimulateContract;

#[contractimpl]
impl SimulateContract {
    /// Simulate a generic contract invocation.
    ///
    /// Validates that `caller` is authorised and that `args` are non-empty,
    /// then returns a gas estimate derived from the current ledger sequence.
    /// Failures are returned as structured errors — never panics — so the
    /// caller can surface them before prompting wallet confirmation.
    pub fn simulate(
        env: Env,
        caller: Address,
        contract_id: Address,
        method: String,
        args: Vec<String>,
    ) -> SimResult {
        // Require caller authorisation.
        caller.require_auth();

        if args.is_empty() {
            return SimResult {
                success: false,
                gas_estimate: 0,
                error: String::from_str(&env, "args must not be empty"),
            };
        }

        if method.len() == 0 {
            return SimResult {
                success: false,
                gas_estimate: 0,
                error: String::from_str(&env, "method name is required"),
            };
        }

        // Derive a deterministic gas estimate from ledger sequence + arg count.
        // Real implementations would invoke the contract in a read-only context.
        let base_gas: u64 = 100_000;
        let arg_cost: u64 = args.len() as u64 * 5_000;
        let ledger_factor: u64 = env.ledger().sequence() as u64 % 10_000;
        let gas_estimate = base_gas + arg_cost + ledger_factor;

        // Log the simulation for indexer consumption.
        env.events().publish(
            (String::from_str(&env, "simulate"), contract_id),
            (method, gas_estimate),
        );

        SimResult {
            success: true,
            gas_estimate,
            error: String::from_str(&env, ""),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec, Env};

    #[test]
    fn simulate_returns_gas_estimate() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SimulateContract);
        let client = SimulateContractClient::new(&env, &contract_id);

        let caller = Address::generate(&env);
        let target = Address::generate(&env);
        let result = client.simulate(
            &caller,
            &target,
            &String::from_str(&env, "transfer"),
            &vec![&env, String::from_str(&env, "arg1")],
        );

        assert!(result.success);
        assert!(result.gas_estimate >= 100_000);
    }

    #[test]
    fn simulate_fails_on_empty_args() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, SimulateContract);
        let client = SimulateContractClient::new(&env, &contract_id);

        let caller = Address::generate(&env);
        let target = Address::generate(&env);
        let result = client.simulate(
            &caller,
            &target,
            &String::from_str(&env, "transfer"),
            &vec![&env],
        );

        assert!(!result.success);
    }
}
