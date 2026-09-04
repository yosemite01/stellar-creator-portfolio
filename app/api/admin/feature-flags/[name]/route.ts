/**
 * Admin Feature Flag Detail API — /api/admin/feature-flags/[name]
 *
 * GET    → flag + analytics
 * PATCH  → partial update (toggle, rollout%, segment)
 * DELETE → delete + cache invalidation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import {
  getFlagWithAnalytics,
  upsertFlag,
  invalidateFlagCache,
} from '@/lib/feature-flags/service';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

async function requireAdmin(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string })?.role;
  if (!session || role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

const patchSchema = z.object({
  enabled:        z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
  userSegment:    z.record(z.unknown()).nullable().optional(),
  description:    z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { name } = await params;
  const flag = await getFlagWithAnalytics(name);
  if (!flag) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(flag);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { name } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const flag = await upsertFlag({ name, ...parsed.data });
  return NextResponse.json(flag);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { name } = await params;
  await prisma.featureFlag.delete({ where: { name } });
  await invalidateFlagCache(name);

  return NextResponse.json({ deleted: true });
}
