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

## backend/limit: test scripts fixed (October 2026)

`npm test` and `npm run test:unit` / `test:integration` / `test:e2e` /
`test:security` all run, and all 51 cases pass. Before, none could start: the
runner imported its suites from the wrong directory, the per-suite scripts
pointed at runner files that never existed, and the package had 15 type errors.
Fixing them also surfaced real bugs, now fixed: input validation rejected every
array field, Redis-backed limiting sent sorted-set members under the wrong key,
`blockDurationMs: 0` could not disable blocking, and the unit runner reported
every async test as failed without running its assertions.

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

## Web app health: typecheck, tests, lint and build (resolved October 2026)

`pnpm run typecheck`, `pnpm test`, `pnpm run lint` and `pnpm run build` all pass,
and CI's frontend job now runs the typecheck and the unit tests as well as lint and
build. Previously two botched merges hid ~150 type errors (tsc stops at syntax
errors), 37 vitest files failed, ESLint reported ~3,400 errors and the production
build failed on unresolved modules. Notable fixes behind that:

- Prisma schema drift: `User.suspendedAt`/`suspensionReason` and `CorridorPayment`
  now match their migrations; `Balance.userId` is unique and `Transaction.status`
  exists (see the escrow section below).
- The tRPC `creators` endpoints query `CreatorProfile` (there is no `Creator`
  model) and no longer return `Math.random()` placeholder stats; the rate limiter
  the router imported is implemented; GraphQL builds its schema once and enforces
  the context's rate-limit decision for every caller.
- Missing modules were written rather than stubbed: SEP-24 payment validation,
  S3 object storage and `POST /api/upload`, and the signature-verified Stripe
  webhook at `/api/webhooks/stripe`.
- Library upgrades: framer-motion 12 (React 19 types), react-resizable-panels 4,
  Freighter API 6, react-day-picker 10 class names, React Query v5 `isPending`.
- The JWT fallback secret `'dev-secret-key'` is gone; tokens fail closed when
  `JWT_SECRET` is unset.

## server/services/notifications/push-route.ts is deliberately not mounted

- These push handlers (`POST`/`PUT`/`PATCH`/`GET`) now live beside the push service
  in `server/services/notifications/`. They must not be routed yet:
  `validateRequest()` only checks that an `Authorization: Bearer …` header is
  present without verifying it, so mounting them would let anyone send
  notifications to any user. `PATCH` has no auth at all and expects an `[id]`
  route param.
- Fix: verify the token (session or signed service token), scope `PATCH` to the
  notification's owner, then add `app/api/notifications/push/route.ts`.

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

## mobile/: login flow doesn't yet issue a real session

`app/(auth)/login.tsx` now mounts `src/screens/AuthFlowNavigator.tsx` (previously
unreachable — see the commit "create the missing /(auth)/login route"), so the
onboarding → register → login UI actually renders instead of hitting Expo Router's
unmatched-route error. But its `onAuthComplete(publicKey)` callback only navigates to
`ROUTES.APP.HOME` for the current session — it deliberately does not call
`useAuthStore().setUser()`.

- `setUser(user: User, token: string)` needs a real `User` record (id, email) and a
  session token the rest of the app can use for authenticated calls. Neither exists
  yet: `src/hooks/useGoogleAuth.ts`'s own doc comment says the Google auth path
  "isn't yet a session token the rest of the app can use," and the wallet-connect flow
  it replaced never issued one either.
- Net effect: a user can reach the app for one session by completing the flow, but
  `isAuthenticated` never actually flips to `true` in the persisted store, so
  restarting the app correctly bounces back to `/(auth)/login` rather than staying
  signed in. This is honest given the current state (no fake session persisted) but
  is obviously not a finished login experience.
- Fix needs backend work first: a real endpoint that exchanges the Google ID token (or
  wallet signature) for an actual `{ user, token }` pair, then `login.tsx`'s
  `handleAuthComplete` should call `useAuthStore().setUser(user, token)` with that
  real data before navigating home.

## mobile/src/messaging/: doesn't compile against the installed libsignal-client

Verified directly against `node_modules/@signalapp/libsignal-client@0.69.1`'s own
`.d.ts` files (the version actually declared and installed - not a version-pin
mismatch). `key-store.ts` and `signal-session.ts` are written against an API that
doesn't exist in this version:

