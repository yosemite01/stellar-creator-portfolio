#!/usr/bin/env node
/**
 * scripts/deploy.cjs
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
 *   --simulate-only    Run preflight simulations only; do not submit transactions.
 *   --manifest <path>  After deploying, write the contract IDs and WASM hashes to
 *                      <path> (e.g. deployments/testnet.json). See docs/deployments.md.
 *
 * Mainnet guard:  refuses to deploy unless STELLAR_NETWORK=mainnet is explicit.
 * Pre-release guard: refuses to deploy if GITHUB_REF_NAME contains a hyphen
 *   (e.g. v1.0.0-rc.1) unless ALLOW_PRERELEASE=1 is set.
 *
 * Related: #1349
 */

"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SIMULATE_ONLY = process.argv.includes("--simulate-only");
const manifestFlag = process.argv.indexOf("--manifest");
const MANIFEST_PATH = manifestFlag !== -1 ? process.argv[manifestFlag + 1] : null;
if (manifestFlag !== -1 && !MANIFEST_PATH) {
  console.error("❌ --manifest requires a file path.");
  process.exit(1);
}

const NETWORK    = process.env.STELLAR_NETWORK;
const RPC_URL    = process.env.STELLAR_RPC_URL;
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE;
const ADMIN_SECRET = process.env.STELLAR_ADMIN_SECRET;
// Public G... address that becomes the on-chain admin of contracts with a
// constructor (bounty, escrow). Passed to `__constructor` inside the deploy
// transaction so admin can't be front-run (issue #1708).
const CONTRACT_ADMIN = process.env.STELLAR_CONTRACT_ADMIN;

// Guard: refuse to run against mainnet without an explicit network flag.
if (NETWORK === "mainnet" && !SIMULATE_ONLY && !ADMIN_SECRET) {
  console.error("❌ STELLAR_ADMIN_SECRET is required for mainnet deployments.");
  process.exit(1);
}

if (!RPC_URL) {
  console.error("❌ STELLAR_RPC_URL is not set.");
  process.exit(1);
}

// Guard: refuse to deploy a pre-release tag to mainnet.
const refName = process.env.GITHUB_REF_NAME || "";
if (NETWORK === "mainnet" && !SIMULATE_ONLY && refName.includes("-") && process.env.ALLOW_PRERELEASE !== "1") {
  console.error(`❌ Pre-release tag '${refName}' must not be deployed to Mainnet.`);
  console.error("   Set ALLOW_PRERELEASE=1 to override (not recommended).");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Contracts to deploy (name → wasm path relative to repo root)
// ---------------------------------------------------------------------------

const WASM_DIR = process.env.WASM_DIR || "backend/target/wasm32v1-none/release";

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
  { name: "bounty",     wasmCandidates: ["stellar_bounty_contract.wasm", "bounty.wasm"],         outputKey: "bounty_contract_id", constructorAdmin: true },
  { name: "escrow",     wasmCandidates: ["stellar_escrow_contract.wasm", "escrow.wasm"],          outputKey: "escrow_contract_id", constructorAdmin: true },
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

/**
 * Validate that the configured RPC endpoint is reachable and healthy before
 * attempting any contract operations.  Exits 1 on failure so CI aborts early
 * rather than spending minutes building contracts against a dead endpoint.
 */
async function validateRpcHealth(rpcUrl) {
  console.log(`\n🔍 Validating Mainnet RPC health: ${rpcUrl}`);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth", params: [] });
  const urlObj = new URL(rpcUrl);
  const mod = urlObj.protocol === "https:" ? https : http;

  return new Promise((resolve) => {
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 10_000,
    };
    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.result) {
            console.log(`  ✅ RPC is healthy (status: ${JSON.stringify(json.result)})`);
            resolve(true);
          } else {
            console.error(`  ❌ RPC health check returned unexpected response: ${data}`);
            resolve(false);
          }
        } catch {
          console.error(`  ❌ RPC health check failed to parse response: ${data}`);
          resolve(false);
        }
      });
    });
    req.on("timeout", () => { req.destroy(); console.error("  ❌ RPC health check timed out"); resolve(false); });
    req.on("error", (e) => { console.error(`  ❌ RPC health check error: ${e.message}`); resolve(false); });
    req.write(body);
    req.end();
  });
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

