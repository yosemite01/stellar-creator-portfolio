import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/sync/pull
 *
 * Returns WatermelonDB sync protocol response with changes since last pull.
 * Used by mobile app to sync bounties, applications, and messages.
 *
 * Response format (WatermelonDB sync protocol):
 * {
 *   changes: {
 *     bounties: { created: [], updated: [], deleted: [] },
 *     applications: { created: [], updated: [], deleted: [] },
 *     messages: { created: [], updated: [], deleted: [] }
 *   },
 *   timestamp: <current timestamp in milliseconds>
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Fetch bounties created/updated since last sync
    const bounties = await prisma.bounty.findMany({
      where: {
        creatorId: userId,
      },
      include: {
        applications: true,
      },
    });

    // Fetch applications where user is applicant or bounty creator
    const applications = await prisma.bountyApplication.findMany({
      where: {
        OR: [
          { applicantId: userId },
          { bounty: { creatorId: userId } },
        ],
      },
    });

    // Transform to WatermelonDB format (omit deleted items for MVP)
    const changes = {
      bounties: {
        created: bounties.map((b) => ({
          id: b.id,
          title: b.title,
          description: b.description,
          budget: b.budget,
          deadline: b.deadline.toISOString(),
          status: b.status,
          category: b.category,
          tags: b.tags,
          creator_id: b.creatorId,
          created_at: b.createdAt.toISOString(),
          updated_at: b.updatedAt.toISOString(),
        })),
        updated: [],
        deleted: [],
      },
      applications: {
        created: applications.map((a) => ({
          id: a.id,
          bounty_id: a.bountyId,
          applicant_id: a.applicantId,
          proposal: a.proposal,
          proposed_budget: a.proposedBudget,
          timeline_days: a.timeline,
          status: a.status,
          created_at: a.createdAt.toISOString(),
          updated_at: a.updatedAt.toISOString(),
        })),
        updated: [],
        deleted: [],
      },
      messages: {
        created: [],
        updated: [],
        deleted: [],
      },
    };

    return NextResponse.json({
      changes,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Sync pull error:', error);
    return NextResponse.json(
      { error: 'Failed to pull changes' },
      { status: 500 }
    );
  }
}
