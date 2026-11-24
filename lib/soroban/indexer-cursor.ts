/**
 * Indexer Cursor — Durable Resumption + RPC Retention Gap Recovery (#1735)
 *
 * Problem
 * -------
 * Soroban RPC nodes retain only ~7 days of events (the `MAX_LEDGER_RETENTION`
 * window). If the indexer is down for longer than that window, the cursor it
 * resumes from is older than the earliest ledger the node can serve, causing:
 *   1. The RPC to return an error or empty result for the requested range.
 *   2. The DB to silently diverge from contract state.
 *
 * Solution
 * --------
 * On every startup (and on each poll cycle), the cursor manager:
 *   a) Reads the durable cursor from the DB (`indexer_cursors` table).
 *   b) Asks the RPC for `getLatestLedger` to learn the current tip.
 *   c) Computes the earliest ledger the node still has:
 *        earliest = latestLedger - RETENTION_LEDGER_WINDOW
 *   d) If `cursor < earliest`, the cursor has fallen behind the retention
 *      window. The manager advances it to `earliest`, logs a gap-event (so
 *      operators know state may have diverged), and returns the adjusted cursor.
 *   e) The indexer then re-indexes from `earliest`, catching up as far as the
 *      node allows, and kicks off any configured backfill source (e.g. an
 *      archive or Horizon history endpoint) to cover the gap separately.
 *
 * The DB cursor is always persisted atomically via ON CONFLICT upsert so a
 * crash mid-poll cannot leave a half-advanced cursor.
 *
 * Approximate ledger arithmetic
 * -----------------------------
 * Stellar closes ~1 ledger per 5 s.
 *   7 days ≈ 7 × 86400 / 5 = 120,960 ledgers
 * We use 110,000 as a conservative floor to stay inside the window.
 */

import { prisma } from '@/lib/prisma';
import { rpcCall } from '@/lib/config/rpc-fallback';
import type { NetworkName } from '@/lib/config/network';

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Approximate number of ledgers in 7 days at ~5 s per ledger.
 * Used to compute the earliest ledger the RPC node still has events for.
 * We shave ~10 k off the theoretical maximum to stay safely inside the window.
 */
export const RETENTION_LEDGER_WINDOW = 110_000;

/**
 * Key used in the `indexer_cursors` table for the main event-indexer cursor.
 */
export const CURSOR_KEY = 'main';

// ── RPC helpers ────────────────────────────────────────────────────────────────

interface LatestLedgerResult {
  sequence: number;
}

/**
 * Fetch the latest closed ledger sequence from the RPC node.
 * Returns `null` if the RPC is unreachable (caller decides how to handle).
 */
export async function fetchLatestLedger(network: NetworkName): Promise<number | null> {
  try {
    const result = await rpcCall<LatestLedgerResult>(network, 'getLatestLedger', []);
    return result.data?.sequence ?? null;
  } catch {
    return null;
  }
}

// ── Cursor persistence ─────────────────────────────────────────────────────────

/**
 * Load the cursor from the DB. Returns 0 if no cursor has been persisted yet
 * (i.e. first-ever run).
 */
export async function loadCursor(key: string = CURSOR_KEY): Promise<number> {
  try {
    const row = await prisma.$queryRaw<{ ledger_seq: bigint }[]>`
      SELECT ledger_seq FROM indexer_cursors WHERE key = ${key} LIMIT 1
    `;
    return row[0] ? Number(row[0].ledger_seq) : 0;
  } catch {
    // Table may not exist in environments running only the Next.js side.
    return 0;
  }
}

/**
 * Persist (upsert) the cursor atomically. Safe to call after every poll tick.
 */
export async function saveCursor(ledger: number, key: string = CURSOR_KEY): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO indexer_cursors (key, ledger_seq)
    VALUES (${key}, ${ledger})
    ON CONFLICT (key) DO UPDATE SET ledger_seq = EXCLUDED.ledger_seq
  `;
}

// ── Gap detection + cursor adjustment ─────────────────────────────────────────

export interface CursorResolution {
  /** The ledger to use as the indexer's start point this cycle. */
  startLedger: number;
  /**
   * True when `startLedger` was advanced forward past the original cursor
   * because the cursor had fallen behind the RPC retention window.
   * When this is true, events between `originalCursor` and `startLedger`
   * are permanently unavailable from the RPC node.
   */
  gapDetected: boolean;
  /** The persisted cursor value before any adjustment. */
  originalCursor: number;
  /** Latest ledger as reported by the RPC, if reachable. */
  latestLedger: number | null;
}

/**
 * Resolve the start ledger for the next indexer poll cycle.
 *
 * Steps:
 *  1. Load the durable cursor from the DB.
 *  2. Fetch the latest ledger from the RPC.
 *  3. If the cursor is older than `latestLedger - RETENTION_LEDGER_WINDOW`,
 *     advance it to the earliest available ledger and record the gap.
 *  4. Return the resolution — the caller decides whether to alert / backfill.
 *
 * This function does **not** persist the adjusted cursor; call `saveCursor`
 * after successfully processing the events starting at `startLedger`.
 */
export async function resolveCursor(
  network: NetworkName,
  key: string = CURSOR_KEY,
): Promise<CursorResolution> {
  const originalCursor = await loadCursor(key);
  const latestLedger = await fetchLatestLedger(network);

  if (latestLedger === null) {
    // RPC unreachable — return the stored cursor unchanged; the caller's retry
    // logic will handle the outage.
    return { startLedger: originalCursor, gapDetected: false, originalCursor, latestLedger: null };
  }

  const earliestAvailable = Math.max(0, latestLedger - RETENTION_LEDGER_WINDOW);

  if (originalCursor < earliestAvailable) {
    // Cursor has fallen behind the retention window — advance to the earliest
    // ledger the RPC can still serve.
    return {
      startLedger: earliestAvailable,
      gapDetected: true,
      originalCursor,
      latestLedger,
    };
  }

  return {
    startLedger: originalCursor,
    gapDetected: false,
    originalCursor,
    latestLedger,
  };
}

/**
 * Convenience wrapper used by the Next.js API layer (e.g. a cron route) to
 * advance the cursor after a successful batch of events has been processed.
 *
 * Returns the resolution so the caller can log gap events or trigger backfill.
 */
export async function advanceCursor(
  processedUpToLedger: number,
  network: NetworkName,
  key: string = CURSOR_KEY,
): Promise<CursorResolution> {
  const resolution = await resolveCursor(network, key);
  // Always persist whichever is higher: the caller's processed ledger or
  // the gap-adjusted start (protects against a caller passing a stale value).
  const next = Math.max(processedUpToLedger, resolution.startLedger);
  await saveCursor(next, key);
  return resolution;
}
