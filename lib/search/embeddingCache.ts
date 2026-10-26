/**
 * In-memory cache of query embeddings (#1511).
 *
 * Repeated searches reuse the stored vector instead of paying for another
 * embeddings call.  Keys are normalised (NFKC, case, whitespace) so trivially
 * different spellings of one query share an entry.  Process-local and bounded;
 * oldest entries are evicted first.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

interface Entry {
  embedding: number[];
  expiresAt: number;
}

const cache = new Map<string, Entry>();

export function normaliseQuery(query: string): string {
  return query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function getCachedEmbedding(
  query: string,
  embed: (query: string) => Promise<number[]>,
  now: number = Date.now(),
): Promise<number[]> {
  const key = normaliseQuery(query);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.embedding;

  const embedding = await embed(query);
  cache.delete(key);
  cache.set(key, { embedding, expiresAt: now + TTL_MS });
  if (cache.size > MAX_ENTRIES) {
    // Map iterates in insertion order, so the first key is the oldest.
    cache.delete(cache.keys().next().value as string);
  }
  return embedding;
}

/** Test helper: empty the cache. */
export function clearEmbeddingCache(): void {
  cache.clear();
}
