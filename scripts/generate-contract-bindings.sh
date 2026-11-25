#!/usr/bin/env bash
# scripts/generate-contract-bindings.sh
#
# Builds the canonical contracts and regenerates their TypeScript bindings into
# packages/contracts-ts/src/<name>/ using the @stellar/stellar-sdk CLI.
# CI runs this and fails if the committed bindings differ (see ci.yml).
#
# Usage:
#   ./scripts/generate-contract-bindings.sh
#
# Requires: the Stellar CLI (`stellar`), cargo with the wasm32v1-none target,
# and `pnpm install` run at the repo root (provides the `stellar-js` binary).
# Set STELLAR_JS to override the generator command.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$REPO_ROOT/packages/contracts-ts/src"
# Built wasm goes to a scratch dir: `stellar contract build --out-dir` copies
# it there regardless of CARGO_TARGET_DIR.
WASM_DIR="$(mktemp -d)"
STELLAR_JS="${STELLAR_JS:-pnpm --dir $REPO_ROOT exec stellar-js}"
# name:cargo-package:wasm-file (cargo names the wasm after the package)
CONTRACTS=(
  bounty:stellar-bounty-contract:stellar_bounty_contract.wasm
  escrow:stellar-escrow-contract:stellar_escrow_contract.wasm
  freelancer:stellar-freelancer-contract:stellar_freelancer_contract.wasm
  governance:stellar-governance-contract:stellar_governance_contract.wasm
  identity:stellar-identity-contract:stellar_identity_contract.wasm
  oracle:oracle:oracle.wasm
)

command -v stellar >/dev/null || { echo "❌ stellar CLI not found (https://developers.stellar.org/docs/tools/cli)"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$WASM_DIR"' EXIT

# `stellar contract build` (not plain `cargo build`) is the supported way to
# build Soroban contracts: it uses the release contract profile and embeds
# the contract metadata (contractmeta/env meta) the binding generator and
# deploy tooling read. It builds one package at a time.
echo "🔨 Building contracts…"
for entry in "${CONTRACTS[@]}"; do
  pkg="$(cut -d: -f2 <<<"$entry")"
  stellar contract build \
    --manifest-path "$REPO_ROOT/backend/Cargo.toml" \
    --package "$pkg" \
    --out-dir "$WASM_DIR"
done

for entry in "${CONTRACTS[@]}"; do
  IFS=: read -r c _ wasm <<<"$entry"
  echo "🧬 Generating bindings for ${c}…"
  $STELLAR_JS generate \
    --wasm "$WASM_DIR/$wasm" \
    --contract-name "$c" \
    --output-dir "$TMP/$c" \
    --overwrite >/dev/null
  rm -rf "${OUT_DIR:?}/$c"
  mkdir -p "$OUT_DIR/$c"
  cp "$TMP/$c"/src/*.ts "$OUT_DIR/$c/"
  # The app bundles these with Turbopack, which can't map './x.js' back to
  # x.ts, so drop the .js suffix from relative imports.
  sed -i -E "s#(from ['\"]\\./[^'\"]+)\\.js(['\"])#\\1\\2#" "$OUT_DIR/$c"/*.ts
done

echo "✅ Bindings written to packages/contracts-ts/src/"
