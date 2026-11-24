/**
 * Escrow Events → DB Projection (#1736)
 *
 * Single source of truth for escrow state: on-chain events win over optimistic
 * API writes. Each handler is an idempotent upsert keyed on `event_id` so it is
 * safe to replay events on restart or after a reorg rollback without producing
 * duplicate rows or incorrect state transitions.
 *
 * Reorg safety: the indexer (backend/services/indexer) stores a `ledger` column
 * on every row. When a reorg is detected the indexer deletes rows for affected
 * ledgers and re-indexes from the rolled-back cursor. The upserts below
 * preserve `event_id` uniqueness so a re-indexed event cleanly overwrites any
 * stale optimistic row rather than inserting a duplicate.
 *
 * Priority rule: event-driven writes always advance state; they never move a
 * terminal state (released/refunded) back to an earlier one. The
 * `NOT (status IN ('released','refunded'))` guards in the UPDATE clauses encode
 * this directly in SQL so no application-level read-modify-write is needed.
 */

import { prisma } from '@/lib/prisma';

// ── Event payload shapes ───────────────────────────────────────────────────────

export interface EscrowDepositedEvent {
  event_id: string;
  ledger: number;
  chain_escrow_id: number;
  payer: string;
  payee: string;
  amount: bigint;
  token: string;
}

export interface EscrowReleasedEvent {
  event_id: string;
  ledger: number;
  chain_escrow_id: number;
}

export interface EscrowRefundedEvent {
  event_id: string;
  ledger: number;
  chain_escrow_id: number;
}

export type EscrowContractEvent =
  | ({ type: 'escrow_deposited' } & EscrowDepositedEvent)
  | ({ type: 'escrow_released' } & EscrowReleasedEvent)
  | ({ type: 'escrow_refunded' } & EscrowRefundedEvent);

// ── Projection helpers ─────────────────────────────────────────────────────────

/**
 * Upsert an escrow row from an `escrow_deposited` event.
 *
 * ON CONFLICT on `chain_escrow_id` updates payer/payee/amount/token and resets
 * status to 'active' — this handles the case where an optimistic API write
 * created the row with potentially wrong values before the event arrived.
 *
 * The `event_id` column carries the last-indexed event so the caller can tell
 * whether a row reflects on-chain truth or is still optimistic.
 */
async function applyDeposited(ev: EscrowDepositedEvent): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "Escrow"
      (id, "chainEscrowId", payer, payee, amount, token, status, ledger, "eventId", "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid(),
      ${ev.chain_escrow_id},
      ${ev.payer},
      ${ev.payee},
      ${ev.amount},
      ${ev.token},
      'active',
      ${ev.ledger},
      ${ev.event_id},
      NOW(),
      NOW()
    )
    ON CONFLICT ("chainEscrowId") DO UPDATE SET
      payer      = EXCLUDED.payer,
      payee      = EXCLUDED.payee,
      amount     = EXCLUDED.amount,
      token      = EXCLUDED.token,
      status     = 'active',
      ledger     = EXCLUDED.ledger,
      "eventId"  = EXCLUDED."eventId",
      "updatedAt" = NOW()
    WHERE "Escrow"."eventId" IS DISTINCT FROM EXCLUDED."eventId"
  `;
}

/**
 * Mark an escrow as released.
 *
 * The WHERE guard `NOT (status IN ('released','refunded'))` prevents a
 * replayed or out-of-order event from overwriting a terminal state.
 * `ON CONFLICT ("chainEscrowId") DO NOTHING` is a belt-and-suspenders guard
 * for the rare case where the row does not yet exist (indexer lag on deposit).
 */
async function applyReleased(ev: EscrowReleasedEvent): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Escrow"
    SET
      status      = 'released',
      "releasedAt" = NOW(),
      ledger      = ${ev.ledger},
      "eventId"   = ${ev.event_id},
      "updatedAt" = NOW()
    WHERE "chainEscrowId" = ${ev.chain_escrow_id}
      AND status NOT IN ('released', 'refunded')
  `;
}

/**
 * Mark an escrow as refunded. Same terminal-state guard as applyReleased.
 */
async function applyRefunded(ev: EscrowRefundedEvent): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Escrow"
    SET
      status       = 'refunded',
      "refundedAt" = NOW(),
      ledger       = ${ev.ledger},
      "eventId"    = ${ev.event_id},
      "updatedAt"  = NOW()
    WHERE "chainEscrowId" = ${ev.chain_escrow_id}
      AND status NOT IN ('released', 'refunded')
  `;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Project a single on-chain escrow event into the application DB.
 *
 * All writes are idempotent: calling this multiple times with the same event
 * (e.g. after a crash-recovery replay) produces exactly the same DB state as
 * calling it once.
 *
 * @throws if the event type is unrecognised (programming error, not a runtime
 *         condition — unknown events should be filtered before reaching here).
 */
export async function projectEscrowEvent(event: EscrowContractEvent): Promise<void> {
  switch (event.type) {
    case 'escrow_deposited':
      await applyDeposited(event);
      break;
    case 'escrow_released':
      await applyReleased(event);
      break;
    case 'escrow_refunded':
      await applyRefunded(event);
      break;
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unknown escrow event type: ${(_exhaustive as { type: string }).type}`);
    }
  }
}

/**
 * Batch projection — applies each event in order and collects any errors
 * without aborting the whole batch. Errors are returned to the caller so the
 * indexer can log them and decide whether to retry.
 */
export async function projectEscrowEvents(
  events: EscrowContractEvent[],
): Promise<{ event_id: string; error: string }[]> {
  const failures: { event_id: string; error: string }[] = [];
  for (const event of events) {
    try {
      await projectEscrowEvent(event);
    } catch (err) {
      failures.push({
        event_id: event.event_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return failures;
}
