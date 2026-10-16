import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { aggregateCorridorPayments } from '@/server/services/corridor-analytics';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/cron/corridor-aggregation
 *
 * Background cron job for aggregating Stellar corridor payments.
 * Should be triggered every 5 minutes by an external cron service (e.g., Vercel Crons, EasyCron).
 *
 * Authorization: Requires valid cron secret in X-Cron-Secret header
 */
export async function POST(req: NextRequest) {
  // Verify cron secret using a constant-time comparison to prevent timing
  // side-channel attacks. A plain !== comparison leaks information about how
  // many leading characters of a guess match, allowing incremental recovery
  // of the secret by a network-positioned attacker.
  const cronSecret = req.headers.get('x-cron-secret');
  const validSecret = process.env.CRON_SECRET;

  const authorized = (() => {
    if (!validSecret || !cronSecret) return false;
    try {
      const a = Buffer.from(cronSecret);
      const b = Buffer.from(validSecret);
      // timingSafeEqual requires equal-length buffers; length mismatch itself
      // is not secret, so the early-return here is safe.
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  })();

  if (!authorized) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing cron secret' },
      { status: 401 }
    );
  }

  try {
    logger.info('Starting corridor payment aggregation');
    await aggregateCorridorPayments();
    return NextResponse.json(
      { success: true, message: 'Corridor payments aggregated successfully' },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Cron job failed', { err: String(error) });
    return NextResponse.json(
      { error: 'Failed to aggregate corridor payments', details: String(error) },
      { status: 500 }
    );
  }
}
