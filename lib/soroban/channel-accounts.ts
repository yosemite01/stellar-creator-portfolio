/**
 * Channel Accounts Pool for Parallel Soroban Transaction Submission (#1729)
 *
 * Problem
 * -------
 * All platform-signed transactions share one source account, which serialises
 * throughput to one transaction per ledger (~5 s) because each transaction must
 * use a strictly incrementing sequence number on that single account.
 *
 * Solution
 * --------
 * Pre-fund N "channel" accounts and treat each as an independent sequence
 * counter. The pool hands out an idle channel account to each concurrent
 * submission, allowing up to N transactions per ledger in parallel. Each
 * channel is leased for the duration of one transaction and then returned.
 *
 * The pool is backed by Redis for cross-process coordination. Without Redis
 * (local dev / tests) it falls back to an in-process Map so the abstraction
 * stays usable in all environments.
 *
 * Usage
 * -----
 *   // At server startup:
 *   initChannelPool([
 *     { accountId: 'GCHAN1…', secretKey: process.env.CHANNEL_1_SECRET! },
 *     { accountId: 'GCHAN2…', secretKey: process.env.CHANNEL_2_SECRET! },
 *   ]);
 *
 *   // Per submission:
 *   const lease = await acquireChannel();
 *   try {
 *     await submitWithChannel(lease.accountId, lease.secretKey, tx);
 *   } finally {
 *     await releaseChannel(lease.leaseId);
 *   }
 *
 * Ops notes
 * ---------
 * - Channel accounts must be pre-funded on-chain (minimum base reserve + fees).
 * - Add more channels by calling `initChannelPool` with a larger list; the pool
 *   is append-only so existing leases are not disturbed.
 * - Lease TTL is 60 s; a crashed worker that never called releaseChannel will
 *   have its lease expire automatically so the channel is not stranded.
 */

import { getRedisClient } from '@/lib/storage/redis';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChannelAccount {
  /** Stellar public key (G…) of this channel account. */
  accountId: string;
  /** Ed25519 secret key (S…) — never logged, only held in memory. */
  secretKey: string;
}

export interface ChannelLease {
  /** Opaque lease ID used to release the channel. */
  leaseId: string;
  accountId: string;
  secretKey: string;
  /** Epoch ms when this lease was granted. */
  acquiredAt: number;
}

export interface PoolStats {
  total: number;
  idle: number;
  leased: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Redis key prefix for channel leases. */
const LEASE_KEY_PREFIX = 'soroban:channel:lease:';
/** Redis key for the idle-channel set. */
const IDLE_SET_KEY = 'soroban:channel:idle';
/** Lease TTL — a lease not explicitly released expires after this many seconds. */
const LEASE_TTL_SECS = 60;
/** How many times to retry acquiring a channel before giving up. */
const ACQUIRE_MAX_RETRIES = 20;
/** Delay between acquire retries in ms. */
const ACQUIRE_RETRY_DELAY_MS = 300;

// ── In-process fallback (no Redis) ────────────────────────────────────────────

interface InProcLease {
  accountId: string;
  secretKey: string;
  expiresAt: number;
}

const inProcIdle = new Map<string, ChannelAccount>(); // accountId → channel
const inProcLeases = new Map<string, InProcLease>();  // leaseId   → lease

// ── Registry ──────────────────────────────────────────────────────────────────

/** Master list of all channel accounts registered with this process. */
const registry = new Map<string, ChannelAccount>();

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register channel accounts and mark them idle in the pool.
 *
 * Safe to call multiple times — accounts already in the pool are skipped.
 * Call this once at server startup before any transactions are submitted.
 */
export async function initChannelPool(channels: ChannelAccount[]): Promise<void> {
  const redis = getRedisClient();

  for (const ch of channels) {
    if (registry.has(ch.accountId)) continue;
    registry.set(ch.accountId, ch);

    if (redis) {
      // Add to the Redis idle set only if not already leased.
      const leaseKey = `${LEASE_KEY_PREFIX}${ch.accountId}`;
      const isLeased = await redis.exists(leaseKey);
      if (!isLeased) {
        await redis.sadd(IDLE_SET_KEY, ch.accountId);
      }
    } else {
      inProcIdle.set(ch.accountId, ch);
    }
  }
}

/**
 * Acquire an idle channel account lease.
 *
 * Blocks (with retries) until a channel is available or the retry limit is
 * exhausted, at which point it throws. The caller must call `releaseChannel`
 * in a finally block to return the channel to the pool.
 *
 * @throws if no channel becomes available within the retry window.
 */
export async function acquireChannel(): Promise<ChannelLease> {
  const redis = getRedisClient();

  for (let attempt = 0; attempt < ACQUIRE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(ACQUIRE_RETRY_DELAY_MS);
    }

    const lease = redis
      ? await acquireViaRedis(redis)
      : acquireInProc();

    if (lease) return lease;
  }

