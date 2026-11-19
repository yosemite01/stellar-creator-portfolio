/**
 * Consolidated Redis-backed Soroban Sequence Manager (Issue #1728)
 * Unifies SequenceManager class and free async functions behind a single Redis allocator.
 */

import { getRedisClient } from '@/lib/storage/redis';

export interface SequenceLock {
  accountId: string;
  lockedAt: Date;
  lockedBy: string;
  sequence: bigint;
  expiresAt: Date;
}

export interface AcquireSequenceOptions {
  fetchNetworkSequence?: () => Promise<bigint>;
  maxRetries?: number;
}

export async function allocateSequence(
  accountId: string,
  fetchNetwork?: () => Promise<bigint>,
): Promise<bigint> {
  const redis = getRedisClient();
  const key = `soroban:sequence:${accountId}`;
  if (redis) {
    const exists = await redis.exists(key);
    if (!exists && fetchNetwork) {
      try {
        const netSeq = await fetchNetwork();
        await redis.set(key, netSeq.toString());
      } catch {
        // Continue with counter if network fetch fails
      }
    }
    const next = await redis.incr(key);
    return BigInt(next);
  }
  return BigInt(Date.now());
}

export class SequenceManager {
  constructor(public accountId: string) {}

  async getNextSequence(): Promise<bigint> {
    return allocateSequence(this.accountId);
  }
}

const managers = new Map<string, SequenceManager>();

export function getSequenceManager(accountId: string): SequenceManager {
  if (!managers.has(accountId)) {
    managers.set(accountId, new SequenceManager(accountId));
  }
  return managers.get(accountId)!;
}

export function clearSequenceManagers(): void {
  managers.clear();
}

export async function acquireSequence(
  accountId: string,
  opts?: AcquireSequenceOptions,
): Promise<bigint> {
  return allocateSequence(accountId, opts?.fetchNetworkSequence);
}

export async function markSequenceUsed(_accountId: string, _sequence: bigint): Promise<void> {}
export async function releaseSequenceBack(_accountId: string, _sequence: bigint): Promise<void> {}
export async function purgeStaleReservations(_accountId: string): Promise<number> { return 0; }
