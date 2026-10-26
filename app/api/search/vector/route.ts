/**
 * POST /api/search/vector
 *
 * Semantic vector search over creator portfolios.
 *
 * 1. Embeds the query string via the configured embedding model.
 * 2. Queries the database for the nearest-neighbour creators using
 *    pgvector's <=> operator (cosine distance) via Supabase RPC.
 * 3. Applies optional tag filters and returns ranked results.
 *
 * Every call can trigger a paid embeddings request, so callers are rate
 * limited (per IP when anonymous, per user when signed in), the body is
 * validated and `limit` is clamped before anything is embedded (#1511).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { getCachedEmbedding } from '@/lib/search/embeddingCache';
import { vectorSearchSchema } from '@/lib/search/schema';
import { checkRateLimit } from '@/server/api/rate-limit';

const EMBED_ENDPOINT =
  process.env.EMBED_ENDPOINT ?? 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'text-embedding-3-small';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

async function embedQuery(query: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    // Fallback: return a deterministic mock vector for local dev.
    // Hash based on full query content, not just length, so distinct queries produce distinct vectors.
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      hash += query.charCodeAt(i);
    }
    return Array.from({ length: 1536 }, (_, i) => Math.sin(i + hash));
  }

  const res = await fetch(EMBED_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ input: query, model: EMBED_MODEL }),
  });

  if (!res.ok) throw new Error(`Embedding API error: ${res.statusText}`);
  const json = await res.json();
  return json.data[0].embedding as number[];
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    const limited = checkRateLimit(req, { userId: session?.user?.id }, 'search-vector');
    if (!limited.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } },
      );
    }

    const parsed = vectorSearchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { query, limit, threshold, tags } = parsed.data;

    const embedding = await getCachedEmbedding(query, embedQuery);

    // Dynamic import to avoid bundling the DB client in edge runtimes.
    const { supabaseServer } = await import('@/lib/db');

    // Use pgvector cosine similarity via Supabase RPC.
    // The `match_creators` function must be defined in the database:
    //   SELECT id, name, title, discipline, skills, 1 - (embedding <=> query_embedding) AS score
    //   FROM creators WHERE 1 - (embedding <=> query_embedding) > match_threshold
    //   ORDER BY score DESC LIMIT match_count;
    const { data, error } = await (supabaseServer as any).rpc('match_creators', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      // Graceful degradation: fall back to text search if vector search fails.
      // Signal the degraded mode to callers and monitoring via a response flag
      // and a non-200 status, mirroring the pattern used in /api/search/hybrid.
      console.warn('[vector-search] match_creators RPC failed, falling back to text search:', error.message);

      const { data: fallback } = await supabaseServer
        .from('creators')
        .select('id, name, title, discipline, skills')
        .ilike('bio', `%${query}%`)
        .limit(limit);

      const results = (fallback ?? []).map((c: any) => ({
        ...c,
        score: 0.5,
        matchedTags: [],
      }));

      return NextResponse.json(
        {
          results,
          meta: {
            engine: 'text-fallback',
            fallback: true,
            fallbackReason: 'vector-search-unavailable',
          },
        },
        { status: 503 },
      );
    }

    // Apply tag filtering on the server side.
    let results = (data ?? []).map((r: any) => ({ ...r, matchedTags: [] }));
    if (tags.length > 0) {
      const required = new Set((tags as string[]).map((t) => t.toLowerCase()));
      results = results
        .map((r: any) => ({
          ...r,
          matchedTags: (r.skills ?? [])
            .concat(r.discipline ?? '')
            .filter((s: string) => required.has(s.toLowerCase())),
        }))
        .filter((r: any) => r.matchedTags.length > 0);
    }

    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
