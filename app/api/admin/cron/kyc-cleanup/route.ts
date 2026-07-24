import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/admin/cron/kyc-cleanup
 *
 * GDPR compliance job for Issue #782: permanently deletes KYC submissions
 * (including encrypted PII) 90 days after upload, regardless of review
 * status. Should be triggered daily by an external cron service (e.g.
 * Vercel Crons, EasyCron).
 *
 * Authorization: Requires valid cron secret in X-Cron-Secret header.
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const validSecret = process.env.CRON_SECRET;

  if (!validSecret || cronSecret !== validSecret) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing cron secret' },
      { status: 401 },
    );
  }

  try {
    const { count } = await prisma.kYCSubmission.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });

    console.log(`KYC cleanup: deleted ${count} expired submission(s)`);
    return NextResponse.json({ success: true, deleted: count }, { status: 200 });
  } catch (error) {
    console.error('KYC cleanup cron job failed:', error);
    return NextResponse.json(
      { error: 'Failed to clean up expired KYC submissions', details: String(error) },
      { status: 500 },
    );
  }
}
