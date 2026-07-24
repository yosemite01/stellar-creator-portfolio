import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createHash } from 'crypto';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';
import { verifyKycOnChain } from '@/backend/services/identity-contract';

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

  const body = await req.json();
  const { decision, reason } = body as { decision?: string; reason?: string };

  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
  }
  if (decision === 'reject' && !reason) {
    return NextResponse.json({ error: 'reason is required to reject a submission' }, { status: 400 });
  }

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
    const txHash = await verifyKycOnChain(submission.user.walletAddress, submissionIdHash);
    await prisma.kYCSubmission.update({
      where: { id: submission.id },
      data: { verifiedOnChain: true, txHash },
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
