/**
 * DataLoader implementation for batching database queries
 * Prevents N+1 query problems by collecting requests and executing them in batches
 */

type BatchFn<K, V> = (keys: K[]) => Promise<(V | Error)[]>;

export class DataLoader<K, V> {
  private queue: Array<{
    key: K;
    resolve: (v: V) => void;
    reject: (e: Error) => void;
  }> = [];
  private cache = new Map<K, V>();
  private batchScheduled = false;

  constructor(
    private batchFn: BatchFn<K, V>,
    private options: { cache?: boolean; batchScheduleMs?: number } = {},
  ) {
    this.options.cache = this.options.cache !== false;
    this.options.batchScheduleMs = this.options.batchScheduleMs ?? 0;
  }

  async load(key: K): Promise<V> {
    // Check cache first
    if (this.options.cache && this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      this.scheduleBatch();
    });
  }

  async loadMany(keys: K[]): Promise<(V | Error)[]> {
    return Promise.all(keys.map((k) => this.load(k).catch((e) => e)));
  }

  private scheduleBatch() {
    if (this.batchScheduled) return;
    this.batchScheduled = true;

    setTimeout(() => {
      this.executeBatch();
    }, this.options.batchScheduleMs);
  }

  private async executeBatch() {
    const queue = this.queue;
    this.queue = [];
    this.batchScheduled = false;

    if (queue.length === 0) return;

    const keys = queue.map((q) => q.key);
    try {
      const results = await this.batchFn(keys);
      queue.forEach((q, i) => {
        const result = results[i];
        if (result instanceof Error) {
          q.reject(result);
        } else {
          if (this.options.cache) {
            this.cache.set(q.key, result);
          }
          q.resolve(result);
        }
      });
    } catch (error) {
      queue.forEach((q) => q.reject(error as Error));
    }
  }

  clear(key?: K) {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  clearAll() {
    this.cache.clear();
  }
}

/**
 * Create a DataLoader instance for creator reviews
 */
export function createCreatorReviewsLoader() {
  return new DataLoader(
    async (creatorIds: string[]) => {
      // Batch fetch reviews for multiple creators
      const response = await fetch("/api/creators/reviews/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorIds }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch reviews: ${response.statusText}`);
      }

      const data = (await response.json()) as Record<string, any>;
      return creatorIds.map((id) => data[id] || { reviews: [], total: 0 });
    },
    { cache: true, batchScheduleMs: 10 },
  );
}

/**
 * Create a DataLoader instance for creator reputation stats
 */
export function createCreatorReputationLoader() {
  return new DataLoader(
    async (creatorIds: string[]) => {
      const response = await fetch("/api/creators/reputation/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorIds }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch reputation: ${response.statusText}`);
      }

      const data = (await response.json()) as Record<string, any>;
      return creatorIds.map((id) => data[id] || {});
    },
    { cache: true, batchScheduleMs: 10 },
  );
}
