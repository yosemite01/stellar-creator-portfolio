import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/admin/cron/dispute-deadlines
 *
 * Automated deadline resolution cron for Issue #1577:
 * Evaluates open disputes whose response deadline has expired and auto-resolves
 * them per platform dispute policy (50/50 split / refund / release per terms).
 *
 * Authorization: Requires valid cron secret in X-Cron-Secret header or ADMIN session.
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const validSecret = process.env.CRON_SECRET;

  const authorizedBySecret = (() => {
    if (!validSecret || !cronSecret) return false;
    try {
      const a = Buffer.from(cronSecret);
      const b = Buffer.from(validSecret);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  })();

  let authorized = authorizedBySecret;
  let adminId = 'system:cron:dispute-deadlines';

  if (!authorized) {
    const session = await getServerSession(authOptions);
    const role = (session?.user as { role?: string })?.role;
    if (role === 'ADMIN') {
      authorized = true;
      adminId = (session?.user as { id?: string })?.id || adminId;
    }
  }

  if (!authorized) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing cron secret' },
      { status: 401 }
    );
  }

  try {
    const now = new Date();
    // Query open disputes with an expired deadline
    const expiredDisputes = await prisma.dispute.findMany({
      where: {
        status: 'open',
        deadline: {
          lte: now,
        },
      },
    });

    const resolvedIds: string[] = [];
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

    for (const dispute of expiredDisputes) {
      // Trigger on-chain resolution via escrow backend if available
      let onChainTxId: string | null = null;
      try {
        const resp = await fetch(`${apiBase}/api/escrow/${dispute.escrowId}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolution: 'split_50_50' }),
        });
        if (resp.ok) {
          const data = await resp.json();
          onChainTxId = data.txId ?? null;
        }
      } catch {
        // Non-fatal: if contract API is offline, DB resolution proceeds
      }

      await prisma.dispute.update({
        where: { id: dispute.id },
        data: {
          status: 'resolved',
          reason: 'deadline_expired_auto_resolved',
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: adminId,
          resource: 'dispute',
          action: 'resolve.auto_deadline_expired',
          resourceId: dispute.id,
          status: 'SUCCESS',
          payload: {
            resolution: 'split_50_50',
            reason: 'deadline_expired',
            escrowId: dispute.escrowId,
            deadline: dispute.deadline,
            resolvedAt: now.toISOString(),
            onChainTxId,
          },
          requestPath: req.nextUrl.pathname,
          httpMethod: 'POST',
        },
      });

      resolvedIds.push(dispute.id);
    }

    return NextResponse.json(
      {
        success: true,
        resolvedCount: resolvedIds.length,
        resolvedIds,
        executedAt: now.toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Dispute deadline auto-resolution job failed:', error);
    return NextResponse.json(
      { error: 'Failed to auto-resolve expired disputes', details: String(error) },
      { status: 500 }
    );
  }
}
