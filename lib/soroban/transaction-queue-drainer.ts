/**
 * Transaction Queue Drainer — Issue #838
 *
 * Runs at 100ms intervals, not per-request.
 * Processes pending TransactionQueue entries in batches, using the
 * sequence pool to eliminate per-request RPC calls and sequence collisions.
 *
 * Architecture:
 *  - One drainer instance per server process (singleton)
 *  - Per-account concurrency = 1 (ordered submission)
 *  - On "bad sequence" error → release slot back to pool, retry with next seq
 *  - Throughput target: > 20 tx/second across all accounts
 */

import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/storage/redis';
import { stellarClient } from '@/server/stellar/client';
import { contractService } from '@/server/stellar/contract';
import type { Signer } from '@/server/stellar/types';
import {
  acquireSequence,
  markSequenceUsed,
  releaseSequenceBack,
  purgeStaleReservations,
} from './sequence-manager-v2';

const DRAIN_INTERVAL_MS = 100;
const BATCH_SIZE = 20;   // max tx per drainer tick
const MAX_ATTEMPTS = 5;

// ── Types ──────────────────────────────────────────────────────────────────────

export type DrainerStats = {
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  uptimeMs: number;
};

// Accounts currently being processed (to avoid concurrent draining per account)
const inFlight = new Set<string>();

// Cumulative counters exposed by getDrainerStats(). Declared here rather than
// beside the timer below so drainAccount can write to them without a
// use-before-declaration.
const stats: DrainerStats = {
  processed: 0,
  succeeded: 0,
  failed: 0,
  retried: 0,
  uptimeMs: 0,
};

// ── Soroban RPC ────────────────────────────────────────────────────────────────
//
// These two functions were stubbed (Issue #1391). `fetchNetworkSequenceForAccount`
// read the sequence back out of our own `sequenceLock` table — so the "refill
// the pool from the network" path never touched the network and could not
// recover from the drift it exists to correct. `submitToSorobanRPC` returned a
// synthesised string, which meant every queued transaction was marked
// `confirmed` with a fake hash and nothing was ever submitted.
//
// Both now go through `server/stellar`, which is already wrapped in the
// shared circuit breaker — a raw `new rpc.Server(...)` here would bypass it and
// let the drainer hammer a node that every other caller has already backed off
// from.

/**
 * Signer resolution for the drainer.
 *
 * The drainer runs unattended, so it cannot prompt a wallet — it needs a signer
 * per source account. How those keys are held is a deployment decision (KMS,
 * env-injected secrets, a remote signing service), so the resolver is injected
 * rather than assumed here.
 *
 * Call `setDrainerSigner` once at startup, alongside `startDrainer`.
 */
export type SignerResolver = (accountId: string) => Promise<Signer | null>;

let resolveSigner: SignerResolver | null = null;

/**
 * Registers how the drainer obtains a signer for an account.
 *
 * Without this, `drainAccount` fails each transaction with a clear error rather
 * than silently marking it confirmed — which is what the previous stub did, and
 * is the worse failure by a wide margin: a queue that reports success while
 * submitting nothing.
 */
export function setDrainerSigner(resolver: SignerResolver): void {
  resolveSigner = resolver;
}

/** Reads the account's current sequence number from the network. */
async function fetchNetworkSequenceForAccount(accountId: string): Promise<bigint> {
  const account = await stellarClient.rpc.getAccount(accountId);
  // `sequenceNumber()` is the last *used* sequence, as a decimal string.
  return BigInt(account.sequenceNumber());
}

/**
 * Builds, signs, submits and confirms a queued contract call.
 *
 * Delegates to `contractService.invokeContractMethod`, which simulates and
 * assembles before submitting and then polls to a terminal status — so a hash
 * returned here is a transaction that actually landed, not merely one that was
 * accepted for processing.
 *
 * Note on `sequence`: the pooled sequence is what serialises submissions per
 * account in this drainer, but the SDK reads the source account's sequence
 * itself when it builds the transaction. Passing our pooled value through would
 * require rebuilding the transaction by hand and giving up simulation, so the
 * pool stays what it has always been — a concurrency gate — and the SDK owns
 * the on-wire sequence. This is why a bad-sequence error is still possible and
 * still handled below.
 */
async function submitToSorobanRPC(tx: {
  accountId: string;
  contractId: string;
  method: string;
  args: unknown;
  sequence: bigint;
}): Promise<string> {
  if (resolveSigner == null) {
    throw new Error(
      '[drainer] no signer resolver registered — call setDrainerSigner() at startup',
    );
  }

  const signer = await resolveSigner(tx.accountId);
  if (signer == null) {
    throw new Error(`[drainer] no signer available for account ${tx.accountId}`);
  }

  // Queue rows store `args` as JSON. A contract call takes a positional list,
  // so a single value is wrapped rather than spread into characters.
  const args = Array.isArray(tx.args) ? tx.args : tx.args == null ? [] : [tx.args];

  return contractService.invokeContractMethod(tx.contractId, tx.method, args, signer);
}

function isBadSequenceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('bad sequence') ||
    msg.includes('txBAD_SEQ') ||
    msg.includes('wrong sequence')
  );
}

// ── Per-account drainer ────────────────────────────────────────────────────────