  throw new Error(
    `[channel-pool] No idle channel available after ${ACQUIRE_MAX_RETRIES} attempts ` +
    `(${registry.size} channels registered, all leased). ` +
    `Add more channel accounts or increase LEASE_TTL_SECS.`,
  );
}

/**
 * Release a channel lease, returning the account to the idle pool.
 *
 * Safe to call with a lease that has already expired — the operation is a
 * no-op in that case.
 */
export async function releaseChannel(leaseId: string): Promise<void> {
  const redis = getRedisClient();

  if (redis) {
    await releaseViaRedis(redis, leaseId);
  } else {
    releaseInProc(leaseId);
  }
}

/**
 * Snapshot of pool utilisation for health/dashboard endpoints.
 */
export async function getPoolStats(): Promise<PoolStats> {
  const redis = getRedisClient();
  const total = registry.size;

  if (redis) {
    const idleCount = await redis.scard(IDLE_SET_KEY);
    return { total, idle: idleCount, leased: total - idleCount };
  }

  // Expire stale in-proc leases first so stats are accurate.
  expireInProcLeases();
  const idle = inProcIdle.size;
  return { total, idle, leased: total - idle };
}

/**
 * Run `fn` with an acquired channel account, releasing it automatically.
 *
 * ```ts
 * const txHash = await withChannel(async ({ accountId, secretKey }) => {
 *   return submitSorobanTx(accountId, secretKey, payload);
 * });
 * ```
 */
export async function withChannel<T>(
  fn: (lease: ChannelLease) => Promise<T>,
): Promise<T> {
  const lease = await acquireChannel();
  try {
    return await fn(lease);
  } finally {
    await releaseChannel(lease.leaseId);
  }
}

// ── Redis implementation ───────────────────────────────────────────────────────

type RedisClient = NonNullable<ReturnType<typeof getRedisClient>>;

async function acquireViaRedis(redis: RedisClient): Promise<ChannelLease | null> {
  // Atomically pop a member from the idle set.
  const accountId = await redis.spop(IDLE_SET_KEY);
  if (!accountId) return null;

  const ch = registry.get(accountId);
  if (!ch) {
    // Stale entry in Redis — the account was removed from registry after it
    // was added to the set.  Skip it; next iteration will try another.
    return null;
  }

  const leaseId = `${accountId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const leaseKey = `${LEASE_KEY_PREFIX}${accountId}`;

  // Record the lease with TTL so a crashed worker cannot strand the channel.
  await redis.set(leaseKey, leaseId, 'EX', LEASE_TTL_SECS);

  return { leaseId, accountId, secretKey: ch.secretKey, acquiredAt: Date.now() };
}

async function releaseViaRedis(redis: RedisClient, leaseId: string): Promise<void> {
  // leaseId encodes the accountId as the first segment.
  const accountId = leaseId.split(':')[0];
  if (!accountId) return;

  const leaseKey = `${LEASE_KEY_PREFIX}${accountId}`;
  const stored = await redis.get(leaseKey);

  // Only release if this lease is still the active one.
  if (stored === leaseId || stored === null) {
    await redis.del(leaseKey);
    // Return the channel to the idle set only if it is still registered.
    if (registry.has(accountId)) {
      await redis.sadd(IDLE_SET_KEY, accountId);
    }
  }
}

// ── In-process fallback implementation ────────────────────────────────────────

function acquireInProc(): ChannelLease | null {
  expireInProcLeases();

  const entry = inProcIdle.entries().next().value as [string, ChannelAccount] | undefined;
  if (!entry) return null;

  const [accountId, ch] = entry;
  inProcIdle.delete(accountId);

  const leaseId = `${accountId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  inProcLeases.set(leaseId, {
    accountId,
    secretKey: ch.secretKey,
    expiresAt: Date.now() + LEASE_TTL_SECS * 1000,
  });

  return { leaseId, accountId, secretKey: ch.secretKey, acquiredAt: Date.now() };
}

function releaseInProc(leaseId: string): void {
  const lease = inProcLeases.get(leaseId);
  if (!lease) return;

  inProcLeases.delete(leaseId);
  const ch = registry.get(lease.accountId);
  if (ch) {
    inProcIdle.set(lease.accountId, ch);
  }
}

function expireInProcLeases(): void {
  const now = Date.now();
  for (const [leaseId, lease] of inProcLeases) {
    if (lease.expiresAt <= now) {
      inProcLeases.delete(leaseId);
      const ch = registry.get(lease.accountId);
      if (ch && !inProcIdle.has(lease.accountId)) {
        inProcIdle.set(lease.accountId, ch);
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Remove all channels from the pool — intended for tests only.
 * @internal
 */
export function __resetChannelPoolForTests(): void {
  registry.clear();
  inProcIdle.clear();
  inProcLeases.clear();
}
