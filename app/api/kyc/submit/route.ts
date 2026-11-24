import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { encryptFieldsWithEnvelope } from '@/lib/kyc-envelope-encryption';
import { KYCDocumentType } from '@prisma/client';
import { z } from 'zod';

/**
 * POST /api/kyc/submit
 *
 * Accepts OCR-extracted document fields from the mobile app's
 * `OCRKYCService` scan flow and creates (or replaces, if previously
 * rejected) the caller's `KYCSubmission` record. Extracted PII is encrypted
 * with envelope encryption before it ever reaches the database.
 *
 * Envelope encryption provides:
 * - Per-record DEK (Data Encryption Key) for each submission
 * - KMS CMK encryption of DEKs
 * - Key versioning for rotation support
 * - AAD binding for tamper detection (user ID + field name)
 *
 * Body:
 *   documentType: "PASSPORT" | "DRIVER_LICENSE" | "NATIONAL_ID"
 *   name, dateOfBirth, idNumber: strings extracted client-side by OCR
 *   country: ISO-3166 alpha-2 country code
 *   documentImage: optional base64-encoded document image
 */

const MAX_DOCUMENT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const ISO_3166_ALPHA2 = /^[A-Z]{2}$/;

const DOCUMENT_NUMBER_PATTERNS: Record<KYCDocumentType, RegExp> = {
  PASSPORT: /^[A-Z0-9]{6,9}$/,
  DRIVER_LICENSE: /^[A-Z0-9]{5,20}$/,
  NATIONAL_ID: /^[A-Z0-9]{5,20}$/,
};

const documentTypeSchema = z.enum(
  Object.values(KYCDocumentType) as [KYCDocumentType, ...KYCDocumentType[]],
);

const documentImageSchema = z
  .object({
    mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES as [string, ...string[]]),
    data: z.string().min(1),
  })
  .superRefine((image, ctx) => {
    const base64 = image.data.replace(/^data:[^;]+;base64,/, '');
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > MAX_DOCUMENT_IMAGE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data'],
        message: `Document image must be at most ${MAX_DOCUMENT_IMAGE_BYTES} bytes`,
      });
    }
  });

const kycSubmitSchema = z
  .object({
    documentType: documentTypeSchema,
    name: z.string().trim().min(1).max(200),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be YYYY-MM-DD')
      .refine((value) => {
        const dob = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(dob.getTime())) return false;
        const now = new Date();
        let age = now.getUTCFullYear() - dob.getUTCFullYear();
        const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
        if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
          age -= 1;
        }
        return age >= 18;
      }, 'Applicant must be at least 18 years old'),
    country: z.string().regex(ISO_3166_ALPHA2, 'country must be an ISO-3166 alpha-2 code'),
    idNumber: z.string().trim().min(1).max(64),
    documentImage: documentImageSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const pattern = DOCUMENT_NUMBER_PATTERNS[value.documentType];
    if (pattern && !pattern.test(value.idNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['idNumber'],
        message: `idNumber does not match the expected format for ${value.documentType}`,
      });
    }
  });

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = kycSubmitSchema.safeParse(rawBody);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors },
      { status: 422 },
    );
  }

  const { documentType, name, dateOfBirth, country, idNumber } = parsed.data;

  const existing = await prisma.kYCSubmission.findUnique({
    where: { userId: session.user.id },
  });
  if (existing && existing.status !== 'REJECTED') {
    return NextResponse.json(
      { error: `A KYC submission already exists with status ${existing.status}` },
      { status: 409 },
    );
  }

  // Encrypt PII fields with envelope encryption
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const encryptedFields = await encryptFieldsWithEnvelope(
    {
      name,
      dateOfBirth,
      idNumber,
    },
    userId,
  );

  const submission = await prisma.kYCSubmission.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      documentType,
      uploadedAt: now,
      expiresAt,
      encryptedName: encryptedFields.name!,
      encryptedDOB: encryptedFields.dateOfBirth!,
      encryptedIdNumber: encryptedFields.idNumber!,
      status: 'PENDING',
      // Key metadata for envelope encryption
      keyId: 'default', // Will be updated by background job
      keyVersion: 'v1',
    },
    update: {
      documentType,
      uploadedAt: now,
      expiresAt,
      encryptedName: encryptedFields.name!,
      encryptedDOB: encryptedFields.dateOfBirth!,
      encryptedIdNumber: encryptedFields.idNumber!,
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