async function drainAccount(accountId: string): Promise<void> {
  if (inFlight.has(accountId)) return; // already draining this account
  inFlight.add(accountId);

  try {
    // Get oldest pending tx for this account
    const tx = await prisma.transactionQueue.findFirst({
      where: { accountId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    if (!tx) {
      inFlight.delete(accountId);
      return;
    }

    let sequence: bigint | null = null;

    try {
      sequence = await acquireSequence(accountId, {
        fetchNetworkSequence: () =>
          fetchNetworkSequenceForAccount(accountId),
      });

      const txHash = await submitToSorobanRPC({
        accountId,
        contractId: tx.contractId,
        method: tx.method,
        args: tx.args,
        sequence,
      });

      // Success — mark confirmed
      await prisma.$transaction([
        prisma.transactionQueue.update({
          where: { id: tx.id },
          data: {
            status: 'confirmed',
            txHash,
            sequence,
            submittedAt: new Date(),
            confirmedAt: new Date(),
            attempts: tx.attempts + 1,
          },
        }),
        // Persist SorobanTransaction record
        prisma.sorobanTransaction.create({
          data: {
            accountId,
            contractId: tx.contractId,
            method: tx.method,
            sequence,
            txHash,
            status: 'confirmed',
            submittedAt: new Date(),
            confirmedAt: new Date(),
          },
        }),
      ]);

      await markSequenceUsed(accountId, sequence);

      stats.processed += 1;
      stats.succeeded += 1;
    } catch (err) {
      const isBadSeq = isBadSequenceError(err);

      // Release sequence back to pool on bad-sequence so next attempt can retry
      if (sequence != null) {
        if (isBadSeq) {
          await releaseSequenceBack(accountId, sequence);
        } else {
          await markSequenceUsed(accountId, sequence); // consumed, even on failure
        }
      }

      const nextAttempts = tx.attempts + 1;
      const exhausted = nextAttempts >= MAX_ATTEMPTS;

      await prisma.transactionQueue.update({
        where: { id: tx.id },
        data: {
          attempts: nextAttempts,
          status: exhausted ? 'failed' : 'pending',
          error: err instanceof Error ? err.message : String(err),
          // On bad-sequence retry with slight delay (next drainer tick handles it)
        },
      });

      // `stats` was declared and exposed through getDrainerStats() but never
      // written to, so every counter read as 0 no matter how much the drainer
      // had done — the one signal an operator has into a background process
      // reported nothing.
      if (!exhausted) {
        stats.retried += 1;
        console.warn(
          `[drainer] tx ${tx.id} attempt ${nextAttempts}/${MAX_ATTEMPTS}: ${isBadSeq ? 'bad-seq, retrying' : 'transient error'}`,
        );
      } else {
        stats.processed += 1;
        stats.failed += 1;
        console.error(`[drainer] tx ${tx.id} EXHAUSTED after ${MAX_ATTEMPTS} attempts`);
      }
    }
  } finally {
    inFlight.delete(accountId);
  }
}

// ── Global drainer ─────────────────────────────────────────────────────────────

let drainerTimer: ReturnType<typeof setInterval> | null = null;
let startedAt: number | null = null;

async function drainerTick(): Promise<void> {
  const redis = getRedisClient();
  const lockKey = 'soroban:drainer:lock';
  let lockAcquired = false;
  if (redis) {
    const res = await redis.set(lockKey, 'locked', 'EX', 15, 'NX').catch(() => null);
    if (!res) return; // Another instance is actively draining (exactly-once across instances)
    lockAcquired = true;
  }

  try {
    // Find distinct accounts with pending work
    const pending = await prisma.transactionQueue.groupBy({
      by: ['accountId'],
      where: { status: 'pending' },
      orderBy: { accountId: 'asc' },
      take: BATCH_SIZE,
    });

    await Promise.all(pending.map((r) => drainAccount(r.accountId)));

    // Periodically purge stale reservations (every ~10s)
    if (Date.now() % 10000 < DRAIN_INTERVAL_MS) {
      const accounts = await prisma.sequencePool.groupBy({
        by: ['accountId'],
        where: { reserved: true, usedAt: null },
      });
      await Promise.all(
        accounts.map((a) => purgeStaleReservations(a.accountId)),
      );
    }
  } catch (err) {
    console.error('[drainer] tick error:', err);
  } finally {
    if (redis && lockAcquired) {
      await redis.del(lockKey).catch(() => {});
    }
  }
}

/**
 * Start the global drainer — call once at server startup.
 * Safe to call multiple times (idempotent).
 */
export function startDrainer(): void {
  if (drainerTimer != null) return;
  startedAt = Date.now();
  drainerTimer = setInterval(() => {
    drainerTick().catch((e) => console.error('[drainer] uncaught:', e));
  }, DRAIN_INTERVAL_MS);

  console.info(`[drainer] Started — interval=${DRAIN_INTERVAL_MS}ms, batch=${BATCH_SIZE}`);
}

/**
 * Stop the drainer (e.g. during graceful shutdown).
 */
export function stopDrainer(): void {
  if (drainerTimer != null) {
    clearInterval(drainerTimer);
    drainerTimer = null;
    console.info('[drainer] Stopped');
  }
}

/**
 * Get drainer statistics.
 */
export function getDrainerStats(): DrainerStats {
  return {
    ...stats,
    uptimeMs: startedAt != null ? Date.now() - startedAt : 0,
  };
}

/**
 * Enqueue a transaction for background submission.
 * Returns the queue entry ID for status polling.
 */
export async function enqueueTransaction(opts: {
  accountId: string;
  contractId: string;
  method: string;
  args: unknown;
  maxAttempts?: number;
}): Promise<string> {
  const entry = await prisma.transactionQueue.create({
    data: {
      accountId: opts.accountId,
      contractId: opts.contractId,
      method: opts.method,
      args: opts.args as object,
      status: 'pending',
      maxAttempts: opts.maxAttempts ?? MAX_ATTEMPTS,
    },
  });
  // Fire-and-forget tick for serverless environments where intervals do not run
  drainerTick().catch(() => {});
  return entry.id;
}
