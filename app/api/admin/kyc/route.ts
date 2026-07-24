import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';
import { decryptField } from '@/lib/kyc-encryption';

/**
 * GET /api/admin/kyc?status=pending&page=1&limit=20
 *
 * Lists KYC submissions for admin review. Only the extracted name is
 * decrypted for display, per Issue #782's "only admin can view extracted
 * data" requirement — DOB and ID number stay encrypted until an admin
 * opens an individual submission (there is no bulk-decrypt endpoint).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string })?.role;
  if (!role || role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const status = (searchParams.get('status') ?? 'PENDING').toUpperCase();
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
  const skip = (page - 1) * limit;

  const where = status === 'ALL' ? {} : { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' };

  const [submissions, total] = await Promise.all([
    prisma.kYCSubmission.findMany({
      where,
      orderBy: { uploadedAt: 'asc' },
      skip,
      take: limit,
      include: { user: { select: { email: true } } },
    }),
    prisma.kYCSubmission.count({ where }),
  ]);

  const decrypted = await Promise.all(
    submissions.map(async (s) => ({
      id: s.id,
      userId: s.userId,
      userEmail: s.user.email,
      documentType: s.documentType,
      uploadedAt: s.uploadedAt,
      expiresAt: s.expiresAt,
      status: s.status,
      name: await decryptField(s.encryptedName).catch(() => '[decryption failed]'),
      adminReviewedBy: s.adminReviewedBy,
      adminReviewedAt: s.adminReviewedAt,
      rejectionReason: s.rejectionReason,
      verifiedOnChain: s.verifiedOnChain,
      txHash: s.txHash,
    })),
  );

  return NextResponse.json({ submissions: decrypted, total, page, limit });
}
