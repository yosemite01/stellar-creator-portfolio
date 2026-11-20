/**
 * POST /api/search/hybrid
 *
 * Hybrid search endpoint combining Elasticsearch BM25 lexical search with
 * dense vector semantic search, merged via Reciprocal Rank Fusion (RRF).
 *
 * Request body (validated by hybridSearchSchema; unknown keys are rejected with 400):
 *   query         string   required  Natural-language search query (2-200 chars)
 *   limit         number   optional  Max results (default: 10, clamped to 50)
 *   minScore      number   optional  Minimum RRF score threshold
 *   discipline    string   optional  Filter by discipline (exact)
 *   skills        string[] optional  Required skills (AND, max 10)
 *   verifiedOnly  boolean  optional  Only verified creators
 *
 * Response: SearchResult[] (id, displayName, discipline, skills, score, scoreBreakdown)
 */

import { NextRequest, NextResponse } from 'next/server';
import { hybridSearchSchema } from '@/lib/search/schema';
import { hybridSearch, bountyViewSearch, checkClusterHealth } from '@/server/services/search';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { requireAuth } from '@/server/services/authorization';

export const runtime = 'nodejs';

/**
 * POST /api/search/hybrid
 *
 * type = "creator" (default) — Elasticsearch + semantic RRF over creator profiles.
 * type = "bounty"            — Postgres materialized-view search over bounty_search_view
 *                              (issue #744). Bypasses the write DB entirely.
 */
export async function POST(req: NextRequest) {
  // Require authentication for bounty type searches
  const body = await req.json().catch(() => null);
  if (body?.type === 'bounty') {
    const session = await getServerSession(authOptions);
    requireAuth({ user: session?.user });
  }
  
  try {
    const parsed = hybridSearchSchema.safeParse(body ?? null);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const bodyData = parsed.data;
    const { query, limit } = bodyData;

    // Route bounty searches to the read-optimised materialized view.
    if (bodyData.type === 'bounty') {
      const results = await bountyViewSearch({
        query,
        limit,
        minBudget: bodyData.minBudget,
        maxBudget: bodyData.maxBudget,
        status: bodyData.status,
        tags: bodyData.tags,
      });

      return NextResponse.json({
        results,
        meta: {
          query,
          limit,
          count: results.length,
          engine: 'bounty-search-view-v1',
        },
      });
    }

    const results = await hybridSearch({
      query,
      limit,
      minScore: bodyData.minScore,
      discipline: bodyData.discipline,
      skills: bodyData.skills,
      verifiedOnly: bodyData.verifiedOnly === true,
      expandSynonyms: bodyData.expandSynonyms !== false,
    });

    return NextResponse.json({
      results,
      meta: {
        query,
        limit,
        count: results.length,
        engine: 'hybrid-rrf-v1',
      },
    });
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';

    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      return NextResponse.json(
        {
          error: 'Search service temporarily unavailable',
          fallback: true,
          results: [],
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET /api/search/hybrid — cluster health check */
export async function GET() {
  const health = await checkClusterHealth();
  return NextResponse.json(health, {
    status: health.healthy ? 200 : 503,
  });
}
