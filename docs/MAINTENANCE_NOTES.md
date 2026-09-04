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

## `pnpm run build`'s TypeScript check: ~149 real errors remain after fixing the build-blockers

Fixed in this pass: `pnpm run build` used to fail before it could even bundle
(missing `stripe`/`ioredis`/`graphql` deps, a stale generated Prisma client,
a `tsconfig.json` with no `exclude` so the project-wide typecheck pulled in
`mobile/`'s React Native code, `backend/limit/`'s standalone sub-project, and
every `*.test.ts(x)` file — none of which are part of this app's own build).
Turbopack now reports "Compiled successfully" and the typecheck step is
correctly scoped to just this app's real code. What's left, `npx tsc --noEmit
-p tsconfig.json` reports ~149 errors, categorized (counts from `error TSxxxx`
codes at the time of writing — will drift):

- **Prisma schema/code drift (~50 errors, TS2339/TS2322/TS2353)**: real code
  references fields/models that don't exist in `prisma/schema.prisma` at all
  — confirmed by grepping the schema directly, not just a stale generated
  client. Two concrete examples: `app/admin/actions.ts` reads/writes a
  `suspendedAt` field on `User` (for a user-suspension admin action) that
  the `User` model doesn't have; `app/api/analytics/corridors/route.ts`
  queries `prisma.corridorPayment`, but no `CorridorPayment` model exists.
  These aren't just type errors — calling either at runtime would throw,
  since Prisma validates queries against the schema. Needs someone who
  knows the intended data model to add the missing fields/models and a
  migration, not a type-only fix.
- **`services/api/stellar/contract.ts` (4 errors)**: `ScVal`/`LedgerEntryData`
  conversion, a private `Account.sequence` access, `GetTransactionStatus`
  missing `PENDING`. Likely a `@stellar/stellar-sdk` version drift (the
  types this file was written against no longer match what's installed).
- **`backend/src/graphql/*` and `backend/src/router.ts`/`trpc-setup.ts`**:
  a tRPC + GraphQL server layer living under `backend/src/` (confusingly
  alongside the unrelated Rust workspace also called `backend/`) that's
  real and reachable from `app/api/trpc/[trpc]/route.ts` and
  `app/api/graphql/route.ts` — not dead code, has its own real type errors.
  Worth its own dedicated pass; not attempted here beyond confirming it's
  live code, not noise.
- **Missing `@types/ws`** (`app/api/collab/route.ts`, TS7016): add it as a
  dev dependency.
- **`error TS2737` (10, BigInt literals not available below ES2020)**:
  `tsconfig.json`'s `target` is `ES6` — likely wants bumping, but do that as
  its own change and re-verify the whole app against the new target rather
  than folding it into an unrelated fix.
- **The rest**: scattered `any`-typed callback parameters (`TS7006`),
  `Promise<ReadonlyRequestCookies>` used without `await` (Next 15+ made
  `cookies()` async - `app/admin/analytics/page.tsx`), and similar
  one-off issues — see a fresh `npx tsc --noEmit -p tsconfig.json` for the
  current exact list.

Also fixed as part of this: 6 GitHub Actions steps across `ci.yml`,
`cli-checks.yml`, and `deploy-mainnet.yml` pinned `pnpm/action-setup` to
`version: 8`, while this repo's lockfile is `lockfileVersion: '9.0'` (pnpm
9+) and `package.json`'s own `packageManager` field pins `pnpm@10.33.0` —
pnpm 8 cannot read a v9 lockfile at all. All 6 bumped to `version: 10`
(matching `nightly-tier-upgrade.yml`, which already had it right).

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

## mobile/: `npm install` cannot succeed as currently pinned (needs a dependency decision)

Verified directly by running `npm install` (and `npm install --legacy-peer-deps`) in
`mobile/`, not inferred from reading `package.json`. Two separate, stacked problems:

1. `expo: "~56.1.0"` requested a version that never existed on the npm registry (SDK 56
   only ever published through `56.0.21` before jumping to `57.0.0`) — this alone failed
   every install outright. **Already fixed** in this session, pinned to `~56.0.21`.
2. With that fixed, install still fails on a real peer-dependency conflict:
   `@shopify/react-native-skia@^1.3.0`'s peer range is `react-native ">=0.64 <0.78.0"`,
   but `mobile/package.json` pins `"react-native": "0.85.0"`. This is not a simple bump:
   - The latest skia (`2.11.2`) does support `react-native >=0.78`, but its own peers
     require `react-native-reanimated >=4.0.0` and a new `react-native-worklets >=0.7.0`
     peer that isn't declared at all today.
   - `mobile/package.json` currently pins `react-native-reanimated: "~3.10.0"` — a major
     version behind what skia 2.x needs — and reanimated 3→4 is itself a breaking
     upgrade (new worklets architecture) that can affect `react-native-gesture-handler`
     compatibility too.
   - Skia is genuinely used for real features, not vestigially: `src/components/FinancialChart.tsx`,
     `src/canvas/skia-renderer.ts`, and `src/canvas/CollaborativeCanvas.tsx`. A 1.x→2.x
     bump has real API surface changes worth checking against those three files, not a
     drop-in version-number edit.

This needs someone to actually pick a target `react-native`/`expo`/skia/reanimated
combination and verify the three skia call sites against it (there's no toolchain in
this environment to build/run the RN app end-to-end to verify blind). Left undone here
rather than forcing a major dependency bump without being able to verify it.
