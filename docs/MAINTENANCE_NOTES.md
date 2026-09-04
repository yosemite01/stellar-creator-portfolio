# Maintenance Notes: Dependency, Tooling & Wiring Drift

Notes on the current state for a few open maintenance chores, so whoever picks up the
code change doesn't have to re-derive this context. These are notes only — none of the
items below have been implemented here.

## zod minor bump (issue #1194)

- Currently pinned in [package.json](../package.json) at `"zod": "^3.24.1"`.
- The caret range already allows minor/patch updates on `pnpm install` — the
  `package-lock.json` / `pnpm-lock.yaml` entry is what's actually behind, not the
  `package.json` range itself. Bumping means running the install and committing the
  updated lockfile, then confirming the `package.json` range still covers the resolved
  version (or bumping it explicitly if going to a new minor floor).
- Before bumping: skim the zod changelog between the currently-locked version and the
  target for anything touching `.safeParse`/error formatting, since those are the most
  commonly relied-on APIs in this repo's validators.

## .nvmrc (issue #1196)

- No `.nvmrc` exists at the repo root today.
- [.github/workflows/cli-checks.yml](../.github/workflows/cli-checks.yml) pins CI to
  `node-version: 20` via `actions/setup-node`. That's the version an `.nvmrc` should
  match, so `nvm use` locally lines up with what CI actually runs.
- [CONTRIBUTING.md](../CONTRIBUTING.md) currently documents the prerequisite loosely as
  "Node.js 18+ or 20+" — once an `.nvmrc` pins a single version, that line should be
  tightened to match rather than left as a range.

## Pin Node in the deploy script (issue #1195)

- The actual gap is in
  [.github/workflows/deploy-mainnet.yml](../.github/workflows/deploy-mainnet.yml): the
  `simulate-contracts` and `deploy-contracts` jobs both invoke `node scripts/deploy.js`
  directly (`--simulate-only` and full run, respectively) with **no `actions/setup-node`
  step at all** — Node comes from whatever `ubuntu-latest` ships with that day. The
  `deploy-frontend` job in the same workflow, by contrast, already pins
  `node-version: '20'` via `actions/setup-node@v6`. So the fix is adding an equivalent
  `actions/setup-node` step (pinned to Node 20, matching `deploy-frontend` and
  `cli-checks.yml`) to `simulate-contracts` and `deploy-contracts`.
- Related drift spotted while looking at this: `.github/workflows/nightly-tier-upgrade.yml`
  pins `node-version: '22'`, out of step with every other workflow in the repo (20). Not
  in scope for #1195, but worth a separate ticket — it means the "one Node version"
  story isn't fully true yet even after #1195/#1196 land.

## backend/limit's test:unit / test:integration / test:e2e / test:security scripts are broken

- [`backend/limit/package.json`](../backend/limit/package.json) declares
  `test:unit`, `test:integration`, `test:e2e`, and `test:security`, each
  pointing at `tests/<suite>/runner.ts`. None of those per-suite runner
  files exist — only the combined `tests/runner.ts` does (which is what
  plain `npm test` in that directory runs, and it works).
- Fix is either: add the four missing runner files, or simplify the four
  broken scripts down to just re-running `tests/runner.ts` (possibly with
  a suite-name filter argument) so the documented commands actually work.

## `cargo check --workspace` / `cargo test --workspace --all-features` currently fail outright

- Reproduced directly: `cd backend && cargo check --workspace` (with or
  without `--all-features`) fails with `error[E0277]: the trait bound
  'ChaCha20Rng: ed25519_dalek::rand_core::CryptoRng' is not satisfied` inside
  `soroban-env-host-23.0.1/src/builtin_contracts/testutils.rs`, which pulls
  in three different `rand_core` majors (0.6.4, 0.9.5, 0.10.1) and two
  `ed25519-dalek` majors (2.2.0, 3.0.0) across the resolved dependency
  graph (see `Cargo.lock`) — an upstream version conflict inside
  `soroban-env-host` itself, not something introduced by this repo's own
  code or Cargo.toml.
- **This means `.github/workflows/ci.yml`'s `backend` and `contracts` jobs
  (both running `cargo test --workspace --all-features`) cannot currently
  pass on `main`.** Worth confirming against actual recent CI run history —
  if they've been red, that's a live "tests don't gate merges" problem,
  independent of anything else in this file.
- **Individual contract packages are unaffected**: `cargo check --package
  stellar-bounty-contract` (and, by extension, whatever `stellar contract
  build --package <name>` does under the hood) compiles clean — the
  conflict only surfaces when Cargo unifies features/deps across the whole
  workspace at once. So the contract deploy pipeline's actual build step is
  probably fine; it's specifically the test-running CI jobs that are stuck.
- Fix needs someone to actually pin a compatible `soroban-env-host`/
  `ed25519-dalek`/`rand_core` combination (possibly via `[patch.crates-io]`
  in `backend/Cargo.toml`, or by checking whether a newer/older
  `soroban-sdk` patch release resolves the conflict) and confirm
  `cargo test --workspace --all-features` actually passes end to end —
  not attempted here since it needs real iteration against the dependency
  graph, not a one-line change.

## backend/services/notifications/push-route.ts isn't mounted anywhere

- The file exists and is a complete Next.js route handler (`POST`/`PUT`/`GET`
  for `/api/notifications/push`), but it sits in
  `backend/services/notifications/`, not under `app/api/`. Next.js App
  Router only serves a route from a file literally at
  `app/api/<path>/route.ts`, so this endpoint does not currently exist in
  the running app.
- Fix: move it to `app/api/notifications/push/route.ts` (or re-export it
  from a thin file there), then verify the curl examples in
  `backend/services/notifications/README.md` actually work.
