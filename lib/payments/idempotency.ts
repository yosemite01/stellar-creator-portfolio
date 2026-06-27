const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedResponse {
  status: number;
  body: unknown;
  createdAt: number;
}

type Store = Map<string, CachedResponse>;

function getStore(): Store {
  const g = globalThis as unknown as { __idempotencyStore?: Store };
  if (!g.__idempotencyStore) {
    g.__idempotencyStore = new Map();
  }
  return g.__idempotencyStore;
}

function pruneExpired(): void {
  const now = Date.now();
  const store = getStore();
  for (const [key, entry] of store) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(key);
    }
  }
}

export function getCachedResponse(key: string): { status: number; body: unknown } | null {
  pruneExpired();
  const entry = getStore().get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    getStore().delete(key);
    return null;
  }
  return { status: entry.status, body: entry.body };
}

export function cacheResponse(key: string, status: number, body: unknown): void {
  getStore().set(key, { status, body, createdAt: Date.now() });
}

export function __resetIdempotencyStoreForTests(): void {
  const g = globalThis as unknown as { __idempotencyStore?: Store };
  g.__idempotencyStore = new Map();
}
