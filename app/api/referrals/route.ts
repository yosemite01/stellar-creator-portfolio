import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import {
  generateReferralCode,
  getReferralHistory,
  getReferralStats,
  getUserCode,
  trackReferral,
} from '@/lib/services/referral-service';
import { checkRate, clientIp } from '@/server/api/rate-limit';

/**
 * GET  /api/referrals?action=code|stats|history   the caller's own referral data
 * POST /api/referrals                              record that the caller was referred
 *
 * Backed by lib/services/referral-service. Both methods require a session;
 * a referral is always recorded for the signed-in user, never for an id the
 * client supplies, so one account cannot farm referral rewards for others.
 */

const READS_PER_MINUTE = 30;
const TRACKS_PER_MINUTE = 10;

const trackSchema = z.object({
  code: z.string().trim().min(1).max(64),
  event: z.enum(['signup', 'first_project', 'first_hire']),
});

function tooManyRequests(retryAfter: number) {
  return NextResponse.json(
    { error: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const limit = checkRate(`referrals:read:${userId}`, READS_PER_MINUTE, 60);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  const action = req.nextUrl.searchParams.get('action') ?? 'code';
  switch (action) {
    case 'code':
      return NextResponse.json(getUserCode(userId) ?? generateReferralCode(userId));
    case 'stats':
      return NextResponse.json(getReferralStats(userId));
    case 'history':
      return NextResponse.json({ referrals: getReferralHistory(userId) });
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = checkRate(`referrals:track:${session.user.id}`, TRACKS_PER_MINUTE, 60);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid referral event' }, { status: 400 });
  }

  const result = trackReferral({
    code: parsed.data.code,
    event: parsed.data.event,
    referredUserId: session.user.id,
    ipAddress: clientIp(req.headers),
  });

  if (!result.success) {
    const status = result.reason === 'invalid_code' ? 404 : result.reason === 'duplicate' ? 409 : 422;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ referral: result.record }, { status: 201 });
}
