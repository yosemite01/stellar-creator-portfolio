//! Per-entrypoint CPU / memory benchmarks.
//!
//! Each scenario resets the budget immediately before the measured call, so
//! setup (registering contracts, minting, prerequisite calls) is excluded.
//! Results are compared with `backend/contracts/benchmarks.json`; anything
//! more than `threshold_pct` above its baseline is reported as a GitHub
//! Actions `::warning::` annotation. The test only fails on a regression when
//! `BENCH_STRICT=1` is set.
//!
//! Contracts are registered natively (not as Wasm), so the numbers cover host
//! work done by the entrypoint but not VM instantiation. They are a
//! regression signal, not a fee quote.
//!
//! Refresh the baseline after an intentional cost change:
//!
//! ```sh
//! cd backend && UPDATE_BENCHMARKS=1 cargo test -p contract-benchmarks -- --nocapture
//! ```

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, String};

use stellar_bounty_contract::{BountyContract, BountyContractClient};
use stellar_escrow_contract::{EscrowContract, EscrowContractClient, ReleaseCondition};
use stellar_freelancer_contract::{FreelancerContract, FreelancerContractClient};
use stellar_governance_contract::{GovernanceContract, GovernanceContractClient};

const DEFAULT_THRESHOLD_PCT: f64 = 10.0;

#[derive(Clone, Copy)]
struct Cost {
    cpu_insns: u64,
    mem_bytes: u64,
}

/// Runs `f` with a freshly reset budget and returns what it consumed.
fn measure<T>(env: &Env, f: impl FnOnce() -> T) -> Cost {
    let mut budget = env.cost_estimate().budget();
    budget.reset_default();
    f();
    Cost {
        cpu_insns: budget.cpu_instruction_cost(),
        mem_bytes: budget.memory_bytes_cost(),
    }
}

fn escrow_scenarios(out: &mut BTreeMap<&'static str, Cost>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&payer, &10_000);
    let escrow = EscrowContractClient::new(&env, &env.register(EscrowContract, ()));

    let mut id = 0;
    out.insert(
        "escrow::deposit",
        measure(&env, || {
            id = escrow.deposit(&1, &payer, &payee, &1_000, &token, &ReleaseCondition::OnCompletion)
        }),
    );
    out.insert("escrow::release_funds", measure(&env, || escrow.release_funds(&payee, &id)));
}

fn bounty_scenarios(out: &mut BTreeMap<&'static str, Cost>) {
    let env = Env::default();
    env.mock_all_auths();
    let bounty = BountyContractClient::new(&env, &env.register(BountyContract, ()));
    let creator = Address::generate(&env);
    let freelancer = Address::generate(&env);
    let title = String::from_str(&env, "Benchmark bounty");
    let description = String::from_str(&env, "Bounty used for resource benchmarks");
    let proposal = String::from_str(&env, "Proposal used for resource benchmarks");

    let mut bounty_id = 0;
    out.insert(
        "bounty::create_bounty",
        measure(&env, || {
            bounty_id = bounty.create_bounty(&creator, &title, &description, &5_000, &(30 * 86_400))
        }),
    );
    let mut application_id = 0;
    out.insert(
        "bounty::apply_for_bounty",
        measure(&env, || {
            application_id = bounty.apply_for_bounty(&bounty_id, &freelancer, &proposal, &4_500, &(14 * 86_400))
        }),
    );
    out.insert(
        "bounty::select_freelancer",
        measure(&env, || bounty.select_freelancer(&bounty_id, &application_id)),
    );
}

fn freelancer_scenarios(out: &mut BTreeMap<&'static str, Cost>) {
    let env = Env::default();
    env.mock_all_auths();
    let registry = FreelancerContractClient::new(&env, &env.register(FreelancerContract, ()));
    let freelancer = Address::generate(&env);
    let name = String::from_str(&env, "Ada");
    let discipline = String::from_str(&env, "Design");
    let bio = String::from_str(&env, "Freelancer used for resource benchmarks");

    out.insert(
        "freelancer::register_freelancer",
        measure(&env, || registry.register_freelancer(&freelancer, &name, &discipline, &bio)),
    );
    out.insert("freelancer::get_profile", measure(&env, || registry.get_profile(&freelancer)));
}

