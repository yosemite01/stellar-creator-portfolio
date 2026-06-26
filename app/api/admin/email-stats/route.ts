import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

async function isAdmin(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return false;

  const token = authHeader.replace('Bearer ', '');
  const adminSecret = process.env.ADMIN_API_SECRET;

  if (!adminSecret) return false;

  return token === adminSecret;
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const [
      totalSent,
      totalFailed,
      totalSkipped,
      hardBouncedUsers,
      spamComplaints,
      unsubscribedUsers,
    ] = await Promise.all([
      prisma.emailDeliveryLog.count({
        where: { status: 'SENT' },
      }),
      prisma.emailDeliveryLog.count({
        where: { status: 'FAILED' },
      }),
      prisma.emailDeliveryLog.count({
        where: { status: 'SKIPPED' },
      }),
      prisma.user.count({
        where: { emailBounced: true },
      }),
      prisma.emailDeliveryLog.count({
        where: {
          status: 'SKIPPED',
          errorMessage: { contains: 'complaint' },
        },
      }),
      prisma.notificationPreference.count({
        where: {
          emailBountyAlerts: false,
          emailApplicationUpdates: false,
          emailMessages: false,
          emailMarketing: false,
        },
      }),
    ]);

    const complaintRate = totalSent > 0 ? (spamComplaints / totalSent) * 100 : 0;

    return NextResponse.json({
      totalSent,
      totalFailed,
      totalSkipped,
      totalBounced: hardBouncedUsers,
      totalSpamComplaints: spamComplaints,
      totalUnsubscribed: unsubscribedUsers,
      complaintRatePercent: complaintRate.toFixed(2),
    });
  } catch (error) {
    console.error('Admin email stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
