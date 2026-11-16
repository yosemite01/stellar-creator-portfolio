# #1573: Reconcile on-chain escrow state with the database

## Context
The Soroban escrow contract ([backend/contracts/escrow/src/lib.rs](../../backend/contracts/escrow/src/lib.rs))
holds funds with statuses `Active | Released | Refunded | Disputed | Complete`. The
database copy is the Prisma `Escrow` model
([schema.prisma:579](../../prisma/schema.prisma#L579)). Nothing currently compares the
two, and several gaps block a straightforward comparison:

1. **No link between rows.** `Escrow` has no on-chain escrow ID, and its `id` is a cuid.
   The contract exposes `get_escrow(escrow_id: u64)` and
   `get_escrow_id_for_bounty(bounty_id: u64)`.
2. **The indexer never matches escrow events.** The contract publishes two-part topics
   such as `("escrow", "deposited")` and `("escrow", "released")`. The indexer's
   `topic_name` takes only the first topic
   ([indexer main.rs:384](../../backend/services/indexer/src/main.rs#L384)) and compares it
   with `escrow_deposited`, `escrow_released` and `escrow_refunded`
   ([L398](../../backend/services/indexer/src/main.rs#L398)). Those never match, so
   `chain_escrows` stays empty. The indexer also ignores `disputed`, `resolved`,
   `auto_res`, `ms_rel` and `complete`.
3. **tRPC `escrow.create/release` are mocks** ([server/api/router.ts:283](../../server/api/router.ts#L283)),
   so no production flow writes a contract escrow ID anywhere yet.

## Why it matters
If a contract call succeeds but the DB write fails, or the reverse, users see wrong
balances and funds can sit in `Active` on-chain unnoticed. A periodic comparison is the
safety net.

## Suggested approach
**Prerequisites** (can be separate PRs):
- Add `chainEscrowId BigInt? @unique` to `Escrow` and populate it wherever a deposit is
  submitted.
- Fix the indexer topic matching: join the topics, or match on `(topic[0], topic[1])`.
  Then handle the remaining escrow events. Add a unit test next to
  `topic_name_returns_first_element`.

**Job:**
- **Runner:** `POST /api/admin/cron/escrow-reconcile`, authorized exactly like
  [dispute-deadlines](../../app/api/admin/cron/dispute-deadlines/route.ts): either an
  `X-Cron-Secret` matching `CRON_SECRET` (compared with `timingSafeEqual`) or an ADMIN
  session. It runs every 15 minutes.
- **Logic** lives in `lib/escrow/reconciliation.ts`, with an injected
  `ChainEscrowReader { getEscrow(id: bigint) }` so tests can mock the contract.
- **Chain truth:** call `get_escrow` through Soroban RPC `simulateTransaction`, which is
  read-only and costs no fee. Do not compare against `chain_escrows`: it is our own
  derived copy and would hide indexer bugs.
- **Scope:** escrows with `chainEscrowId` set whose DB status is not terminal, plus
  terminal escrows updated in the last 24 h.
- **Compare** status, amount and parties. Concurrency is limited to about 5 RPC calls,
  each with a timeout.

| DB status | Expected chain status |
| --- | --- |
| `active` | `Active` |
| `released` | `Released` or `Complete` |
| `refunded` | `Refunded` |
| `disputed` | `Disputed` |
| `settled_by_timeout` | `SettledByTimeout` |

- **Record drift** in an `EscrowDrift` table: `escrowId`, `kind`, `dbValue`,
  `chainValue`, `detectedAt`, `lastSeenAt`, `resolvedAt`, with `@@unique([escrowId, kind])`
  so that persistent drift updates one row instead of adding new ones.
  - Kinds: `STATUS_MISMATCH`, `AMOUNT_MISMATCH`, `PARTY_MISMATCH`, `MISSING_ON_CHAIN`,
    `CHAIN_READ_FAILED`.
  - `CHAIN_READ_FAILED` alerts only after 3 consecutive failures.
- **Alert** on new drift by logging at error level (escrow ID and kind only) and sending
  through the existing admin notification channel.
- **Admin report:** `GET /api/admin/escrow-drift` (ADMIN only) and a table in the admin
  dashboard.
- **Report only.** The job never repairs drift. Fixing it moves money and needs a human.

**Contract side:** no new entrypoints are required, since `get_escrow` already exists. If
the indexer fix changes how events are decoded, document the event topics and payloads in
`docs/contracts.md`.

## Test plan
- **Unit (mocked reader):**
  - DB `released` with chain `Active` → `STATUS_MISMATCH`.
  - Amounts that differ → `AMOUNT_MISMATCH`.
  - Matching state → no drift.
  - Repeated drift → one row, with `lastSeenAt` updated.
  - Recovered state → `resolvedAt` set.
  - Reader throws → `CHAIN_READ_FAILED`.
- **Integration:** the cron route without a secret → 401, with the secret → returns a
  `{ checked, drifted }` summary. The admin report as a non-admin → 403.
- **Indexer:** `cargo test -p stellar-indexer` covers the new topic matching, and `cargo clippy -- -D warnings` passes.

## Acceptance criteria
- [ ] Drift is detected in a test with a mocked contract
- [ ] The admin report lists unresolved drift
- [ ] `.env.example` documents `CRON_SECRET`, `SOROBAN_RPC_URL` and `ESCROW_CONTRACT_ID`
- [ ] CI is green (lint, type-check, tests, cargo)

## Deferred
- Automatic repair.
- Reconciling Stripe escrows (`escrow-service.ts`) against Stripe PaymentIntents.