fn governance_scenarios(out: &mut BTreeMap<&'static str, Cost>) {
    let env = Env::default();
    env.mock_all_auths();
    let governance = GovernanceContractClient::new(&env, &env.register(GovernanceContract, ()));
    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let title = String::from_str(&env, "Benchmark proposal");
    let description = String::from_str(&env, "Proposal used for resource benchmarks");

    let mut proposal_id = 0;
    out.insert(
        "governance::create_proposal",
        measure(&env, || proposal_id = governance.create_proposal(&proposer, &title, &description, &86_400)),
    );
    out.insert("governance::vote", measure(&env, || governance.vote(&voter, &proposal_id, &true)));
}

fn baseline_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../benchmarks.json")
}

/// Percentage change from `base` to `now`; `None` when there is no baseline.
fn pct_change(base: u64, now: u64) -> Option<f64> {
    (base > 0).then(|| (now as f64 - base as f64) / base as f64 * 100.0)
}

#[test]
fn entrypoint_costs() {
    let mut results = BTreeMap::new();
    escrow_scenarios(&mut results);
    bounty_scenarios(&mut results);
    freelancer_scenarios(&mut results);
    governance_scenarios(&mut results);

    let path = baseline_path();
    let baseline: Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}));
    let threshold = baseline["threshold_pct"].as_f64().unwrap_or(DEFAULT_THRESHOLD_PCT);

    if std::env::var("UPDATE_BENCHMARKS").as_deref() == Ok("1") {
        let entrypoints: serde_json::Map<_, _> = results
            .iter()
            .map(|(name, c)| (name.to_string(), json!({ "cpu_insns": c.cpu_insns, "mem_bytes": c.mem_bytes })))
            .collect();
        let updated = json!({ "threshold_pct": threshold, "entrypoints": entrypoints });
        std::fs::write(&path, serde_json::to_string_pretty(&updated).unwrap() + "\n").unwrap();
        println!("Wrote {} entrypoint baselines to {}", results.len(), path.display());
        return;
    }

    let mut table = std::string::String::from(
        "| Entrypoint | CPU insns | Δ CPU | Mem bytes | Δ Mem |\n|---|---:|---:|---:|---:|\n",
    );
    let mut regressions = Vec::new();
    for (name, now) in &results {
        let base = &baseline["entrypoints"][*name];
        let cpu_delta = base["cpu_insns"].as_u64().and_then(|b| pct_change(b, now.cpu_insns));
        let mem_delta = base["mem_bytes"].as_u64().and_then(|b| pct_change(b, now.mem_bytes));
        let fmt = |d: Option<f64>| d.map_or("n/a".into(), |d| format!("{d:+.1}%"));
        table.push_str(&format!(
            "| `{name}` | {} | {} | {} | {} |\n",
            now.cpu_insns,
            fmt(cpu_delta),
            now.mem_bytes,
            fmt(mem_delta)
        ));

        if cpu_delta.is_none() && mem_delta.is_none() {
            println!("::notice title=No cost baseline::{name} has no entry in benchmarks.json");
            continue;
        }
        for (metric, delta) in [("CPU", cpu_delta), ("memory", mem_delta)] {
            if let Some(d) = delta.filter(|d| *d > threshold) {
                println!(
                    "::warning title=Contract cost regression::{name} {metric} up {d:.1}% (threshold {threshold}%)"
                );
                regressions.push(format!("{name} {metric} +{d:.1}%"));
            }
        }
    }

    println!("\n{table}");
    if let Ok(summary) = std::env::var("GITHUB_STEP_SUMMARY") {
        let section = format!("## Contract entrypoint costs\n\n{table}\n");
        let _ = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(summary)
            .and_then(|mut f| std::io::Write::write_all(&mut f, section.as_bytes()));
    }

    if std::env::var("BENCH_STRICT").as_deref() == Ok("1") {
        assert!(regressions.is_empty(), "cost regressions over {threshold}%: {regressions:?}");
    }
}
