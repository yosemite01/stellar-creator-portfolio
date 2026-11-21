import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/db';
import { revalidateBounties } from '@/lib/cache/revalidate';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/bounties/[id]/apply
 *
 * Apply to a bounty — solo, or as a team/agency (issue #1610) by including
 * `teamId` for a team created via POST /api/teams. There was no dedicated
 * web endpoint for this before (the only existing path that wrote
 * `BountyApplication` rows was the mobile offline-sync endpoint,
 * app/api/sync/push, which trusts client-supplied fields with minimal
 * validation); this one validates the bounty is actually open and, for a
 * team application, that the caller is a member of that team.
 */

const applySchema = z.object({
  proposal: z.string().trim().min(1).max(5000),
  proposedBudget: z.number().int().positive(),
  timeline: z.number().int().positive().max(365),
  teamId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest, context: RouteContext) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: bountyId } = await context.params;

  const json = await req.json().catch(() => null);
  const parsed = applySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { proposal, proposedBudget, timeline, teamId } = parsed.data;

  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId },
    select: { id: true, status: true, creatorId: true },
  });
  if (!bounty) {
    return NextResponse.json({ error: 'Bounty not found' }, { status: 404 });
  }
  if (bounty.status !== 'OPEN') {
    return NextResponse.json({ error: 'This bounty is not open for applications' }, { status: 400 });
  }
  if (bounty.creatorId === session.user.id) {
    return NextResponse.json({ error: 'You cannot apply to your own bounty' }, { status: 400 });
  }

  if (teamId) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, ownerId: true, members: { select: { userId: true } } },
    });
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    const isMember = team.ownerId === session.user.id || team.members.some((m) => m.userId === session.user.id);
    if (!isMember) {
      return NextResponse.json({ error: 'You are not a member of this team' }, { status: 403 });
    }
  }

  try {
    const application = await prisma.bountyApplication.create({
      data: {
        bountyId,
        applicantId: session.user.id,
        proposal,
        proposedBudget,
        timeline,
        teamId: teamId ?? null,
      },
      include: teamId ? { team: { include: { members: true } } } : undefined,
    });
    void revalidateBounties(bountyId);
    return NextResponse.json(application, { status: 201 });
  } catch (error: unknown) {
    // Unique(bountyId, applicantId) — already applied to this bounty.
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return NextResponse.json({ error: 'You have already applied to this bounty' }, { status: 409 });
    }
    console.error('Bounty application error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
