import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { encryptField } from '@/lib/kyc-encryption';
import { KYCDocumentType } from '@prisma/client';

/**
 * POST /api/kyc/submit
 *
 * Accepts OCR-extracted document fields from the mobile app's
 * `OCRKYCService` scan flow and creates (or replaces, if previously
 * rejected) the caller's `KYCSubmission` record. Extracted PII is encrypted
 * before it ever reaches the database (Issue #782).
 *
 * Body:
 *   documentType: "PASSPORT" | "DRIVER_LICENSE" | "NATIONAL_ID"
 *   name, dateOfBirth, idNumber: strings extracted client-side by OCR
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { documentType, name, dateOfBirth, idNumber } = body as {
    documentType?: string;
    name?: string;
    dateOfBirth?: string;
    idNumber?: string;
  };

  if (
    !documentType ||
    !(documentType in KYCDocumentType) ||
    !name ||
    !dateOfBirth ||
    !idNumber
  ) {
    return NextResponse.json(
      { error: 'documentType, name, dateOfBirth, and idNumber are required' },
      { status: 400 },
    );
  }

  const existing = await prisma.kYCSubmission.findUnique({
    where: { userId: session.user.id },
  });
  if (existing && existing.status !== 'REJECTED') {
    return NextResponse.json(
      { error: `A KYC submission already exists with status ${existing.status}` },
      { status: 409 },
    );
  }

  const [encryptedName, encryptedDOB, encryptedIdNumber] = await Promise.all([
    encryptField(name),
    encryptField(dateOfBirth),
    encryptField(idNumber),
  ]);

  const uploadedAt = new Date();
  const expiresAt = new Date(uploadedAt.getTime() + 90 * 24 * 60 * 60 * 1000);

  const submission = await prisma.kYCSubmission.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      documentType: documentType as KYCDocumentType,
      uploadedAt,
      expiresAt,
      encryptedName,
      encryptedDOB,
      encryptedIdNumber,
      status: 'PENDING',
    },
    update: {
      documentType: documentType as KYCDocumentType,
      uploadedAt,
      expiresAt,
      encryptedName,
      encryptedDOB,
      encryptedIdNumber,
      status: 'PENDING',
      adminReviewedBy: null,
      adminReviewedAt: null,
      rejectionReason: null,
      verifiedOnChain: false,
      txHash: null,
    },
  });

  return NextResponse.json({ id: submission.id, status: submission.status });
}
