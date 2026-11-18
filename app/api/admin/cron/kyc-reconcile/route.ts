import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { reconcileKycSubmissions } from '@/server/services/identity-sync';
import { identitySyncDeps } from '@/lib/services/identity-sync-deps';

/**
 * POST /api/admin/cron/kyc-reconcile
 *
 * #1811 reconciliation job: compares every KYC submission with the identity
 * contract and repairs drift (missing verify/revoke tx, or a stale
 * `verifiedOnChain` flag). Idempotent; run it on a schedule (e.g. hourly).
 *
 * Authorization: valid cron secret in the X-Cron-Secret header.
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const validSecret = process.env.CRON_SECRET;
  const authorized = (() => {
    if (!validSecret || !cronSecret) return false;
    const a = Buffer.from(cronSecret);
    const b = Buffer.from(validSecret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  })();

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized: Invalid or missing cron secret' }, { status: 401 });
  }

  const counts = await reconcileKycSubmissions(identitySyncDeps);
  logger.info('KYC reconcile finished', counts);
  return NextResponse.json({ ok: true, counts });
}
