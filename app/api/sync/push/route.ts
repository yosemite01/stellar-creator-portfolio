import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

interface PushPayload {
  changes: {
    bounties?: {
      created?: Record<string, unknown>[];
      updated?: Record<string, unknown>[];
      deleted?: string[];
    };
    applications?: {
      created?: Record<string, unknown>[];
      updated?: Record<string, unknown>[];
      deleted?: string[];
    };
    messages?: {
      created?: Record<string, unknown>[];
      updated?: Record<string, unknown>[];
      deleted?: string[];
    };
  };
  lastPulledAt?: number;
}

/**
 * POST /api/sync/push
 *
 * Applies client changes to server database using server-wins conflict resolution.
 * If server record updated_at > client record updated_at, ignores client change.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const payload: PushPayload = await req.json();
    const { changes } = payload;

    // Process bounty changes (only allow creator to update/delete)
    if (changes.bounties) {
      // Created bounties
      for (const bounty of changes.bounties.created || []) {
        const bountyData = bounty as any;
        await prisma.bounty.create({
          data: {
            id: bountyData.id || undefined, // Auto-generate if not provided
            title: String(bountyData.title),
            description: String(bountyData.description),
            budget: Number(bountyData.budget),
            deadline: new Date(bountyData.deadline),
            status: bountyData.status || 'OPEN',
            category: bountyData.category || null,
            tags: Array.isArray(bountyData.tags) ? bountyData.tags : [],
            creatorId: userId,
          },
        });
      }

      // Updated bounties - server-wins: check if server version is newer
      for (const bounty of changes.bounties.updated || []) {
        const bountyData = bounty as any;
        const serverBounty = await prisma.bounty.findUnique({
          where: { id: bountyData.id },
        });

        if (serverBounty && serverBounty.creatorId === userId) {
          const serverUpdated = serverBounty.updatedAt.getTime();
          const clientUpdated = new Date(bountyData.updated_at).getTime();

          // Only update if client is newer (server-wins on tie)
          if (clientUpdated > serverUpdated) {
            await prisma.bounty.update({
              where: { id: bountyData.id },
              data: {
                title: String(bountyData.title),
                description: String(bountyData.description),
                budget: Number(bountyData.budget),
                deadline: new Date(bountyData.deadline),
                status: bountyData.status,
                category: bountyData.category,
                tags: Array.isArray(bountyData.tags) ? bountyData.tags : [],
              },
            });
          } else if (process.env.DEBUG) {
            console.log(
              `Conflict: skipping bounty ${bountyData.id} (server is newer)`
            );
          }
        }
      }

      // Deleted bounties (soft delete via status)
      for (const bountyId of changes.bounties.deleted || []) {
        const bounty = await prisma.bounty.findUnique({
          where: { id: bountyId },
        });

        if (bounty && bounty.creatorId === userId) {
          // Mark as cancelled instead of hard delete
          await prisma.bounty.update({
            where: { id: bountyId },
            data: { status: 'CANCELLED' },
          });
        }
      }
    }

    // Process application changes
    if (changes.applications) {
      // Created applications
      for (const app of changes.applications.created || []) {
        const appData = app as any;
        await prisma.bountyApplication.create({
          data: {
            id: appData.id || undefined,
            bountyId: String(appData.bounty_id),
            applicantId: userId,
            proposal: String(appData.proposal),
            proposedBudget: Number(appData.proposed_budget),
            timeline: Number(appData.timeline_days),
            status: appData.status || 'PENDING',
          },
        });
      }

      // Updated applications
      for (const app of changes.applications.updated || []) {
        const appData = app as any;
        const serverApp = await prisma.bountyApplication.findUnique({
          where: { id: appData.id },
        });

        if (serverApp && serverApp.applicantId === userId) {
          const serverUpdated = serverApp.updatedAt.getTime();
          const clientUpdated = new Date(appData.updated_at).getTime();

          if (clientUpdated > serverUpdated) {
            await prisma.bountyApplication.update({
              where: { id: appData.id },
              data: {
                proposal: String(appData.proposal),
                proposedBudget: Number(appData.proposed_budget),
                timeline: Number(appData.timeline_days),
                status: appData.status,
              },
            });
          } else if (process.env.DEBUG) {
            console.log(
              `Conflict: skipping application ${appData.id} (server is newer)`
            );
          }
        }
      }

      // Deleted applications
      for (const appId of changes.applications.deleted || []) {
        const app = await prisma.bountyApplication.findUnique({
          where: { id: appId },
        });

        if (app && app.applicantId === userId) {
          // Mark as withdrawn instead of hard delete
          await prisma.bountyApplication.update({
            where: { id: appId },
            data: { status: 'WITHDRAWN' },
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Sync push error:', error);
    return NextResponse.json(
      { error: 'Failed to push changes', details: String(error) },
      { status: 500 }
    );
  }
}
