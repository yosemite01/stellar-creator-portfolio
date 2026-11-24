import type { Prisma } from '@/lib/generated/prisma/client';
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

/**
 * Returns the authenticated admin's id on success, or a 403 response to
 * return immediately. Callers need the admin's id to attribute the
 * AuditLog entry written below (#1614) — who changed a feature flag, not
 * just that it changed.
 */
async function requireAdmin(
  req: NextRequest,
): Promise<{ error: NextResponse; adminId?: undefined } | { error?: undefined; adminId: string }> {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string })?.role;
  const adminId = (session?.user as { id?: string })?.id;
  if (!session || role !== 'ADMIN' || !adminId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { adminId };
}

const patchSchema = z.object({
  enabled:        z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
  userSegment:    z.record(z.string(), z.unknown()).nullable().optional(),
  description:    z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

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
  if (auth.error) return auth.error;

  const { name } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Captured before the write so the audit entry records what actually
  // changed, not just the requested patch (#1614) — e.g. a PATCH that only
  // sends `{ enabled: true }` when the flag was already enabled shouldn't
  // read back as a no-op change in the log.
  const before = await prisma.featureFlag.findUnique({ where: { name } });

  const flag = await upsertFlag({ name, ...parsed.data });

  await prisma.auditLog.create({
    data: {
      userId: auth.adminId,
      resource: 'feature_flag',
      action: before ? 'update' : 'create',
      resourceId: flag.id,
      status: 'SUCCESS',
      // Round-trip through JSON so nested nulls/unknowns are plain JSON values.
      payload: JSON.parse(JSON.stringify({
        name,
        requested: parsed.data,
        before: before
          ? {
              enabled: before.enabled,
              rolloutPercent: before.rolloutPercent,
              userSegment: before.userSegment,
              description: before.description,
            }
          : null,
        after: {
          enabled: flag.enabled,
          rolloutPercent: flag.rolloutPercent,
          userSegment: flag.userSegment,
          description: flag.description,
        },
      })) as Prisma.InputJsonValue,
      requestPath: req.nextUrl.pathname,
      httpMethod: 'PATCH',
    },
  });

  return NextResponse.json(flag);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { name } = await params;

  const deleted = await prisma.featureFlag.delete({ where: { name } }).catch(() => null);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await invalidateFlagCache(name);

  await prisma.auditLog.create({
    data: {
      userId: auth.adminId,
      resource: 'feature_flag',
      action: 'delete',
      resourceId: deleted.id,
      status: 'SUCCESS',
      payload: {
        name,
        deleted: {
          enabled: deleted.enabled,
          rolloutPercent: deleted.rolloutPercent,
          userSegment: deleted.userSegment,
          description: deleted.description,
        },
      },
      requestPath: req.nextUrl.pathname,
      httpMethod: 'DELETE',
    },
  });

  return NextResponse.json({ deleted: true });
}
