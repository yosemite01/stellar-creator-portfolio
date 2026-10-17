import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const evidenceUploadSchema = z
  .object({
    fileUrl: z.string().url().max(2000).optional(),
    fileName: z.string().min(1).max(500).optional(),
    fileSize: z.number().int().min(1).max(50 * 1024 * 1024).optional(),
    mimeType: z.string().min(1).max(200).optional(),
    message: z.string().min(1).max(10000).optional(),
    messageId: z.string().max(120).optional(),
  })
  .refine(
    (data) => Boolean(data.fileUrl || data.message),
    'At least a file or a message is required for dispute evidence'
  );

/**
 * GET /api/disputes/:id/evidence
 * Fetch evidence (files and linked messages) for a dispute.
 * Visibility: Only dispute parties (creator, client) and admins can view.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  const role = (session?.user as { role?: string })?.role;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: disputeId } = await params;
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }

  const isParty = dispute.creatorId === userId || dispute.clientId === userId;
  const isAdmin = role === 'ADMIN';

  if (!isParty && !isAdmin) {
    return NextResponse.json(
      { error: 'Forbidden: You do not have access to evidence for this dispute' },
      { status: 403 }
    );
  }

  const evidence = await prisma.disputeEvidence.findMany({
    where: { disputeId },
    orderBy: { createdAt: 'asc' },
    include: {
      uploadedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  });

  return NextResponse.json({ success: true, evidence });
}

/**
 * POST /api/disputes/:id/evidence
 * Submit dispute evidence (file upload metadata and/or linked messages).
 * Visibility & Submission: Allowed by client, creator, or admin.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  const role = (session?.user as { role?: string })?.role;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: disputeId } = await params;
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    return NextResponse.json({ error: 'Dispute not found' }, { status: 404 });
  }

  const isParty = dispute.creatorId === userId || dispute.clientId === userId;
  const isAdmin = role === 'ADMIN';

  if (!isParty && !isAdmin) {
    return NextResponse.json(
      { error: 'Forbidden: Only dispute parties or admins may upload evidence' },
      { status: 403 }
    );
  }

  if (dispute.status !== 'open') {
    return NextResponse.json(
      { error: 'Cannot upload evidence to a closed or resolved dispute' },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parseResult = evidenceUploadSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const data = parseResult.data;

  const evidence = await prisma.disputeEvidence.create({
    data: {
      disputeId,
      uploadedById: userId,
      fileUrl: data.fileUrl ?? null,
      fileName: data.fileName ?? null,
      fileSize: data.fileSize ?? null,
      mimeType: data.mimeType ?? null,
      message: data.message ?? null,
      messageId: data.messageId ?? null,
    },
    include: {
      uploadedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      resource: 'dispute_evidence',
      action: 'upload',
      resourceId: evidence.id,
      status: 'SUCCESS',
      payload: {
        disputeId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        hasMessage: Boolean(data.message),
        messageId: data.messageId,
      },
      requestPath: req.nextUrl.pathname,
      httpMethod: 'POST',
    },
  });

  return NextResponse.json({ success: true, evidence }, { status: 201 });
}
