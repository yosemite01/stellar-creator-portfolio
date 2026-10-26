import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { getSuggestedCreators, matchCreatorsForBounty, TOP_MATCHES } from '@/lib/match-creators';

export const runtime = 'nodejs';

const bountyIdSchema = z.string().cuid();

type RouteContext = {
  params: Promise<{ id: string }>;
};

type AuthResult =
  | { ok: true; bountyId: string }
  | { ok: false; response: NextResponse };

/**
 * Suggested matches are derived from private bounty details. Only the bounty
 * owner (creatorId) and admins may read or trigger them.
 */
async function authorizeBountyReader(id: string): Promise<AuthResult> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const parsed = bountyIdSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid bounty id' }, { status: 400 }) };
  }

  const bounty = await prisma.bounty.findUnique({
    where: { id: parsed.data },
    select: { id: true, creatorId: true },
  });
  if (!bounty) {
    return { ok: false, response: NextResponse.json({ error: 'Bounty not found' }, { status: 404 }) };
  }

  const isOwner = bounty.creatorId === session.user.id;
  const isAdmin = session.user.role === 'ADMIN';
  if (!isOwner && !isAdmin) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { ok: true, bountyId: bounty.id };
}

/**
 * GET /api/bounties/[id]/suggested-creators
 * Returns the top matching creators for the bounty owner or an admin.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const auth = await authorizeBountyReader(id);
  if (!auth.ok) return auth.response;

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || TOP_MATCHES, 1), 50) : TOP_MATCHES;

  const suggestions = await getSuggestedCreators(auth.bountyId, limit);
  return NextResponse.json({ bountyId: auth.bountyId, count: suggestions.length, suggestions });
}

/**
 * POST /api/bounties/[id]/suggested-creators
 * Runs matching for a bounty the caller owns and notifies the top creators.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const auth = await authorizeBountyReader(id);
  if (!auth.ok) return auth.response;

  const suggestions = await matchCreatorsForBounty(auth.bountyId);
  return NextResponse.json({
    bountyId: auth.bountyId,
    notified: suggestions.length,
    suggestions,
  });
}
