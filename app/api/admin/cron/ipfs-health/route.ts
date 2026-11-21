import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runPinHealthSweep } from '@/lib/ipfs/health-monitor';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const sweepOptionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  targetRedundancy: z.coerce.number().int().min(1).max(10).optional().default(2),
  timeoutMs: z.coerce.number().int().min(500).max(30_000).optional().default(8_000),
});

function verifyCronSecret(req: NextRequest): boolean {
  const provided = req.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/admin/cron/ipfs-health
 *
 * Periodic IPFS pin health sweep and auto-repin endpoint (#1769).
 * Protected by constant-time `X-Cron-Secret` header validation.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing cron secret' },
      { status: 401 },
    );
  }

  let bodyObj: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      bodyObj = JSON.parse(text) as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = sweepOptionsSchema.safeParse({
    limit: req.nextUrl.searchParams.get('limit') ?? bodyObj.limit,
    targetRedundancy:
      req.nextUrl.searchParams.get('targetRedundancy') ?? bodyObj.targetRedundancy,
    timeoutMs: req.nextUrl.searchParams.get('timeoutMs') ?? bodyObj.timeoutMs,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid sweep options', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const summary = await runPinHealthSweep(parsed.data);
    logger.info('[IPFS Health] Sweep completed', {
      totalChecked: summary.totalChecked,
      healthy: summary.healthy,
      repaired: summary.repaired,
      degraded: summary.degraded,
      unreachable: summary.unreachable,
      repinnedCount: summary.repinnedCount,
    });
    return NextResponse.json({ success: true, ...summary }, { status: 200 });
  } catch (err) {
    logger.error('[IPFS Health] Sweep failed', { err: String(err) });
    return NextResponse.json(
      { error: 'IPFS pin health sweep failed' },
      { status: 500 },
    );
  }
}
