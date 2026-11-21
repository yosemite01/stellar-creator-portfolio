# 📌 Issue Preview: Load tests for escrow and payout flows against testnet

**Labels:** `testing`, `performance`, `contracts`

**Issue:** #1794

---

### Description
The k6 suite exercises HTTP endpoints but not the on-chain transaction pipeline. Sequence
number contention, channel-account exhaustion, fee bumps and RPC rate limits only appear when
many escrow/payout transactions go out at once, and today nothing measures that before production.

### Current Behavior (as found in code)
- [load-tests/scenarios/bounties.test.js](../../load-tests/scenarios/bounties.test.js) covers the
  bounties REST API only. It does not fund escrow or release payouts.
- [load-tests/sequence-collision.test.js](../../load-tests/sequence-collision.test.js) (#838) ramps
  50 concurrent bounty submissions and tracks `sequence_collision_errors`, `tx_success_rate` and
  `tx_latency_ms`. It's the closest thing to an on-chain load test, but it targets `BASE_URL` with
  no guarantee that a real network sits behind it, and doesn't cover funding or release.
- [load-tests/config/options.js](../../load-tests/config/options.js) defines shared HTTP thresholds
  (`p(95)<500`, error rate `<1%`) that don't fit transactions that wait for ledger close (~5s).
- [.github/workflows/load-tests.yml](../../.github/workflows/load-tests.yml) runs nightly
  (`smoke` by default) and on manual dispatch, uploading results as artifacts.
- Sequence handling is documented in
  [docs/SOROBAN_SEQUENCE_MANAGEMENT.md](../SOROBAN_SEQUENCE_MANAGEMENT.md).

### Proposed Implementation

**1. k6 scenarios for bounty creation, funding, release**
New `load-tests/scenarios/escrow-pipeline.test.js` with three named scenarios that can run alone
or together (`-e SCENARIO=create|fund|release|all`):

| Scenario | Executor | What one iteration does |
|----------|----------|-------------------------|
| `create_bounty` | `constant-arrival-rate` | `POST` a bounty via the API |
| `fund_escrow` | `ramping-arrival-rate` | Create + fund escrow, then poll until the tx is confirmed |
| `release_payout` | `per-vu-iterations` | Approve a funded bounty and poll until the payout tx is confirmed |

Custom metrics, building on the ones in `sequence-collision.test.js`:
- `tx_submit_to_confirm_ms` (Trend): submit → ledger inclusion
- `tx_failed{reason}` (Rate): tagged `tx_bad_seq`, `tx_insufficient_fee`, `timeout`, `rpc_429`
- `escrow_balance_mismatch` (Counter): on-chain balance ≠ expected after funding/release
- `txs_confirmed` (Counter): for throughput (tx/s)

Confirmation polling goes through the app's status endpoint, or Soroban RPC `getTransaction`, so
the test measures the real pipeline.

**2. Testnet with funded accounts (friendbot)**
- `load-tests/helpers/accounts.js` + a k6 `setup()` that creates N client keypairs and funds each
  via `https://friendbot.stellar.org?addr=…`, retrying with backoff (friendbot is rate limited).
- For larger runs, fund a pool once and reuse it from a gitignored `load-tests/.accounts.json`, or
  fund children from one friendbot-funded parent with `createAccount` ops.
- Target testnet contracts deployed by
  [deploy-contracts.yml](../../.github/workflows/deploy-contracts.yml). Pass contract IDs in as
  `-e ESCROW_CONTRACT_ID=…`.
- Guard: refuse to run unless the network passphrase is `Test SDF Network ; September 2015`.

**3. Budgets**
Add `escrowPipelineThresholds` to `load-tests/config/options.js`. Starting values, to be
revisited after the first baseline run:

| Metric | Budget |
|--------|--------|
| `tx_submit_to_confirm_ms` | `p(95)<15000`, `p(99)<30000` |
| `tx_failed{reason:tx_bad_seq}` | `rate<0.001` |
| `tx_failed` (all) | `rate<0.02` |
| `escrow_balance_mismatch` | `count==0` |
| throughput | ≥ 20 tx/s sustained for 5 minutes (matches #838) |
| API `http_req_duration` (non-tx endpoints) | `p(95)<500` |

A breached threshold fails the k6 run (non-zero exit code).

**4. Reports**
- `handleSummary()` writes `summary.json` and an HTML report (`k6-reporter`) to `load-tests/results/`.
- The workflow uploads both as artifacts and posts a short markdown table (p95 confirm time,
  tx/s, failures by reason) to the job summary (`$GITHUB_STEP_SUMMARY`).
- Add `escrow-pipeline` to the `test` input choices in `load-tests.yml`. Run it weekly on a
  schedule, not nightly, to stay within friendbot and testnet limits.

### Files Involved
- `load-tests/scenarios/escrow-pipeline.test.js` (new)
- `load-tests/helpers/accounts.js` (new): friendbot funding and account pool
- [load-tests/config/options.js](../../load-tests/config/options.js): escrow pipeline thresholds
- [load-tests/sequence-collision.test.js](../../load-tests/sequence-collision.test.js): reuse metrics/patterns
- [.github/workflows/load-tests.yml](../../.github/workflows/load-tests.yml): new test option, schedule, summary
- [load-tests/README.md](../../load-tests/README.md): how to run, budgets, how to read the report

### Action Items
- [ ] k6 scenarios for bounty creation, funding, release
- [ ] Testnet with funded accounts (friendbot)
- [ ] Budgets
- [ ] Reports
- [ ] Update docs / README where behaviour changes
- [ ] Add or update tests (see test plan)

### Test Plan
- [ ] `k6 run -e SCENARIO=fund --vus 1 --iterations 1` succeeds against testnet and the funded
      escrow balance is visible on-chain (stellar.expert / RPC)
- [ ] `setup()` funds the account pool and survives friendbot 429s via retry
- [ ] Full `all` run produces `summary.json`, an HTML report and a job summary table
- [ ] Forcing contention (single source account, high arrival rate) makes the `tx_bad_seq`
      threshold fail. This proves the budget is wired up
- [ ] Running with a mainnet passphrase aborts before any transaction is sent

### Running locally (for load-tests/README.md)
```bash
k6 run load-tests/scenarios/escrow-pipeline.test.js \
  -e BASE_URL=https://staging.example.com \
  -e ESCROW_CONTRACT_ID=C... \
  -e SCENARIO=all
```
