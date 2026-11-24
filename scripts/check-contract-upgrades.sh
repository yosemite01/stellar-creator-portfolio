#!/usr/bin/env bash
# Fails if any contract swaps its wasm outside the shared timelocked
# `stellar-upgradeable` library (#1719).
#
# Every canonical contract must route upgrades through
# `stellar_upgradeable::{propose_upgrade, execute_upgrade, cancel_upgrade}` so
# all of them share the same 48h minimum delay and the same events. A direct
# `update_current_contract_wasm` call anywhere else would reintroduce an
# instant-upgrade path, so it is rejected here. Each contract must also invoke
# the shared `upgrade_timelock_tests!` conformance macro.
set -euo pipefail

cd "$(dirname "$0")/../backend/contracts"

status=0

hits=$(grep -rn --include='*.rs' 'update_current_contract_wasm' . \
  | grep -v '^\./upgradeable/' \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//' || true)
if [ -n "$hits" ]; then
  echo "$hits"
  echo "error: update_current_contract_wasm must only be called from contracts/upgradeable" >&2
  status=1
fi

for manifest in */Cargo.toml; do
  dir=$(dirname "$manifest")
  case "$dir" in upgradeable|test-utils|benchmarks) continue ;; esac
  grep -q 'crate-type.*cdylib' "$manifest" || continue
  if ! grep -q 'stellar-upgradeable' "$manifest"; then
    echo "error: $dir does not depend on stellar-upgradeable" >&2
    status=1
  fi
  if ! grep -rq 'upgrade_timelock_tests!' "$dir/src"; then
    echo "error: $dir does not invoke stellar_upgradeable::upgrade_timelock_tests!" >&2
    status=1
  fi
done

exit "$status"
