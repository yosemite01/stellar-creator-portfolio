# Soroban Transaction Sequence-Number Management

Single canonical doc — replaces three previous, overlapping copies
(`docs/SOROBAN_NONCE_FIX_SUMMARY.md`, `docs/SOROBAN_SEQUENCE_MANAGEMENT_GUIDE.md`,
`docs/SOROBAN_SOLUTION_OVERVIEW.md`).

**Status, corrected from the previous docs**: the building blocks described
below exist and are unit-tested in isolation, but as of this writing
**nothing in the application actually calls them** — there is no
`contract-service-improved.ts` / `improvedContractService` (referenced
repeatedly by the old docs as "the drop-in replacement" — it does not exist
in this repo), and the v2 queue's own entry point
(`enqueueTransaction` in `transaction-queue-drainer.ts`) has no caller
anywhere else in the codebase, nor is the drainer started from any server
bootstrap (`instrumentation.ts` or equivalent doesn't exist here). The
previous docs' "✅ Complete and ready for deployment" / "100% success rate"
claims described the intended end state, not the current one. Whoever picks
this up next needs to (1) decide whether v1 or v2 is the one to finish
wiring in, and (2) actually call it from the real contract-invocation path.

## Problem

Under concurrent load, multiple requests against the same account can fetch
the same Soroban sequence number, so every submission but one fails with
"bad sequence number" — there's no shared coordination, retry, or queue.

## Two generations of the fix exist in `lib/soroban/`

### v1 — `sequence-manager.ts` + `transaction-queue.ts`

- **Distributed lock per account**, held while incrementing the sequence,
  with a 5s expiration to avoid a stuck lock deadlocking everything.
- **Per-account transaction queue**, processed sequentially, with automatic
  retry (default 3 attempts, backoff 100ms/500ms/2000ms/5000ms).
- Backing tables: `SequenceLock`, `TransactionQueue`, `SorobanTransaction`
  (audit trail) — added in
  [`prisma/migrations/20260530_add_soroban_sequence_management/`](../prisma/migrations/20260530_add_soroban_sequence_management/).
- The only real caller today is
  [`hooks/useRpcHealth.ts`](../hooks/useRpcHealth.ts), and only for
  `getRpcAttemptLog` (a logging/health-display helper) — not for actually
  submitting a transaction through the queue.

```typescript
const manager = getSequenceManager(accountId);
const sequence = await manager.getNextSequence(); // 1, 2, 3, ... guaranteed unique

const queue = getTransactionQueue(accountId);
const txId = await queue.enqueue(contractId, method, args);
const status = await queue.getStatus(txId);
```

### v2 — `sequence-manager-v2.ts` + `transaction-queue-drainer.ts` (Issue #838)

A later rewrite addressing v1's lock-contention cost:

- Uses `SELECT FOR UPDATE SKIP LOCKED` instead of blocking on the lock.
- Pre-fetches a **pool of 10 sequence numbers** per account, refilled
  asynchronously once fewer than 3 remain, instead of round-tripping the
  database on every single transaction.
- A **drainer** (`transaction-queue-drainer.ts`) runs on a 100ms interval
  per server process (not per-request), processing pending
  `TransactionQueue` rows in batches of up to 20, at a target throughput of
  20+ tx/second across all accounts. On a "bad sequence" error it releases
  the slot back to the pool and retries with the next one (up to 5 attempts).

```typescript
import { enqueueTransaction } from '@/lib/soroban/transaction-queue-drainer';

const id = await enqueueTransaction({
  accountId,
  contractId,
  method,
  args,
});
```

Neither `sequence-manager-v2.ts` nor `transaction-queue-drainer.ts` is
imported anywhere outside `lib/soroban/` itself.

## Database schema (both generations share it)

```sql
CREATE TABLE "SequenceLock" (
  "accountId" TEXT PRIMARY KEY,
  "lockedBy" TEXT,
  "lockedAt" TIMESTAMP,
  "expiresAt" TIMESTAMP,
  "sequence" BIGINT,
  "updatedAt" TIMESTAMP
);

CREATE TABLE "TransactionQueue" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT,
  "contractId" TEXT,
  "method" TEXT,
  "args" JSONB,
  "status" TEXT,
  "sequence" BIGINT,
  "txHash" TEXT,
  "error" TEXT,
  "attempts" INTEGER,
  "maxAttempts" INTEGER,
  "createdAt" TIMESTAMP,
  "submittedAt" TIMESTAMP,
  "confirmedAt" TIMESTAMP
);

CREATE TABLE "SorobanTransaction" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT,
  "contractId" TEXT,
  "method" TEXT,
  "sequence" BIGINT,
  "txHash" TEXT UNIQUE,
  "status" TEXT,
  "gasUsed" BIGINT,
  "result" JSONB,
  "error" TEXT,
  "submittedAt" TIMESTAMP,
  "confirmedAt" TIMESTAMP
);
```

## What's actually left to do

1. Pick v1 or v2 (v2 is the more scalable design and the more recently
   touched — see its Issue #838 header comment — but confirm nothing
   depends on v1's simpler semantics first).
2. Wire its entry point (`queue.enqueue(...)` or `enqueueTransaction(...)`)
   into the real contract-invocation path — wherever the app currently
   submits a Soroban transaction directly, without a queue or sequence
   coordination.
3. If using v2, start the drainer somewhere on server boot (there's
   currently no `instrumentation.ts` or equivalent bootstrap in this repo).
4. Add a load-test scenario that actually exercises concurrent submissions
   against one account — the current `load-tests/` k6 suite doesn't have one
   (see [`load-tests/README.md`](../load-tests/README.md)) — before trusting
   any success-rate/latency numbers for this feature.

## Troubleshooting (once wired up)

```sql
-- Stuck lock?
SELECT * FROM "SequenceLock" WHERE "expiresAt" < NOW();

-- Queue backlog?
SELECT COUNT(*) FROM "TransactionQueue" WHERE "status" = 'pending';

-- Slow confirmations?
SELECT * FROM "SorobanTransaction"
WHERE "confirmedAt" - "submittedAt" > interval '10 seconds';
```

## References

- [Soroban docs](https://developers.stellar.org/docs/learn/soroban)
- [Stellar transaction sequence numbers](https://developers.stellar.org/docs/learn/basics/transactions)
- [`js-stellar-sdk`](https://github.com/stellar/js-stellar-sdk)
