/**
 * Pessimistic Locking for PostgreSQL
 * Prevents race conditions and deadlocks through explicit row-level locks
 */

import { prisma } from "@/lib/prisma";

/**
 * Lock modes for SELECT FOR UPDATE
 */
export enum LockMode {
  EXCLUSIVE = "FOR UPDATE",
  SHARED = "FOR SHARE",
  NOWAIT = "FOR UPDATE NOWAIT",
  SKIP_LOCKED = "FOR UPDATE SKIP LOCKED",
}

/**
 * Acquire exclusive lock on a creator row
 * Prevents concurrent updates to the same creator
 */
export async function lockCreator(
  creatorId: string,
  mode: LockMode = LockMode.EXCLUSIVE,
): Promise<any> {
  return prisma.$queryRawUnsafe(
    `SELECT * FROM "CreatorProfile" WHERE "id" = $1 ${mode}`,
    creatorId,
  );
}

/**
 * Acquire exclusive lock on a client row
 */
export async function lockClient(
  clientId: string,
  mode: LockMode = LockMode.EXCLUSIVE,
): Promise<any> {
  return prisma.$queryRawUnsafe(
    `SELECT * FROM "ClientProfile" WHERE "id" = $1 ${mode}`,
    clientId,
  );
}

/**
 * Acquire exclusive lock on an escrow row
 */
export async function lockEscrow(
  escrowId: string,
  mode: LockMode = LockMode.EXCLUSIVE,
): Promise<any> {
  return prisma.$queryRawUnsafe(
    `SELECT * FROM "Escrow" WHERE "id" = $1 ${mode}`,
    escrowId,
  );
}

/**
 * Acquire exclusive lock on a balance row
 */
export async function lockBalance(
  userId: string,
  mode: LockMode = LockMode.EXCLUSIVE,
): Promise<any> {
  return prisma.$queryRawUnsafe(
    `SELECT * FROM "Balance" WHERE "userId" = $1 ${mode}`,
    userId,
  );
}

/**
 * Acquire locks on multiple rows in strict order
 * This prevents circular wait deadlocks
 */
export async function acquireLocksInOrder(
  locks: Array<{
    type: "creator" | "client" | "escrow" | "balance";
    id: string;
  }>,
  mode: LockMode = LockMode.EXCLUSIVE,
): Promise<Map<string, any>> {
  // Define lock order to prevent deadlocks
  const lockOrder = {
    creator: 1,
    client: 2,
    escrow: 3,
    balance: 4,
  };

  // Sort locks by order
  const sorted = [...locks].sort(
    (a, b) => lockOrder[a.type] - lockOrder[b.type],
  );

  const results = new Map<string, any>();

  for (const lock of sorted) {
    const key = `${lock.type}:${lock.id}`;

    try {
      let result: any;

      switch (lock.type) {
        case "creator":
          result = await lockCreator(lock.id, mode);
          break;
        case "client":
          result = await lockClient(lock.id, mode);
          break;
        case "escrow":
          result = await lockEscrow(lock.id, mode);
          break;
        case "balance":
          result = await lockBalance(lock.id, mode);
          break;
      }

      results.set(key, result);
    } catch (error) {
      // If NOWAIT mode and lock is held, error is expected
      if (mode === LockMode.NOWAIT) {
        throw new Error(`Could not acquire lock on ${lock.type}:${lock.id}`);
      }

      // For other modes, re-throw
      throw error;
    }
  }

  return results;
}

/**
 * Release locks by committing the transaction
 * (Locks are automatically released when transaction ends)
 */
export async function releaseLocks(): Promise<void> {
  // Locks are released automatically when transaction commits
  // This is a no-op but kept for API consistency
}

/**
 * Acquire lock with timeout
 * Useful for preventing indefinite waits
 */
export async function lockWithTimeout(
  lockFn: () => Promise<any>,
  timeoutMs: number = 5000,
): Promise<any> {
  return Promise.race([
    lockFn(),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`Lock acquisition timeout after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Try to acquire lock without waiting
 * Returns null if lock cannot be acquired immediately
 */
export async function tryLock(lockFn: () => Promise<any>): Promise<any | null> {
  try {
    return await lockWithTimeout(lockFn, 100);
  } catch (error) {
    if ((error as Error).message.includes("timeout")) {
      return null;
    }
    throw error;
  }
}
