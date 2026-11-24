import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { decryptFieldsWithEnvelope } from '@/lib/kyc-envelope-encryption';

/**
 * GET /api/kyc
 *
 * Returns the current user's KYC submission status and encrypted fields.
 * For admin users, this endpoint can decrypt the PII fields for review.
 *
 * Query params:
 *   - admin: boolean - whether to decrypt fields for admin review
 */

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const isAdmin = session.user.role === 'ADMIN';

  const submission = await prisma.kYCSubmission.findUnique({
    where: { userId: userId },
    select: {
      id: true,
      userId: true,
      documentType: true,
      uploadedAt: true,
      expiresAt: true,
      status: true,
      adminReviewedBy: true,
      adminReviewedAt: true,
      rejectionReason: true,
      encryptedName: true,
      encryptedDOB: true,
      encryptedIdNumber: true,
      keyId: true,
      keyVersion: true,
      verifiedOnChain: true,
      txHash: true,
    },
  });

  if (!submission) {
    return NextResponse.json({ error: 'No KYC submission found' }, { status: 404 });
  }

  // If admin and decryption requested, decrypt the fields
  if (isAdmin) {
    const decryptAdmin = req.nextUrl.searchParams.get('decrypt') === 'true';
    
    if (decryptAdmin) {
      try {
        const decryptedFields = await decryptFieldsWithEnvelope(
          {
            name: submission.encryptedName,
            dateOfBirth: submission.encryptedDOB,
            idNumber: submission.encryptedIdNumber,
          },
          submission.userId,
        );

        return NextResponse.json({
          ...submission,
          name: decryptedFields.name,
          dateOfBirth: decryptedFields.dateOfBirth,
          idNumber: decryptedFields.idNumber,
          encrypted: false,
        });
      } catch (error) {
        return NextResponse.json(
          { error: 'Failed to decrypt KYC fields', details: (error instanceof Error ? error.message : String(error)) },
          { status: 500 },
        );
      }
    }
  }

  // Return encrypted fields
  return NextResponse.json({
    ...submission,
    encrypted: true,
  });
}
