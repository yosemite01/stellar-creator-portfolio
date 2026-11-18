import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createHash } from 'crypto';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';
import { verifyKycOnChain } from '@/server/services/identity-contract';
import { writeAuditLog } from '@/server/services/audit';

/**
 * POST /api/admin/kyc/[id]/review
 *
 * Approve or reject a pending KYC submission (Issue #782).
 *
 * Body: { decision: "approve" | "reject", reason?: string }
 *
 * On approve: marks the submission APPROVED, flips `CreatorProfile.verified`,
 * and calls the identity contract's `verify_kyc` on-chain — the submission
 * is still marked APPROVED even if the on-chain call fails, since the off-
 * chain review is the source of truth; `verifiedOnChain`/`txHash` simply
 * stay unset until a retry succeeds.
 * On reject: marks REJECTED with the given reason; the user may resubmit.
 */

const reviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().min(10).max(2000).optional(),
  })
  .strict()
  .refine((data) => data.decision !== 'reject' || !!data.reason, {
    message: 'reason is required to reject a submission',
    path: ['reason'],
  });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const adminUser = session?.user as { id?: string; role?: string } | undefined;
  if (!adminUser?.role || adminUser.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await params;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { decision, reason } = parsed.data;

  const submission = await prisma.kYCSubmission.findUnique({
    where: { id },
    include: { user: { select: { id: true, walletAddress: true } } },
  });
  if (!submission) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
  }
  if (submission.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Submission is already ${submission.status}` },
      { status: 409 },
    );
  }

  if (decision === 'reject') {
    const updated = await prisma.kYCSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'REJECTED',
        adminReviewedBy: adminUser.id,
        adminReviewedAt: new Date(),
        rejectionReason: reason,
      },
    });
    await writeAuditLog({
      actorId: adminUser.id,
      action: 'kyc.review.reject',
      targetType: 'KYCSubmission',
      targetId: submission.id,
      before: { status: submission.status },
      after: { status: updated.status, reason },
    });
    return NextResponse.json({ id: updated.id, status: updated.status });
  }

  // Approve
  await prisma.$transaction([
    prisma.kYCSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'APPROVED',
        adminReviewedBy: adminUser.id,
        adminReviewedAt: new Date(),
        rejectionReason: null,
      },
    }),
    prisma.creatorProfile.updateMany({
      where: { userId: submission.userId },
      data: { verified: true },
    }),
  ]);

  await writeAuditLog({
    actorId: adminUser.id,
    action: 'kyc.review.approve',
    targetType: 'KYCSubmission',
    targetId: submission.id,
    before: { status: submission.status },
    after: { status: 'APPROVED', reason: reason ?? null },
  });

  if (!submission.user.walletAddress) {
    return NextResponse.json({
      id: submission.id,
      status: 'APPROVED',
      verifiedOnChain: false,
      warning: 'User has no linked wallet address; on-chain verification skipped',
    });
  }

  try {
    const submissionIdHash = createHash('sha256').update(submission.id).digest();
    // #1811: retried with idempotency; null means the chain already held the
    // attestation (an earlier attempt landed) so no new tx was sent. Throws
    // only when the chain does not reflect it — never mark verified then.
    const txHash = await verifyKycOnChain(submission.user.walletAddress, submissionIdHash);
    await prisma.kYCSubmission.update({
      where: { id: submission.id },
      data: { verifiedOnChain: true, ...(txHash ? { txHash } : {}) },
    });
    return NextResponse.json({ id: submission.id, status: 'APPROVED', verifiedOnChain: true, txHash });
  } catch (error) {
    console.error(`KYC on-chain verification failed for submission ${submission.id}:`, error);
    return NextResponse.json({
      id: submission.id,
      status: 'APPROVED',
      verifiedOnChain: false,
      warning: 'Off-chain approval saved; on-chain verification failed and can be retried',
    });
  }
}
