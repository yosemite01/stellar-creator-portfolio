/**
 * POST /api/search/hybrid
 *
 * Hybrid search endpoint combining Elasticsearch BM25 lexical search with
 * dense vector semantic search, merged via Reciprocal Rank Fusion (RRF).
 *
 * Request body:
 *   query         string   required  Natural-language search query
 *   limit         number   optional  Max results (default: 10, max: 50)
 *   minScore      number   optional  Minimum RRF score threshold
 *   discipline    string   optional  Filter by discipline (exact)
 *   skills        string[] optional  Required skills (AND)
 *   verifiedOnly  boolean  optional  Only verified creators
 *
 * Response: SearchResult[] (id, displayName, discipline, skills, score, scoreBreakdown)
 */

import { NextRequest, NextResponse } from 'next/server';
import { hybridSearch, bountyViewSearch, checkClusterHealth } from '@/backend/services/search';

export const runtime = 'nodejs';

/**
 * POST /api/search/hybrid
 *
 * type = "creator" (default) — Elasticsearch + semantic RRF over creator profiles.
 * type = "bounty"            — Postgres materialized-view search over bounty_search_view
 *                              (issue #744). Bypasses the write DB entirely.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body?.query || typeof body.query !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "query" field' },
        { status: 400 },
      );
    }

    const limit = Math.min(parseInt(body.limit ?? '10'), 50);
    const searchType: string = body.type ?? 'creator';

    // Route bounty searches to the read-optimised materialized view.
    if (searchType === 'bounty') {
      const results = await bountyViewSearch({
        query: body.query.trim(),
        limit,
        minBudget: body.minBudget,
        maxBudget: body.maxBudget,
        status: body.status,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
      });

      return NextResponse.json({
        results,
        meta: {
          query: body.query,
          limit,
          count: results.length,
          engine: 'bounty-search-view-v1',
        },
      });
    }

    const results = await hybridSearch({
      query: body.query.trim(),
      limit,
      minScore: body.minScore,
      discipline: body.discipline,
      skills: Array.isArray(body.skills) ? body.skills : undefined,
      verifiedOnly: body.verifiedOnly === true,
      expandSynonyms: body.expandSynonyms !== false,
    });

    return NextResponse.json({
      results,
      meta: {
        query: body.query,
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
