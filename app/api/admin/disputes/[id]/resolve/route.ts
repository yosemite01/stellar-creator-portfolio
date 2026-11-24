import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';

const RESOLUTIONS = ['release_to_freelancer', 'refund_to_creator', 'split_50_50'] as const;
type Resolution = (typeof RESOLUTIONS)[number];

const resolveSchema = z
  .object({
    resolution: z.enum(RESOLUTIONS),
    note: z.string().min(10).max(2000).optional(),
    // Optional explicit split amounts (in stroops) for split resolutions.
    splitAmounts: z
      .object({
        freelancer: z.number().int().nonnegative(),
        creator: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * POST /api/admin/disputes/:id/resolve
 * Body: { resolution: Resolution, note?: string, splitAmounts?: { freelancer, creator } }
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { resolution, note, splitAmounts } = parsed.data;

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }
  if (dispute.status !== 'open') {
    return NextResponse.json({ error: 'Dispute is not open' }, { status: 409 });
  }

  // Validate split amounts against the escrow total when provided.
  if (splitAmounts) {
    const escrow = await prisma.escrow.findUnique({
      where: { id: dispute.escrowId },
      select: { amount: true },
    });
    const escrowTotal = Number(escrow?.amount);
    const sum = splitAmounts.freelancer + splitAmounts.creator;
    if (!Number.isFinite(escrowTotal) || sum !== escrowTotal) {
      return NextResponse.json(
        { error: 'Split amounts must sum to the escrow total' },
        { status: 400 }
      );
    }
  }

  const beforeState = {
    status: dispute.status,
    reason: dispute.reason ?? null,
  };

  // Call the on-chain resolve_dispute function via the backend API
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  let onChainTxId: string | null = null;
  try {
    const resp = await fetch(`${apiBase}/api/escrow/${dispute.escrowId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution, splitAmounts: splitAmounts ?? null }),
    });
    if (resp.ok) {
      const data = await resp.json();
      onChainTxId = data.txId ?? null;
    }
  } catch {
    // Non-fatal — backend API may not be running in dev; we still update DB
  }

  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: { status: 'resolved', reason: resolution },
  });

  const afterState = {
    status: updated.status,
    reason: updated.reason ?? null,
  };

  await prisma.auditLog.create({
    data: {
      userId: adminId,
      resource: 'dispute',
      action: `resolve.${resolution}`,
      resourceId: disputeId,
      status: 'SUCCESS',
      payload: {
        resolution,
        note: note ?? null,
        splitAmounts: splitAmounts ?? null,
        onChainTxId,
        escrowId: dispute.escrowId,
        before: beforeState,
        after: afterState,
      },
      requestPath: req.nextUrl.pathname,
      httpMethod: 'POST',
    },
  });

  return NextResponse.json({ ok: true, resolution, onChainTxId });
}
