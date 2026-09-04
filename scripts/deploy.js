#!/usr/bin/env node
/**
 * scripts/deploy.js
 *
 * Deploys (or simulates) Soroban contracts to the Stellar network.
 *
 * Required env vars:
 *   STELLAR_NETWORK            - "mainnet" | "testnet"
 *   STELLAR_RPC_URL            - Soroban RPC endpoint
 *   STELLAR_NETWORK_PASSPHRASE - Network passphrase
 *   STELLAR_ADMIN_SECRET       - Deployer secret key (skipped in --simulate-only)
 *
 * Flags:
 *   --simulate-only  Run preflight simulations only; do not submit transactions.
 */

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SIMULATE_ONLY = process.argv.includes("--simulate-only");

const NETWORK = process.env.STELLAR_NETWORK;
const RPC_URL = process.env.STELLAR_RPC_URL;
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE;
const ADMIN_SECRET = process.env.STELLAR_ADMIN_SECRET;

// Guard: refuse to run against mainnet without an explicit network flag.
if (NETWORK === "mainnet" && !SIMULATE_ONLY && !ADMIN_SECRET) {
  console.error("❌ STELLAR_ADMIN_SECRET is required for mainnet deployments.");
  process.exit(1);
}

if (!RPC_URL) {
  console.error("❌ STELLAR_RPC_URL is not set.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Contracts to deploy (name → wasm path relative to repo root)
// ---------------------------------------------------------------------------

const WASM_DIR = process.env.WASM_DIR || "backend/target/wasm32-unknown-unknown/release";

// Two build paths feed WASM_DIR to this script, and they name their output
// files differently:
//   - A direct `cargo build --package <name>` (deploy-contracts.yml,
//     deploy-mainnet.yml's simulate-contracts job) produces cargo's package
//     name with hyphens turned to underscores, e.g.
//     stellar-bounty-contract -> stellar_bounty_contract.wasm.
//   - The Docker-based reproducible build (scripts/build-reproducible.sh,
//     used by deploy-mainnet.yml's deploy-contracts job via scripts/verify.sh)
//     extracts and renames to short names, e.g. bounty.wasm.
// Each contract below lists both candidate filenames; resolveWasm() picks
// whichever actually exists so this script works from either build path
// without the caller needing to know which one populated WASM_DIR. `oracle`
// is the one package whose Cargo name has no `stellar-*-contract` prefix, so
// both candidates are identical for it.
const CONTRACTS = [
  { name: "bounty",     wasmCandidates: ["stellar_bounty_contract.wasm", "bounty.wasm"],         outputKey: "bounty_contract_id" },
  { name: "escrow",     wasmCandidates: ["stellar_escrow_contract.wasm", "escrow.wasm"],          outputKey: "escrow_contract_id" },
  { name: "freelancer", wasmCandidates: ["stellar_freelancer_contract.wasm", "freelancer.wasm"],  outputKey: "freelancer_contract_id" },
  { name: "governance", wasmCandidates: ["stellar_governance_contract.wasm", "governance.wasm"],  outputKey: "governance_contract_id" },
  { name: "oracle",     wasmCandidates: ["oracle.wasm"],                                          outputKey: "oracle_contract_id" },
  { name: "identity",   wasmCandidates: ["stellar_identity_contract.wasm", "identity.wasm"],      outputKey: "identity_contract_id" },
];

/** Resolves a contract's wasm file to whichever candidate filename actually
 * exists in WASM_DIR. Throws with both attempted paths if neither does. */
function resolveWasm(contract) {
  for (const filename of contract.wasmCandidates) {
    const candidate = path.resolve(WASM_DIR, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  const attempted = contract.wasmCandidates.map((f) => path.resolve(WASM_DIR, f)).join(", ");
  console.error(`❌ No WASM found for ${contract.name}. Tried: ${attempted}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
}

/** Emit a GitHub Actions output variable (no-op outside CI). */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`  → ${key}=${value}`);
}

// ---------------------------------------------------------------------------
// Simulate: preflight each contract upload against the RPC
// ---------------------------------------------------------------------------

function simulateContract(contract) {
  const wasmPath = resolveWasm(contract);

  console.log(`  Simulating ${contract.name}…`);
  // stellar contract upload --simulate validates the wasm against the RPC
  // without submitting a transaction.
  run(
    `stellar contract upload \
      --wasm "${wasmPath}" \
      --rpc-url "${RPC_URL}" \
      --network-passphrase "${PASSPHRASE}" \
      --simulate`
  );
  console.log(`  ✅ ${contract.name} simulation passed`);
}

// ---------------------------------------------------------------------------
// Deploy: upload wasm + instantiate contract
// ---------------------------------------------------------------------------

function deployContract(contract) {
  const wasmPath = resolveWasm(contract);

  console.log(`  Uploading ${contract.name}…`);
  const wasmHash = run(
    `stellar contract upload \
      --wasm "${wasmPath}" \
      --rpc-url "${RPC_URL}" \
      --network-passphrase "${PASSPHRASE}" \
      --source "${ADMIN_SECRET}"`
  );

  console.log(`  Deploying ${contract.name} (hash: ${wasmHash})…`);
  const contractId = run(
    `stellar contract deploy \
      --wasm-hash "${wasmHash}" \
      --rpc-url "${RPC_URL}" \
      --network-passphrase "${PASSPHRASE}" \
      --source "${ADMIN_SECRET}"`
  );

  setOutput(contract.outputKey, contractId);
  return contractId;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\n🚀 Stellar Contract ${SIMULATE_ONLY ? "Simulation" : "Deployment"}`);
console.log(`   Network : ${NETWORK ?? "(not set)"}`);
console.log(`   RPC     : ${RPC_URL}`);
console.log(`   Mode    : ${SIMULATE_ONLY ? "simulate-only" : "deploy"}\n`);

const deployedContracts = {};

for (const contract of CONTRACTS) {
  if (SIMULATE_ONLY) {
    simulateContract(contract);
  } else {
    const contractId = deployContract(contract);
    deployedContracts[contract.name] = contractId;
  }
}

if (!SIMULATE_ONLY && Object.keys(deployedContracts).length > 0) {
  const contractsJson = {
    network: NETWORK,
    timestamp: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || "local",
    contracts: deployedContracts,
  };
  const outPath = path.resolve("contracts.json");
  fs.writeFileSync(outPath, JSON.stringify(contractsJson, null, 2) + "\n");
  console.log(`\n📄 Contract IDs written to ${outPath}`);
}

console.log(`\n✅ All contracts ${SIMULATE_ONLY ? "simulated" : "deployed"} successfully.\n`);
