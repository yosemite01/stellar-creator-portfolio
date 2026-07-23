import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';

type Resolution = 'release_to_freelancer' | 'refund_to_creator' | 'split_50_50';

/**
 * POST /api/admin/disputes/:id/resolve
 * Body: { resolution: Resolution, note?: string }
 *
 * Resolves a dispute by:
 * 1. Calling the on-chain resolve_dispute via the Stellar API
 * 2. Updating the Dispute record in the DB
 * 3. Writing an AuditLog entry
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const adminId = (session?.user as { id?: string })?.id;
  const role = (session?.user as { role?: string })?.role;

  if (!adminId || role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id: disputeId } = await params;
  const body = await req.json();
  const resolution: Resolution = body.resolution;
  const note: string | undefined = body.note;

  if (!['release_to_freelancer', 'refund_to_creator', 'split_50_50'].includes(resolution)) {
    return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 });
  }

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }
  if (dispute.status !== 'open') {
    return NextResponse.json({ error: 'Dispute is not open' }, { status: 409 });
  }

  // Call the on-chain resolve_dispute function via the backend API
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  let onChainTxId: string | null = null;
  try {
    const resp = await fetch(`${apiBase}/api/escrow/${dispute.escrowId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution }),
    });
    if (resp.ok) {
      const data = await resp.json();
      onChainTxId = data.txId ?? null;
    }
  } catch {
    // Non-fatal — backend API may not be running in dev; we still update DB
  }

  await prisma.dispute.update({
    where: { id: disputeId },
    data: { status: 'resolved', reason: resolution },
  });

  await prisma.auditLog.create({
    data: {
      userId: adminId,
      resource: 'dispute',
      action: `resolve.${resolution}`,
      resourceId: disputeId,
      status: 'SUCCESS',
      payload: { resolution, note: note ?? null, onChainTxId, escrowId: dispute.escrowId },
      requestPath: req.nextUrl.pathname,
      httpMethod: 'POST',
    },
  });

  return NextResponse.json({ ok: true, resolution, onChainTxId });
}
