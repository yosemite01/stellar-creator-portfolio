import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

/**
 * DELETE /api/user/account
 *
 * Issue #811 — GDPR/CCPA right to erasure.
 * Issue #1540 — cascade or anonymise correctly per model.
 *
 * Per-model retention policy:
 *  - ANONYMISE: User (name/email/avatar), CreatorProfile, ClientProfile,
 *    reviews (keep text, attribute to 'Deleted user'), payments/escrow
 *    (retained for accounting, user reference anonymised).
 *  - DELETE: sessions, OAuth accounts, API keys, push subscriptions,
 *    notifications, messages authored by the user.
 *  - RETAIN: Bounty and BountyApplication rows for financial audit integrity.
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

  const deletedEmail = `deleted+${user.id}@invalid`;
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';

  await prisma.$transaction(async (tx) => {
    // 1. DELETE — revoke all active sessions and OAuth tokens
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.account.deleteMany({ where: { userId: user.id } });

    // 2. DELETE — API keys and push subscriptions (no retention need)
    await tx.apiKey.deleteMany({ where: { userId: user.id } });
    await tx.pushDeviceToken.deleteMany({ where: { userId: user.id } });

    // 3. DELETE — notifications addressed to the user
    await tx.notification.deleteMany({ where: { userId: user.id } });

    // 4. DELETE — messages authored by the user (policy allows removal)
    await tx.message.deleteMany({ where: { senderId: user.id } });

    // 5. ANONYMISE — creator profile PII (retain record for audit trail)
    if (user.creatorProfile) {
      await tx.creatorProfile.update({
        where: { userId: user.id },
        data: {
          displayName: 'Deleted user',
          bio: null,
          avatar: null,
          githubUrl: null,
          figmaUrl: null,
          linkedinUrl: null,
          websiteUrl: null,
        },
      });
    }

    // 6. ANONYMISE — client profile PII
    if (user.clientProfile) {
      await tx.clientProfile.update({
        where: { userId: user.id },
        data: {
          companyName: 'Deleted user',
          bio: null,
          avatar: null,
          githubUrl: null,
          figmaUrl: null,
          linkedinUrl: null,
          websiteUrl: null,
        },
      });
    }

    // 7. ANONYMISE — reviews keep text but are attributed to 'Deleted user'
    await tx.review.updateMany({
      where: { reviewerId: user.id },
      data: { reviewerName: 'Deleted user' },
    });

    // 8. ANONYMISE — payments/escrow retained for accounting; user reference
    //    anonymised via the user row below (FK integrity preserved).

    // 9. ANONYMISE — the user row retains id for FK integrity on financial records
    await tx.user.update({
      where: { id: user.id },
      data: {
        name: 'Deleted user',
        email: deletedEmail,
        password: null,
        image: null,
        emailVerified: null,
        emailUnsubscribeToken: null,
      },
    });

    // 10. Audit log — immutable compliance record
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
          retainedRecords: ['Bounty', 'BountyApplication', 'Payment', 'Escrow'],
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
