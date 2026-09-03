# PostgreSQL Row-Level Deadlock Prevention (Escrow)

This is the single canonical doc for the escrow deadlock fix — it replaces
four previous, heavily overlapping copies (`DEADLOCK_FIX_SUMMARY.md`,
`docs/DEADLOCK_PREVENTION_GUIDE.md`, `docs/DEADLOCK_QUICK_REFERENCE.md`, and
`docs/DEADLOCK_SOLUTION_OVERVIEW.md`), which repeated the same content at
four levels of verbosity with duplicated (and in places clearly invented,
e.g. round "before/after" latency numbers with no measurement source)
before/after tables.

## Problem

Multiple clients hitting the same creator's escrow row concurrently could
deadlock PostgreSQL, because of four compounding issues:

1. **Insufficient isolation** — the default `READ COMMITTED` level allows
   dirty reads and conflicting concurrent updates.
2. **Unordered lock acquisition** — one code path locked creator → escrow,
   another locked escrow → creator, producing a classic circular wait.
3. **No pessimistic locking** — nothing explicitly locked rows before
   modifying them, so races were possible in the first place.
4. **Missing indexes** — slow lookups meant locks were held longer than
   necessary, widening the collision window.

## Solution

- **`SERIALIZABLE` isolation** for escrow operations — detects conflicts and
  lets the caller retry, rather than allowing an inconsistent interleaving.
- **Strict lock ordering**, always: creator (payee) → client (payer) →
  escrow → balance. Circular waits are impossible if every caller acquires
  locks in the same order.
- **Pessimistic locking** via `SELECT ... FOR UPDATE` before modification.
- **Automatic retry with exponential backoff** (100ms, 200ms, 400ms) on a
  detected deadlock, transparent to the caller.

## Implementation

| File | Role |
|---|---|
| [`lib/db/transaction-manager.ts`](../lib/db/transaction-manager.ts) | Isolation-level configuration, deadlock detection, automatic retry with backoff, statement timeout |
| [`lib/db/pessimistic-lock.ts`](../lib/db/pessimistic-lock.ts) | Lock acquisition in the required order, lock modes (`EXCLUSIVE`, `SHARED`, `NOWAIT`, `SKIP_LOCKED`) |
| [`lib/escrow/escrow-transaction-handler.ts`](../lib/escrow/escrow-transaction-handler.ts) | `releaseEscrowFunds` / `refundEscrow` / `disputeEscrow`, each using the above with proper locking; also exposes `getDeadlockStats()` |
| [`prisma/migrations/20260530_add_escrow_deadlock_prevention/migration.sql`](../prisma/migrations/20260530_add_escrow_deadlock_prevention/migration.sql) | Indexes on frequently-locked columns, status/amount check constraints, audit timestamp columns, an optimistic-locking `version` column |

```typescript
await executeTransaction(
  async () => {
    // transaction body
  },
  { isolationLevel: IsolationLevel.SERIALIZABLE, maxRetries: 3 },
);
```

```typescript
await acquireLocksInOrder(
  [
    { type: 'creator', id: creatorId },
    { type: 'client', id: clientId },
    { type: 'escrow', id: escrowId },
    { type: 'balance', id: creatorId },
  ],
  LockMode.EXCLUSIVE,
);
```

## Usage

```typescript
import { releaseEscrowFunds, refundEscrow, disputeEscrow, getDeadlockStats } from '@/lib/escrow/escrow-transaction-handler';

const result = await releaseEscrowFunds(escrowId, creatorId, clientId);
if (result.success) {
  // result.escrow
} else {
  // result.error — deadlock retry already exhausted
}

// { totalDeadlocks, recentDeadlocks, deadlockRate }
const stats = getDeadlockStats();
```

`refundEscrow(escrowId, creatorId, clientId)` and
`disputeEscrow(escrowId, creatorId, clientId, reason)` follow the same
`{ success, escrow?, error? }` shape.

## Deployment

```bash
npx prisma migrate deploy   # indexes, constraints, audit columns
```

No breaking changes: `releaseEscrowFunds`/`refundEscrow`/`disputeEscrow`
already existed as the entry points into escrow mutation; this only changes
their internal locking/isolation behavior.

## Troubleshooting

**Still seeing deadlocks?**
```sql
SHOW transaction_isolation;                 -- expect: serializable
SELECT * FROM pg_locks WHERE NOT granted;   -- inspect waiting locks
```
Then re-check that every call path into escrow mutation goes through
`escrow-transaction-handler.ts` rather than a direct Prisma call — a direct
`prisma.escrow.update(...)` bypasses both the isolation level and the lock
ordering.

**Slow transactions?**
```sql
EXPLAIN ANALYZE SELECT * FROM "Escrow" WHERE "creatorId" = $1;
SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0;  -- unused indexes
```

**High retry rate?** Increase `retryDelay` in `executeTransaction`'s options,
or investigate whether load on a single hot account needs its own queueing
ahead of the database layer.

## Monitoring

Alert on:
- Deadlock rate > 1/hour (`getDeadlockStats().deadlockRate`)
- Retry rate > 5%
- P99 lock wait time > 1s
- Any single transaction running > 5s (`pg_stat_activity`, `query_start`)

```sql
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE (now() - query_start) > interval '5 minutes';
```

## Operations

### Deployment phases

1. **Database**: back up first (`pg_dump $DATABASE_URL > backup.sql`), then
   `npx prisma migrate deploy`. The migration is additive (indexes,
   constraints, audit columns) and safe to leave in place even if the code
   change is later reverted.
2. **Code**: route escrow release/refund/dispute through
   `escrow-transaction-handler.ts` rather than direct `prisma.escrow.update()`
   calls.
3. **Testing**: `npm test` (unit) and `npm run test:e2e` (Playwright) are
   this repo's actual test commands — there is no dedicated
   `test:deadlock-rate`/`test:load` script. Verifying deadlock behavior
   specifically under concurrent load needs a scenario written for it (the
   existing [`load-tests/`](../load-tests/) k6 suite does not currently
   include one — see its README for what it does cover).
4. **Monitoring**: wire `getDeadlockStats()` into whatever
   alerting/monitoring this deployment uses.

### Rollback

The code path can be reverted independently of the migration — the schema
changes (indexes, constraints, audit columns) are backward-compatible and
safe to leave in place even if the transaction-handler code is rolled back.
Watch the deadlock rate return to its pre-revert baseline as confirmation.

### If the deadlock rate spikes in production

1. `SELECT * FROM pg_locks WHERE NOT granted;` — find who's waiting on what.
2. `SELECT * FROM pg_stat_activity WHERE state = 'active';` — find
   long-running transactions holding locks.
3. Confirm every escrow mutation path actually goes through
   `escrow-transaction-handler.ts` (a direct Prisma call anywhere bypasses
   both the isolation level and the lock ordering this doc depends on).

## Reference

- [PostgreSQL isolation levels](https://www.postgresql.org/docs/current/transaction-iso.html)
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Prisma transactions](https://www.prisma.io/docs/concepts/components/prisma-client/transactions)
