import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { queueDigestEmails } from '@/server/services/notifications/digest-service';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/cron/notification-digest?frequency=daily|weekly
 *
 * Queues digest emails (unread in-app notifications rolled up into one
 * email) for every user whose NotificationPreference.digestFrequency
 * matches. Intended to be triggered once a day with `frequency=daily` and
 * once a week with `frequency=weekly` by an external cron service (e.g.
 * Vercel Crons, EasyCron) — same pattern as the existing kyc-cleanup and
 * corridor-aggregation cron routes.
 *
 * Authorization: Requires valid cron secret in X-Cron-Secret header.
 */
export async function POST(req: NextRequest) {
  // Constant-time comparison — see kyc-cleanup/route.ts for why a plain
  // !== comparison here would leak timing information about the secret.
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

  const frequencyParam = req.nextUrl.searchParams.get('frequency');
  const frequency = frequencyParam === 'weekly' ? 'WEEKLY' : frequencyParam === 'daily' ? 'DAILY' : null;

  if (!frequency) {
    return NextResponse.json(
      { error: "frequency query param must be 'daily' or 'weekly'" },
      { status: 422 },
    );
  }

  try {
    const result = await queueDigestEmails(frequency);
    logger.info('Notification digest queued', { frequency, queued: result.queued, skipped: result.skipped });
    return NextResponse.json({ success: true, frequency, ...result }, { status: 200 });
  } catch (error) {
    logger.error('Notification digest cron job failed', { err: String(error) });
    return NextResponse.json(
      { error: 'Failed to queue notification digests', details: String(error) },
      { status: 500 },
    );
  }
}
