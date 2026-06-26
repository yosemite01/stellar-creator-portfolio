import { NextRequest, NextResponse } from 'next/server';

import { getSuggestedCreators, matchCreatorsForBounty, TOP_MATCHES } from '@/lib/match-creators';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/bounties/[id]/suggested-creators
 * Returns the top matching creators for the bounty (read-only) for the
 * "Suggested Freelancers" sidebar.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || TOP_MATCHES, 1), 50) : TOP_MATCHES;

  const suggestions = await getSuggestedCreators(id, limit);
  return NextResponse.json({ bountyId: id, count: suggestions.length, suggestions });
}

/**
 * POST /api/bounties/[id]/suggested-creators
 * Runs matching for a newly created bounty and notifies the top creators via a
 * MatchNotification. Intended to be called right after a bounty is created.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const suggestions = await matchCreatorsForBounty(id);
  return NextResponse.json({
    bountyId: id,
    notified: suggestions.length,
    suggestions,
  });
}
