#!/usr/bin/env bash
# scripts/verify.sh
#
# Rebuilds contracts and the Next.js app from source, then verifies all
# artifact hashes match a committed baseline (artifacts/hashes.sha256).
# Also verifies the GPG signature on the Next.js BUILD_ID when present.
#
# Usage:
#   ./scripts/verify.sh                  # full rebuild + verify
#   ./scripts/verify.sh --update-baseline  # rebuild baseline and commit it
#   ./scripts/verify.sh --sign-only      # sign existing BUILD_ID without rebuilding
#
# Exit codes:
#   0  All hashes match (or baseline updated / sign-only succeeded).
#   1  One or more hashes differ, or GPG signature invalid.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARTIFACTS_DIR="$REPO_ROOT/artifacts"
BASELINE="$ARTIFACTS_DIR/hashes.sha256"
FLAG="${1:-}"

# ---------------------------------------------------------------------------
# --sign-only: just GPG-sign the existing BUILD_ID and exit
# ---------------------------------------------------------------------------
if [[ "$FLAG" == "--sign-only" ]]; then
  BUILD_ID_FILE="$REPO_ROOT/.next/BUILD_ID"
  if [[ ! -f "$BUILD_ID_FILE" ]]; then
    echo "❌ .next/BUILD_ID not found — run a build first."
    exit 1
  fi
  if [[ -z "${SIGNING_KEY:-}" ]]; then
    echo "❌ SIGNING_KEY env var not set."
    exit 1
  fi
  gpg --batch --yes \
      --detach-sign --armor \
      --default-key "$SIGNING_KEY" \
      "$BUILD_ID_FILE"
  echo "✅ BUILD_ID signed: .next/BUILD_ID.asc"
  exit 0
fi

# ---------------------------------------------------------------------------
# Full rebuild inside Docker (contracts + Next.js)
# ---------------------------------------------------------------------------
"$REPO_ROOT/scripts/build-reproducible.sh"

if [[ "$FLAG" == "--update-baseline" ]]; then
  echo "✅ Baseline updated: $BASELINE"
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "❌ No baseline found at $BASELINE."
  echo "   Run with --update-baseline to create one."
  exit 1
fi

echo ""
echo "🔍 Verifying artifact hashes against baseline…"

FAIL=0
while IFS= read -r line; do
  # Skip blank lines and comments
  [[ -z "$line" || "$line" == \#* ]] && continue

  EXPECTED_HASH="${line%% *}"
  ARTIFACT_PATH="${line##* }"

  # Resolve relative paths (entries may be "artifacts/foo.wasm" or ".next/BUILD_ID")
  if [[ "$ARTIFACT_PATH" == /* ]]; then
    FULL_PATH="$ARTIFACT_PATH"
  else
    FULL_PATH="$REPO_ROOT/$ARTIFACT_PATH"
  fi

  if [[ ! -f "$FULL_PATH" ]]; then
    echo "  ⚠️  Missing artifact: $ARTIFACT_PATH"
    FAIL=1
    continue
  fi

  ACTUAL_HASH="$(sha256sum "$FULL_PATH" | awk '{print $1}')"

  if [[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]]; then
    echo "  ✅ $ARTIFACT_PATH"
  else
    echo "  ❌ $ARTIFACT_PATH"
    echo "     expected: $EXPECTED_HASH"
    echo "     actual:   $ACTUAL_HASH"
    FAIL=1
  fi
done < "$BASELINE"

# ---------------------------------------------------------------------------
# Next.js BUILD_ID hash display
# ---------------------------------------------------------------------------
BUILD_ID_FILE="$REPO_ROOT/.next/BUILD_ID"
if [[ -f "$BUILD_ID_FILE" ]]; then
  BUILD_HASH="$(sha256sum "$BUILD_ID_FILE" | awk '{print $1}')"
  echo ""
  echo "  🔎 BUILD_ID value : $(cat "$BUILD_ID_FILE")"
  echo "  🔎 BUILD_ID hash  : $BUILD_HASH"
fi

# ---------------------------------------------------------------------------
# GPG signature verification for BUILD_ID
# ---------------------------------------------------------------------------
BUILD_SIG_FILE="$REPO_ROOT/.next/BUILD_ID.asc"
echo ""
if [[ -f "$BUILD_SIG_FILE" ]]; then
  if gpg --verify "$BUILD_SIG_FILE" "$BUILD_ID_FILE" 2>/dev/null; then
    echo "  ✅ BUILD_ID signature verified"
  else
    echo "  ❌ BUILD_ID signature INVALID"
    FAIL=1
  fi
else
  echo "  ⚠️  No BUILD_ID signature found (.next/BUILD_ID.asc missing — set SIGNING_KEY during build to enable)"
fi

# ---------------------------------------------------------------------------
# Final result
# ---------------------------------------------------------------------------
if [[ "$FAIL" -eq 1 ]]; then
  echo ""
  echo "❌ Verification failed — build is NOT reproducible or signature is invalid."
  exit 1
fi

echo ""
echo "✅ All artifact hashes verified. Build is reproducible."
