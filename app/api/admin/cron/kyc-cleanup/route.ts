import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

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
  // Constant-time comparison (mirrors the fix in the corridor-aggregation
  // cron route): a plain !== comparison leaks timing information about how
  // many leading characters of a guess match, letting the secret be
  // recovered incrementally by a network-positioned attacker.
  const cronSecret = req.headers.get('x-cron-secret');
  const validSecret = process.env.CRON_SECRET;

  const authorized = (() => {
    if (!validSecret || !cronSecret) return false;
    try {
      const a = Buffer.from(cronSecret);
      const b = Buffer.from(validSecret);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  })();

  if (!authorized) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing cron secret' },
      { status: 401 },
    );
  }

  try {
    const { count } = await prisma.kYCSubmission.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });

    logger.info('KYC cleanup complete', { deleted: count });
    return NextResponse.json({ success: true, deleted: count }, { status: 200 });
  } catch (error) {
    logger.error('KYC cleanup cron job failed', { err: String(error) });
    return NextResponse.json(
      { error: 'Failed to clean up expired KYC submissions', details: String(error) },
      { status: 500 },
    );
  }
}
