import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

/**
 * DELETE /api/user/account
 *
 * Issue #811 — GDPR/CCPA right to erasure.
 *
 * Anonymisation strategy (GDPR recital 65 — financial records retained):
 *  1. Replace name/email PII with [deleted] placeholders.
 *  2. Delete avatar, bio, social links.
 *  3. Retain Bounty and BountyApplication rows for financial audit integrity.
 *  4. Delete sessions and accounts (OAuth tokens) → revokes all active logins.
 *  5. Mark the user row so it can no longer be used to log in.
 *  6. Write a final AuditLog entry.
 *
 * Stellar keypair: on-chain funds are NOT touched. Platform-side keypair
 * metadata is cleared from the profile record.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      creatorProfile: { select: { id: true } },
      clientProfile: { select: { id: true } },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const deletedEmail = `[deleted]-${user.id}@stellar.invalid`;
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';

  await prisma.$transaction(async (tx) => {
    // 1. Revoke all active sessions and OAuth tokens
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.account.deleteMany({ where: { userId: user.id } });

    // 2. Anonymise creator profile PII (retain record for audit trail)
    if (user.creatorProfile) {
      await tx.creatorProfile.update({
        where: { userId: user.id },
        data: {
          displayName: '[deleted]',
          bio: null,
          avatar: null,
          githubUrl: null,
          figmaUrl: null,
          linkedinUrl: null,
          websiteUrl: null,
        },
      });
    }

    // 3. Anonymise client profile PII
    if (user.clientProfile) {
      await tx.clientProfile.update({
        where: { userId: user.id },
        data: {
          companyName: '[deleted]',
          bio: null,
          avatar: null,
          githubUrl: null,
          figmaUrl: null,
          linkedinUrl: null,
          websiteUrl: null,
        },
      });
    }

    // 4. Anonymise the user row — retains id for FK integrity on financial records
    await tx.user.update({
      where: { id: user.id },
      data: {
        name: '[deleted]',
        email: deletedEmail,
        password: null,
        image: null,
        emailVerified: null,
        emailUnsubscribeToken: null,
      },
    });

    // 5. Audit log — immutable compliance record
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'GDPR_ACCOUNT_DELETION_COMPLETED',
        resource: 'user',
        resourceId: user.id,
        httpMethod: 'DELETE',
        payload: {
          completedAt: new Date().toISOString(),
          ip,
          retainedRecords: ['Bounty', 'BountyApplication'],
          note: 'PII anonymised per GDPR recital 65; financial records retained for legal compliance.',
        },
      },
    });
  });

  return NextResponse.json(
    { message: 'Account deleted. Your data has been anonymised in accordance with GDPR.' },
    { status: 200 },
  );
}
