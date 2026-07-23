/**
 * OfflineQueue — persistent operation queue backed by AsyncStorage.
 *
 * When the device is offline, mutations are serialised here.
 * When connectivity is restored, the queue is drained with exponential
 * back-off + jitter (BASE_DELAY * 2^attempt + rand, capped at MAX_DELAY).
 * After MAX_RETRIES failures the operation is moved to the dead-letter queue
 * so the user can be notified and decide whether to retry or discard.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueuedOperation } from '../types';

const QUEUE_KEY   = '@stellar/offline_queue';
const DLQ_KEY     = '@stellar/offline_dlq';
const MAX_RETRIES = 5;
const BASE_DELAY  = 1000;
const MAX_DELAY   = 30_000;

// ─── Back-off helper ──────────────────────────────────────────────────────────

function backoffMs(attempt: number): number {
  return Math.min(BASE_DELAY * 2 ** attempt + Math.random() * 1000, MAX_DELAY);
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

async function readQueue(): Promise<QueuedOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedOperation[];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedOperation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function readDLQ(): Promise<QueuedOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(DLQ_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedOperation[];
  } catch {
    return [];
  }
}

async function writeDLQ(queue: QueuedOperation[]): Promise<void> {
  await AsyncStorage.setItem(DLQ_KEY, JSON.stringify(queue));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Enqueue a mutation to be replayed when online. */
export async function enqueue(
  op: Omit<QueuedOperation, 'id' | 'retries' | 'createdAt' | 'nextRetryAt'>,
): Promise<void> {
  const queue = await readQueue();
  const entry: QueuedOperation = {
    ...op,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    retries: 0,
    createdAt: new Date().toISOString(),
    nextRetryAt: 0,
  };
  queue.push(entry);
  await writeQueue(queue);
}

/** Return all pending operations (including those not yet ready to retry). */
export async function getPendingOps(): Promise<QueuedOperation[]> {
  return readQueue();
}

/** Return only operations whose back-off window has elapsed. */
export async function getRetryableOps(): Promise<QueuedOperation[]> {
  const now = Date.now();
  const queue = await readQueue();
  return queue.filter((op) => op.nextRetryAt <= now);
}

/** Remove a successfully replayed operation from the queue. */
export async function dequeue(id: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.filter((op) => op.id !== id));
}

/**
 * Increment retry count and schedule the next retry using exponential back-off.
 * Returns `true` when the operation has been promoted to the dead-letter queue
 * after exceeding MAX_RETRIES, so the caller can notify the user.
 */
export async function markRetry(id: string): Promise<boolean> {
  const queue = await readQueue();
  const op = queue.find((o) => o.id === id);
  if (!op) return false;

  const newRetries = op.retries + 1;

  if (newRetries >= MAX_RETRIES) {
    const dlq = await readDLQ();
    dlq.push({ ...op, retries: newRetries });
    await writeDLQ(dlq);
    await writeQueue(queue.filter((o) => o.id !== id));
    return true;
  }

  const updated = queue.map((o) =>
    o.id === id
      ? { ...o, retries: newRetries, nextRetryAt: Date.now() + backoffMs(newRetries) }
      : o,
  );
  await writeQueue(updated);
  return false;
}

/** Return all dead-lettered operations. */
export async function getDeadLetterOps(): Promise<QueuedOperation[]> {
  return readDLQ();
}

/** Move a dead-lettered operation back to the active queue for another attempt. */
export async function requeueFromDead(id: string): Promise<void> {
  const dlq = await readDLQ();
  const op = dlq.find((o) => o.id === id);
  if (!op) return;
  await writeDLQ(dlq.filter((o) => o.id !== id));
  const queue = await readQueue();
  queue.push({ ...op, retries: 0, nextRetryAt: 0 });
  await writeQueue(queue);
}

/** Discard all dead-lettered operations. */
export async function clearDeadLetter(): Promise<void> {
  await AsyncStorage.removeItem(DLQ_KEY);
}

/** Clear the entire active queue (e.g. on sign-out). */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

/** Count of pending operations. */
export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

/** Count of dead-lettered operations. */
export async function deadLetterCount(): Promise<number> {
  return (await readDLQ()).length;
}
