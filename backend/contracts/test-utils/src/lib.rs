//! Shared Soroban contract test helpers.
//!
//! Every contract's test module re-implements the same
//! `Env::default(); env.mock_all_auths();` and `Address::generate(&env)`
//! boilerplate. This crate centralizes that setup so new contract test
//! suites can build on it instead of copy-pasting it, and so the
//! negative-auth-test pattern (asserting a call fails without the right
//! `require_auth`) is a single reusable helper rather than something each
//! contract author has to remember to hand-roll.

extern crate std;

use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env};

/// A fresh `Env` with all auths mocked, for tests that don't care about
/// exercising real authorization failures.
pub fn test_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

/// A fresh `Env` with auths left unmocked, for negative-auth tests: calls
/// made against it will only succeed if the caller actually authorizes
/// them (e.g. via `env.set_auths(&[...])`), so a missing/incorrect
/// authorization surfaces as a real panic instead of being mocked away.
pub fn unauthorized_env() -> Env {
    Env::default()
}

/// Generates a new test address. Thin wrapper kept so call sites don't each
/// need `use soroban_sdk::testutils::Address as _`.
pub fn new_address(env: &Env) -> Address {
    Address::generate(env)
}

/// Registers a Stellar Asset Contract token and mints `amount` to `mint_to`.
/// Mirrors the setup several contracts (e.g. bounty) need for any test that
/// touches escrowed/transferred funds. Returns the token contract address.
pub fn setup_funded_token(env: &Env, mint_to: &Address, amount: i128) -> Address {
    let admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token = sac.address();

    let asset_client = StellarAssetClient::new(env, &token);
    asset_client.mint(mint_to, &amount);

    token
}

/// Asserts that calling `f` panics — the standard pattern for confirming an
/// operation is correctly gated behind `require_auth` and fails when the
/// required signer hasn't authorized the call. Use with an
/// [`unauthorized_env`] (or an env where the relevant address's auth was
/// never mocked/provided).
pub fn assert_requires_auth<F: FnOnce() + std::panic::UnwindSafe>(f: F) {
    let result = std::panic::catch_unwind(f);
    assert!(
        result.is_err(),
        "expected call to panic due to missing authorization, but it succeeded"
    );
}
