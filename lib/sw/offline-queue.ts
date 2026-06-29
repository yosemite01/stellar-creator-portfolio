/**
 * Issue #630 — Client-side offline mutation queue
 * Issue #879 — Offline-first bounty application queue
 *
 * Stores pending mutations in IndexedDB when the user is offline.
 * Registers a Background Sync tag so the service worker replays them
 * automatically once connectivity is restored. Bounty application
 * submissions are a first-class mutation type with typed helpers.
 */

const DB_NAME = 'stellar-offline-queue';
const STORE_NAME = 'mutations';
const SYNC_TAG = 'stellar-mutation-queue';

export interface OfflineMutation {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
  /** Discriminator for typed mutations */
  type?: string;
}

/** Typed bounty application payload stored in the queue. */
export interface BountyApplicationMutation extends OfflineMutation {
  type: 'bounty-application';
  /** Human-readable bounty title for UX display. */
  bountyTitle: string;
  /** Local attempt count for display purposes. */
  retries: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Queue a mutation for later replay. */
export async function enqueue(mutation: OfflineMutation): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(mutation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // Notify the service worker to replay when online
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register(SYNC_TAG);
  }
}

/**
 * Queue a bounty application for offline submission.
 * Automatically registers a background sync tag and sets up an online
 * listener as a fallback for browsers without Background Sync support.
 */
export async function enqueueBountyApplication(
  payload: Record<string, unknown>,
  bountyTitle: string,
): Promise<void> {
  const mutation: BountyApplicationMutation = {
    url: '/api/bounty-applications',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timestamp: Date.now(),
    type: 'bounty-application',
    bountyTitle,
    retries: 0,
  };
  await enqueue(mutation);
  registerOnlineFlush();
}

/** List pending bounty application mutations only. */
export async function listQueuedBountyApplications(): Promise<
  Array<{ key: IDBValidKey; mutation: BountyApplicationMutation }>
> {
  const db = await openDB();
  const all = await listAllWithKeys(db);
  return all.filter(
    (e): e is { key: IDBValidKey; mutation: BountyApplicationMutation } =>
      (e.mutation as BountyApplicationMutation).type === 'bounty-application',
  );
}

/** Retrieve all queued mutations without removing them. */
export async function listQueued(): Promise<OfflineMutation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const results: OfflineMutation[] = [];
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push(cursor.value as OfflineMutation);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Replay all queued mutations directly from the page context.
 * Prefer the Background Sync path (via the service worker) when available;
 * this is a fallback for browsers that do not support Background Sync.
 */
export async function flush(): Promise<{ replayed: number; failed: number }> {
  const db = await openDB();
  const mutations = await listAllWithKeys(db);

  let replayed = 0;
  let failed = 0;

  for (const { key, mutation } of mutations) {
    try {
      await fetch(mutation.url, {
        method: mutation.method,
        headers: new Headers(mutation.headers),
        body: mutation.body,
      });
      await deleteRecord(db, key);
      replayed++;
    } catch {
      failed++;
    }
  }

  return { replayed, failed };
}

// ---------------------------------------------------------------------------
// Online-listener flush fallback (for browsers without Background Sync)
// ---------------------------------------------------------------------------

let onlineListenerRegistered = false;

/**
 * Register a one-time online listener that calls flush() when connectivity
 * returns. Safe to call multiple times — only registers once.
 */
export function registerOnlineFlush(): void {
  if (typeof window === 'undefined' || onlineListenerRegistered) return;
  onlineListenerRegistered = true;

  const handler = async () => {
    // Only flush if Background Sync is not supported
    if (!('SyncManager' in window)) {
      await flush();
    }
    window.removeEventListener('online', handler);
    onlineListenerRegistered = false;
  };

  window.addEventListener('online', handler);
}

function listAllWithKeys(db: IDBDatabase): Promise<Array<{ key: IDBValidKey; mutation: OfflineMutation }>> {
  return new Promise((resolve, reject) => {
    const results: Array<{ key: IDBValidKey; mutation: OfflineMutation }> = [];
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push({ key: cursor.key, mutation: cursor.value as OfflineMutation });
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

function deleteRecord(db: IDBDatabase, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