- `PrivateKey` has no `.generateKeyPair()` method. The real pattern is
  `PrivateKey.generate()` (produces a private key) + `.getPublicKey()` (derives the
  matching public key) - there's no combined "keypair" object. Two call sites use the
  fictional method: the signed-prekey generation just fixed in this session (now
  correct in *logic*, still needs the real generate()/getPublicKey() calls swapped in)
  and `generateOneTimePreKeys`'s `PrivateKey.generate().generateKeyPair()`.
- `IdentityKeyPair` and `generateRegistrationId` are used as `IdentityKeyPair.new(...)`
  and a free function respectively; the real API is `new IdentityKeyPair(pub, priv)`,
  and there's no exported `generateRegistrationId` at all in this version - needs a
  real replacement (Signal's registration ID is just a random 14-bit-ish integer;
  check what `processPreKeyBundle`/`PreKeyBundle.new` actually expect it to range over
  before picking a generator).
- `PublicKey.deserialize`/`PrivateKey.deserialize` etc. take `Buffer`, not
  `Uint8Array` - every `fromb64()` call site needs wrapping.
- `SessionStore`/`PreKeyStore`/`SignedPreKeyStore`/`IdentityKeyStore` are `abstract
  class`es meant to be `extend`ed, not interfaces to `implement` - mechanical fix,
  method signatures already match almost exactly (`isTrustedIdentity` needs a third
  `direction: Direction` parameter the current code doesn't pass).
- `signalDecrypt`/`signalDecryptPreKey` take a parsed `SignalMessage`/
  `PreKeySignalMessage` object, not a raw `Buffer`/`Uint8Array` - needs
  `SignalMessage.deserialize(buf)` first. `signalDecryptPreKey` also takes a 7th
  argument (`kyberPrekeyStore`) this code never provides.

Bigger finding, not just an API-version fix: **the library already implements real
sealed sender** - `sealedSenderEncrypt`/`sealedSenderEncryptMessage`,
`sealedSenderDecryptMessage`/`sealedSenderDecryptToUsmc`, backed by a proper
`SenderCertificate`/`UnidentifiedSenderMessageContent` system designed exactly to
solve "how does the recipient learn who really sent this without the transport layer
seeing it." `signal-session.ts`'s `encryptSealedSender`/`decryptSealedSender` instead
hand-roll a scheme (concatenate identity key + ciphertext, self-sign the envelope) that
this session patched for a real address-collision bug but did not replace. The
hand-rolled scheme also has no path to a trusted `SenderCertificate` issuer, so even
once wired up it can't offer the same guarantees the library's real mechanism does.
Recommend replacing `encryptSealedSender`/`decryptSealedSender` with the library's own
functions rather than continuing to patch the ad-hoc one - that needs a
certificate-issuing piece on the server side first, which doesn't exist yet either.

Given this needs careful, verified work on security-sensitive crypto glue - not
something to guess through in the same pass as other fixes - left as a scoped-out
finding rather than attempting a full rewrite here.

## mobile/src/ota/: OTA update system is unreachable dead code, and must stay that way until fixed

Confirmed by grepping the whole app for imports of `ota-client.ts`/`rollback.ts` -
nothing references either file. That's the only thing currently preventing a serious
security issue from being live.

`ota-client.ts` decrypts downloaded patches with an AES-256-GCM key read from
`EXPO_PUBLIC_OTA_AES_KEY`. `EXPO_PUBLIC_*` variables are inlined into the client
bundle at build time by design - every installed copy of the app ships the same key.
That means:

- Anyone who extracts the key from one installed client can decrypt any patch - but
  more importantly, they can **encrypt their own arbitrary patch with the same key**,
  and AES-GCM's auth tag will verify it as validly as a real one, since "encrypted
  with this key" no longer implies "came from the real OTA server" once the key is in
  every client.
- The only other check, comparing the patched bundle's SHA-256 against
  `manifest.sha256`, is circular - that field comes from the same unauthenticated
  `fetch(MANIFEST_URL)` response as the patch itself. Whoever controls or can spoof
  that endpoint controls both the payload and the value that's supposed to verify it.
- Net effect if this were ever wired up: extracting the shared key from any installed
  build, or spoofing/MITMing the manifest endpoint, lets an attacker push arbitrary
  executable JS to every device that polls for updates. This is a remote-code-execution
  path against the whole install base, not a data-integrity nitpick.

Added a prominent warning comment directly in `ota-client.ts` (top of file) so nobody
wires this up believing "AES-256-GCM" and "SHA-256 verified" mean it's already safe.

A real fix needs **asymmetric** signing: the manifest signed server-side with a
private key that never leaves the server, verified client-side against a public key
embedded in the build (safe to embed - it can only verify, not sign or decrypt), with
the payload hash carried inside that signed manifest rather than treated as
trustworthy on its own. That's real backend signing infrastructure this repo doesn't
have yet. Given `expo-updates` / EAS Update already solves exactly this problem (with
an app-platform team's review behind the implementation), it's worth asking whether
this bespoke OTA + AES + hand-rolled bsdiff-in-TypeScript system (its own doc comment
admits the patch-apply function is "a stand-in for CI/test environments," not
production) should be replaced with it rather than fixed in place.

## load-tests/: four scenarios target API routes that don't exist

Verified by checking `app/api/` directly for each, not by running the load tests
(no environment here to point k6 at a live deployment):

- `referrals.test.js` hits `/api/referrals` (GET code/stats, POST track). No
  `app/api/referrals` route exists anywhere in the repo.
- `upload.test.js` hits `/api/upload` (GET list, POST upload). No `app/api/upload`
  route exists anywhere in the repo.
- `reviews.test.js` hits `GET /api/reviews?creatorId=` and `POST /api/reviews`. The
  only review route that actually exists is `POST /api/creators/reviews/batch`
  (fetches reviews for multiple creators at once, via `getReviewsForCreator` from
  `lib/services/review-service`) - there's no single-creator GET and, more
  significantly, **no review-submission route at all** anywhere in the app. Reviews
  can currently only ever be read in batch, never created through the API.
- `users.test.js` hits `GET /api/users` (list) and expects `{ data: [...] }`. There's
  no top-level `app/api/users` route - only `app/api/user/*` (singular, per-field
  sub-resources: `account`, `wallet-address`, `data-export`) and the unrelated,
  admin-scoped `app/api/admin/reports/users`.

Every request in these four scenarios will 404 against a real deployment. Added a
`KNOWN GAP` comment to the top of each file pointing back here, so running the full
load-test suite doesn't produce a wall of false-negative 404s that look like the app
is broken when it's actually the test target that's wrong (or, for reviews, that
points at a feature - review submission - that was never built).

Not rewritten to point at real routes here: for referrals and upload there's nothing
real to point at (no equivalent route exists under any path), and reviews/users would
need someone to decide what the intended real shape is (does "list users" even belong
as a public API, or should that test be deleted; should review creation be built, or
should this scenario be deleted too) rather than guessing a URL.

## lib/error-tracking.ts: Sentry is an optional integration

`@sentry/nextjs` is still not a dependency. The tracker now loads it lazily, only
when `NEXT_PUBLIC_SENTRY_DSN` is set, and logs a warning (instead of throwing) if the
package is missing, so builds and type-checking no longer depend on it. Turning
Sentry on for real still needs the package, its config files and a DSN — a product
decision, not a code fix.

## Transactional email queue is not built

`lib/email.ts`, `lib/email/index.ts` and `lib/email/bounty-notify.ts` were removed:
they re-exported a mailer module and an email-queue API (`submitQueuedEmail`,
`processEmailQueue`, unsubscribe tokens, per-category preferences) that were never
written, and nothing imported them. The Handlebars templates in
`lib/email/templates/` remain. Building the queue still needs decisions on its
persistence (`EmailDeliveryLog` looks intended), unsubscribe-token handling and the
category-to-`NotificationPreference` mapping.

## Escrow release/refund: schema fixed; migrations still incomplete

`Balance.userId` is now `@unique` and `Transaction` has a `status` column
(migrations `20261002_balance_user_unique` and `20261002_transaction_status`), so
`releaseEscrow`/`refundEscrow` produce valid queries. Remaining gap: no migration in
`prisma/migrations/` creates the `Balance` or `Transaction` tables in the first
place (the 20260530 migration only adds indexes to them), so a database built purely
from migrations still lacks them. Generate a baseline migration against a real
database (`prisma migrate diff --from-migrations … --to-schema-datamodel …`) before
relying on `prisma migrate deploy`.

