# 📌 Issue Preview: E2E tests: full bounty lifecycle with real contracts on a local network

**Labels:** `testing`, `e2e`, `contracts`, `ci`

**Issue:** #1795

---

### Description
The Playwright suite mocks every blockchain interaction. The bounty lifecycle test passes even
if the UI, the API and the Soroban contracts disagree about how escrow works, so integration
bugs (wrong contract arguments, XDR encoding, fee/sequence handling, event indexing) only
surface on testnet or in production.

### Current Behavior (as found in code)
- [e2e/bounty-lifecycle.spec.ts](../../e2e/bounty-lifecycle.spec.ts) covers the full loop
  (create → apply → assign/escrow → submit → approve → payment) but its header says the payment
  step is a *"mocked boundary"*:
  - `**/api/auth/session` is stubbed with fake client/creator sessions
  - `**/api/escrow/**` and `**/api/bounties/*` are fulfilled by `page.route` handlers, so no
    request reaches the real API or a chain
- [docker-compose.test.yml](../../docker-compose.test.yml) only starts `postgres-test`. There is no
  Stellar node, Soroban RPC, or contract deployment.
- [playwright.config.ts](../../playwright.config.ts) has no global setup that provisions
  accounts or contracts.
- Contracts live in [contracts/](../../contracts) (`escrow`, `vault`, `core`, …) and are deployed
  to testnet only by [deploy-contracts.yml](../../.github/workflows/deploy-contracts.yml).

### Proposed Implementation

**1. Local network in compose**
Add a `stellar` service to `docker-compose.test.yml`:
```yaml
  stellar:
    image: stellar/quickstart:<pinned-tag>
    command: --local --enable-soroban-rpc
    ports:
      - "8000:8000"   # Horizon + Soroban RPC + friendbot
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8000/ > /dev/null"]
      interval: 5s
      retries: 30
```
Local network passphrase: `Standalone Network ; February 2017`. Bring up the app and Rust API
against it (`STELLAR_RPC_URL=http://stellar:8000/soroban/rpc`, `STELLAR_NETWORK_PASSPHRASE=…`).

**2. Deploy contracts in test setup**
- New `e2e/setup/global-setup.ts`, wired via `globalSetup` in `playwright.config.ts`:
  1. Wait for the RPC health endpoint
  2. Create and friendbot-fund a deployer, a client and a creator account
  3. Build (`stellar contract build`) or reuse cached WASM from `contracts/`
  4. Deploy `escrow` (and any token/vault contracts it depends on) with `stellar contract deploy`
  5. Write contract IDs and account secrets to `e2e/.local-network.json` (gitignored) and export
     them as env vars for the app under test
- Teardown: `docker compose -f docker-compose.test.yml down -v`. The network is ephemeral.

**3. Playwright drives the full lifecycle with a test wallet**
- New spec `e2e/bounty-lifecycle.chain.spec.ts`. Keep the existing mocked spec as a fast check.
- Remove `page.route` mocks for `/api/escrow/**` and `/api/bounties/**`; keep only what can't run
  locally (e.g. third-party OAuth).
- Test wallet: inject a deterministic signer into the page (`page.addInitScript`) that implements
  the same interface the app expects from the wallet adapter and signs with the funded test
  keypairs. It must sign real transactions, not return canned responses.
- After each step, assert on chain state as well as the UI:
  - escrow funded: contract balance equals bounty amount
  - approval: creator balance increases by amount minus fees; escrow balance is zero
  - API/DB record matches the on-chain transaction hash

**4. CI job**
- New `e2e-chain` job in [ci.yml](../../.github/workflows/ci.yml) (or a separate workflow):
  `docker compose -f docker-compose.test.yml up -d --wait`, build contracts (with
  `Swatinem/rust-cache`), run `pnpm exec playwright test e2e/bounty-lifecycle.chain.spec.ts`.
- Upload the Playwright report plus `docker compose logs stellar` on failure.
- Start it on PRs touching `contracts/`, `app/api/escrow`, `app/api/payments`, `lib/` or `e2e/`,
  and nightly on `main`. Make it required once it's stable.

### Files Involved
- [docker-compose.test.yml](../../docker-compose.test.yml): add `stellar/quickstart` service
- [playwright.config.ts](../../playwright.config.ts): `globalSetup`/`globalTeardown`, chain project
- [e2e/bounty-lifecycle.spec.ts](../../e2e/bounty-lifecycle.spec.ts): reference for the flow
- `e2e/setup/global-setup.ts`, `e2e/fixtures/test-wallet.ts`, `e2e/bounty-lifecycle.chain.spec.ts` (new)
- [e2e/README.md](../../e2e/README.md): how to run against the local network
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml): `e2e-chain` job

### Action Items
- [ ] Spin up `stellar/quickstart` local network in compose
- [ ] Deploy contracts in test setup
- [ ] Playwright drives full lifecycle with a test wallet
- [ ] CI job
- [ ] Update docs / README where behaviour changes
- [ ] Add or update tests (see test plan)

### Test Plan
- [ ] `docker compose -f docker-compose.test.yml up -d --wait` brings up Postgres and the Stellar
      node healthy from a cold start
- [ ] Global setup deploys contracts and writes valid contract IDs, and re-running it is safe
- [ ] Chain spec passes locally and in CI, completing create → fund escrow → submit → approve →
      release with real transactions
- [ ] Deliberately breaking the escrow call (e.g. wrong amount scaling) makes the chain spec fail
      while the mocked spec still passes. This proves the new test catches what the old one misses
- [ ] Job runtime stays under ~10 minutes. Record the baseline in the PR

### Running locally (for e2e/README.md)
```bash
docker compose -f docker-compose.test.yml up -d --wait
pnpm exec playwright test e2e/bounty-lifecycle.chain.spec.ts
docker compose -f docker-compose.test.yml down -v
```
