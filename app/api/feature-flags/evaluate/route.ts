/**
 * GET /api/feature-flags/evaluate?flag=<name>&userId=<id>
 *
 * Edge-compatible flag evaluation endpoint.
 * Returns { enabled: boolean } with 60s cache-control header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { evaluateFlag } from '@/lib/feature-flags/service';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { requireAuth } from '@/server/services/authorization';

export const runtime = 'nodejs'; // needs Prisma + Redis

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const flagName = searchParams.get('flag');

  if (!flagName) {
    return NextResponse.json({ error: 'flag parameter is required' }, { status: 400 });
  }

  // Build context from session + query params
  const session = await getServerSession(authOptions);
  const userId = session?.user
    ? (session.user as { id?: string }).id
    : searchParams.get('userId') ?? undefined;

  // If user is present in session, require authentication
  if (userId) {
    requireAuth({ user: session?.user });
  }

  const ctx = {
    userId,
    role: (session?.user as { role?: string })?.role,
    platform: (searchParams.get('platform') as 'ios' | 'android' | 'web') ?? undefined,
  };

  const enabled = await evaluateFlag(flagName, ctx, { logEvaluation: true });

  return NextResponse.json(
    { enabled, flag: flagName },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',
      },
    },
  );
}
