import { NextRequest, NextResponse } from 'next/server';

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { getSuggestedCreators, matchCreatorsForBounty, TOP_MATCHES } from '@/lib/match-creators';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function checkBountyAccess(bountyId: string) {
  if (!bountyId || typeof bountyId !== 'string' || !bountyId.trim()) {
    return { error: 'Invalid bounty ID', status: 400 };
  }

  const session = await getServerSession();
  if (!session?.user?.id) {
    return { error: 'Unauthorized', status: 401 };
  }

  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId },
    select: { id: true, creatorId: true },
  });

  if (!bounty) {
    return { error: 'Bounty not found', status: 404 };
  }

  const isOwner = bounty.creatorId === session.user.id;
  const isAdmin = session.user.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    return { error: 'Forbidden', status: 403 };
  }

  return { success: true };
}

/**
 * GET /api/bounties/[id]/suggested-creators
 * Returns the top matching creators for the bounty (read-only) for the
 * "Suggested Freelancers" sidebar. Restricted to the bounty owner or admins.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const access = await checkBountyAccess(id);
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || TOP_MATCHES, 1), 50) : TOP_MATCHES;

  const suggestions = await getSuggestedCreators(id, limit);
  return NextResponse.json({ bountyId: id, count: suggestions.length, suggestions });
}

/**
 * POST /api/bounties/[id]/suggested-creators
 * Runs matching for a newly created bounty and notifies the top creators via a
 * MatchNotification. Intended to be called right after a bounty is created.
 * Restricted to the bounty owner or admins.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const access = await checkBountyAccess(id);
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const suggestions = await matchCreatorsForBounty(id);
  return NextResponse.json({
    bountyId: id,
    notified: suggestions.length,
    suggestions,
  });
}
