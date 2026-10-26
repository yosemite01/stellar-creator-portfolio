#!/usr/bin/env bash
# scripts/build-reproducible.sh
#
# Builds all Soroban contracts inside the pinned Docker environment and copies
# the WASM artifacts + their SHA-256 hashes to ./artifacts/.
#
# The Docker image pins Rust 1.89.0 and stellar-cli 20.3.1 so outputs are
# byte-for-byte identical regardless of where this runs (CI or local).
# Bump those pins deliberately and re-baseline with scripts/verify.sh --update-baseline.
#
# Usage:
#   ./scripts/build-reproducible.sh
#   BUILD_NO_CACHE=1 ./scripts/build-reproducible.sh   # force full rebuild
#
# Output:
#   artifacts/{bounty,core,escrow,freelancer,governance,identity,insurance,oracle,referral,stellar_insights}.wasm
#   artifacts/hashes.sha256
#
# Related: #1348

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="$REPO_ROOT/artifacts"
IMAGE_TAG="stellar-contracts-builder:local"

# Pinned tool versions — must match Dockerfile.contracts.
RUST_VERSION="1.94.1"
STELLAR_CLI_VERSION="28.1.0"

echo "🔨 Building reproducible contracts…"
echo "   Rust version        : $RUST_VERSION  (pinned)"
echo "   stellar-cli version : $STELLAR_CLI_VERSION  (pinned)"
echo "   Image tag           : $IMAGE_TAG"
echo ""

# Build the Docker image (layer-cached on subsequent runs).
BUILD_ARGS=()
if [[ "${BUILD_NO_CACHE:-0}" == "1" ]]; then
  BUILD_ARGS+=(--no-cache)
  echo "  ⚠️  --no-cache requested: full rebuild"
fi

docker build \
  "${BUILD_ARGS[@]}" \
  --file "$REPO_ROOT/Dockerfile.contracts" \
  --tag  "$IMAGE_TAG" \
  --target builder \
  "$REPO_ROOT"

# Verify the Rust version inside the image matches our pin.
ACTUAL_RUST=$(docker run --rm --entrypoint rustc "$IMAGE_TAG" --version 2>/dev/null \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$ACTUAL_RUST" != "$RUST_VERSION" ]]; then
  echo "❌ Rust version mismatch in image!"
  echo "   Expected: $RUST_VERSION"
  echo "   Actual:   $ACTUAL_RUST"
  echo "   Update RUST_VERSION in both Dockerfile.contracts and this script, then re-baseline."
  exit 1
fi
echo "  ✅ Rust version verified: $ACTUAL_RUST"

# Extract WASM artifacts from the image without running a persistent container.
mkdir -p "$ARTIFACTS_DIR"

CONTRACTS=(bounty core escrow freelancer governance identity insurance oracle referral stellar_insights)

for CONTRACT in "${CONTRACTS[@]}"; do
  docker run --rm --entrypoint cat "$IMAGE_TAG" \
    "/build/target/wasm32v1-none/release/${CONTRACT}.wasm" \
    > "$ARTIFACTS_DIR/${CONTRACT}.wasm"
  echo "  ✅ Extracted ${CONTRACT}.wasm"
done

# Also extract the pre-computed hash file from the image for cross-check.
DOCKER_HASHES=$(docker run --rm --entrypoint cat "$IMAGE_TAG" /build/wasm-hashes.sha256 2>/dev/null || true)

# Write canonical hash file from the local artifacts (authoritative source).
WASM_FILES=()
for CONTRACT in "${CONTRACTS[@]}"; do
  WASM_FILES+=("${CONTRACT}.wasm")
done
(cd "$ARTIFACTS_DIR" && sha256sum "${WASM_FILES[@]}") > "$ARTIFACTS_DIR/hashes.sha256"

# Cross-check: compare local hashes against those baked into the image.
if [[ -n "$DOCKER_HASHES" ]]; then
  echo ""
  echo "🔍 Cross-checking local hashes against image-baked hashes…"
  MISMATCH=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    EXPECTED_HASH="${line%% *}"
    ARTIFACT_NAME=$(basename "${line##* }")
    LOCAL_HASH=$(sha256sum "$ARTIFACTS_DIR/$ARTIFACT_NAME" 2>/dev/null | awk '{print $1}' || true)
    if [[ "$LOCAL_HASH" == "$EXPECTED_HASH" ]]; then
      echo "  ✅ $ARTIFACT_NAME"
    else
      echo "  ❌ $ARTIFACT_NAME hash mismatch (image=$EXPECTED_HASH, local=$LOCAL_HASH)"
      MISMATCH=1
    fi
  done <<< "$DOCKER_HASHES"
  if [[ "$MISMATCH" -eq 1 ]]; then
    echo "❌ Hash cross-check failed — build is not reproducible."
    exit 1
  fi
  echo "  ✅ All WASM hashes match image-baked reference"
fi

echo ""
echo "📋 Contract SHA-256 hashes:"
cat "$ARTIFACTS_DIR/hashes.sha256"
echo ""
echo "Artifacts written to: $ARTIFACTS_DIR"

# ---------------------------------------------------------------------------
# Next.js reproducible build
# ---------------------------------------------------------------------------
echo ""
echo "🔨 Building Next.js app reproducibly…"

GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
echo "  Git SHA: $GIT_SHA"

NEXT_DISABLE_SOURCEMAPS=1 \
NEXT_PUBLIC_BUILD_ID="$GIT_SHA" \
  pnpm --dir "$REPO_ROOT" build

# Write the BUILD_ID file (next build may have already created it; overwrite
# with the canonical git SHA so both runs produce the same content).
echo "$GIT_SHA" > "$REPO_ROOT/.next/BUILD_ID"
echo "  ✅ BUILD_ID written: $GIT_SHA"

# GPG-sign the BUILD_ID if a signing key is configured.
if [[ -n "${SIGNING_KEY:-}" ]]; then
  gpg --batch --yes \
      --detach-sign --armor \
      --default-key "$SIGNING_KEY" \
      "$REPO_ROOT/.next/BUILD_ID"
  echo "  ✅ BUILD_ID signed: .next/BUILD_ID.asc"
else
  echo "  ⚠️  SIGNING_KEY not set — BUILD_ID not signed (set SIGNING_KEY=<gpg-key-id> to enable)"
fi

# Append BUILD_ID hash to the shared artifact manifest.
(cd "$REPO_ROOT" && sha256sum .next/BUILD_ID) >> "$ARTIFACTS_DIR/hashes.sha256"

echo ""
echo "📋 Full artifact hashes (contracts + Next.js):"
cat "$ARTIFACTS_DIR/hashes.sha256"
echo ""
echo "✅ Reproducible build complete."
