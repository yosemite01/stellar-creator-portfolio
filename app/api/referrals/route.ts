import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  generateReferralCode,
  trackReferral,
  convertReferral,
  markRewarded,
  flagReferral,
  getReferralStats,
  getReferralHistory,
  ReferralEventType,
} from '@/lib/services/referral-service';
import { z } from 'zod';
import { validateRequest, formatZodErrors } from '@/lib/validators';

// ─── Rate limiting ────────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string, max = 30): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + 60_000 });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}

function getIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const trackSchema = z.object({
  code:           z.string().min(1).max(20),
  referredUserId: z.string().min(1),
  event:          z.enum(['signup', 'first_project', 'first_hire'] as const),
});

const actionSchema = z.object({
  referralId: z.string().min(1),
  action:     z.enum(['convert', 'reward', 'flag']),
});

// ─── GET /api/referrals?action=code|stats|history ────────────────────────────

export async function GET(request: NextRequest) {
  const ip = getIp(request);
  if (!checkRateLimit(ip, 60)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const action = new URL(request.url).searchParams.get('action') ?? 'code';

  switch (action) {
    case 'code': {
      const code = generateReferralCode(session.user.id);
      const referralUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/register?ref=${code.code}`;
      return NextResponse.json({ code, referralUrl });
    }
    case 'stats':
      return NextResponse.json({ stats: getReferralStats(session.user.id) });
    case 'history':
      return NextResponse.json({ history: getReferralHistory(session.user.id) });
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}

// ─── POST /api/referrals ──────────────────────────────────────────────────────
// Body: { code, referredUserId, event }          → track a referral
// Body: { referralId, action: convert|reward|flag } → admin/system actions

export async function POST(request: NextRequest) {
  const ip = getIp(request);
  if (!checkRateLimit(ip, 10)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Admin actions (convert / reward / flag)
  const adminParse = actionSchema.safeParse(body);
  if (adminParse.success) {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { referralId, action } = adminParse.data;
    const handlers = { convert: convertReferral, reward: markRewarded, flag: flagReferral };
    const updated = handlers[action](referralId);
    if (!updated) return NextResponse.json({ error: 'Referral not found or invalid state' }, { status: 404 });
    return NextResponse.json({ referral: updated });
  }

  // Track referral (public — called during registration)
  const validation = validateRequest(trackSchema, body);
  if (!validation.success) {
    return NextResponse.json({ error: 'Validation failed', details: formatZodErrors(validation.errors) }, { status: 400 });
  }

  const result = trackReferral({
    code:           validation.data.code,
    referredUserId: validation.data.referredUserId,
    event:          validation.data.event as ReferralEventType,
    ipAddress:      ip,
  });

  if (!result.success) {
    const statusMap = { invalid_code: 404, self_referral: 422, duplicate: 409, fraud: 429 } as const;
    return NextResponse.json({ error: result.reason }, { status: statusMap[result.reason] });
  }

  return NextResponse.json({ referral: result.record }, { status: 201 });
}