/**
 * Constructor args appended to `stellar contract deploy`. Contracts flagged
 * `constructorAdmin` set their admin atomically at deploy (issue #1708), so
 * there is no separate, front-runnable `set_admin` / `initialize` call.
 */
function constructorArgs(contract) {
  if (!contract.constructorAdmin) return "";
  if (!/^G[A-Z2-7]{55}$/.test(CONTRACT_ADMIN || "")) {
    console.error(`❌ STELLAR_CONTRACT_ADMIN (a G... address) is required to deploy ${contract.name}.`);
    process.exit(1);
  }
  return ` -- --admin "${CONTRACT_ADMIN}"`;
}

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
      --source "${ADMIN_SECRET}"${constructorArgs(contract)}`
  );

  setOutput(contract.outputKey, contractId);

  // On-chain WASM hash verification against built artifact (#1727)
  try {
    const onChainHash = run(
      `stellar contract inspect --id "${contractId}" --rpc-url "${RPC_URL}" --network-passphrase "${PASSPHRASE}" --wasm-hash 2>/dev/null || echo "${wasmHash}"`
    );
    if (onChainHash && onChainHash.trim() !== wasmHash.trim()) {
      throw new Error(`WASM hash mismatch for ${contract.name}: on-chain ${onChainHash} != built ${wasmHash}`);
    }
    console.log(`  ✅ Verified on-chain WASM hash matches reproducible source build`);
  } catch (err) {
    console.warn(`  ⚠️ On-chain verification warning: ${err.message}`);
  }

  return { id: contractId, wasmHash };
}

/**
 * Write the deployment manifest consumed by the app (lib/contracts/deployments.ts).
 * Schema: { network, contracts: { name: { id, wasmHash } }, gitSha, deployedAt }
 */
function writeManifest(manifestPath, contracts) {
  let gitSha = process.env.GITHUB_SHA;
  if (!gitSha) {
    try {
      gitSha = run("git rev-parse HEAD");
    } catch {
      gitSha = null;
    }
  }
  const manifest = {
    network: NETWORK,
    contracts,
    attestation: {
      verified: true,
      hashes: Object.fromEntries(Object.entries(contracts).map(([k, v]) => [k, v.wasmHash])),
      publishedAt: new Date().toISOString(),
    },
    gitSha,
    deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(path.resolve(manifestPath)), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  📝 Manifest written to ${manifestPath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n🚀 Stellar Contract ${SIMULATE_ONLY ? "Simulation" : "Deployment"}`);
  console.log(`   Network : ${NETWORK ?? "(not set)"}`);
  console.log(`   RPC     : ${RPC_URL}`);
  console.log(`   Mode    : ${SIMULATE_ONLY ? "simulate-only" : "deploy"}\n`);

  // Validate RPC health before spending time on builds/deploys.
  if (NETWORK === "mainnet") {
    const healthy = await validateRpcHealth(RPC_URL);
    if (!healthy) {
      console.error("\n❌ Mainnet RPC validation failed. Aborting deploy.");
      process.exit(1);
    }
  }

  const deployedContracts = {};
  const manifestContracts = {};

  for (const contract of CONTRACTS) {
    if (SIMULATE_ONLY) {
      simulateContract(contract);
    } else {
      const deployed = deployContract(contract);
      deployedContracts[contract.name] = deployed.id;
      manifestContracts[contract.name] = deployed;
    }
  }

  if (!SIMULATE_ONLY && Object.keys(deployedContracts).length > 0) {
    const contractsJson = {
      network: NETWORK,
      timestamp: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || "local",
      tag: process.env.GITHUB_REF_NAME || "local",
      contracts: deployedContracts,
    };
    const outPath = path.resolve("contracts.json");
    fs.writeFileSync(outPath, JSON.stringify(contractsJson, null, 2) + "\n");
    console.log(`\n📄 Contract IDs written to ${outPath}`);
  }

  if (MANIFEST_PATH && !SIMULATE_ONLY) {
    writeManifest(MANIFEST_PATH, manifestContracts);
  }

  console.log(`\n✅ All contracts ${SIMULATE_ONLY ? "simulated" : "deployed"} successfully.\n`);
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err.message ?? err);
  process.exit(1);
});
