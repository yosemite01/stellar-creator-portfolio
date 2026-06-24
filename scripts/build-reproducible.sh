#!/usr/bin/env bash
# scripts/build-reproducible.sh
#
# Builds all Soroban contracts inside the pinned Docker environment and copies
# the WASM artifacts + their SHA-256 hashes to ./artifacts/.
#
# Usage:
#   ./scripts/build-reproducible.sh
#
# Output:
#   artifacts/{bounty,escrow,freelancer,governance}.wasm
#   artifacts/hashes.sha256

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="$REPO_ROOT/artifacts"
IMAGE_TAG="stellar-contracts-builder:local"

echo "🔨 Building reproducible contracts…"

# Build the Docker image (layer-cached on subsequent runs).
docker build \
  --file "$REPO_ROOT/Dockerfile" \
  --tag  "$IMAGE_TAG" \
  --target builder \
  "$REPO_ROOT"

# Extract WASM artifacts from the image without running a container.
mkdir -p "$ARTIFACTS_DIR"

for CONTRACT in bounty escrow freelancer governance; do
  docker run --rm --entrypoint cat "$IMAGE_TAG" \
    "/build/target/wasm32-unknown-unknown/release/${CONTRACT}.wasm" \
    > "$ARTIFACTS_DIR/${CONTRACT}.wasm"
  echo "  ✅ Extracted ${CONTRACT}.wasm"
done

# Write canonical hash file.
(cd "$ARTIFACTS_DIR" && sha256sum bounty.wasm escrow.wasm freelancer.wasm governance.wasm) \
  > "$ARTIFACTS_DIR/hashes.sha256"

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
