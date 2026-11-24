/**
 * Admin Feature Flag API — Issue #837
 *
 * GET    /api/admin/feature-flags          → list all flags
 * POST   /api/admin/feature-flags          → create / update flag
 * GET    /api/admin/feature-flags/[name]   → flag + analytics
 * PATCH  /api/admin/feature-flags/[name]   → partial update (rollout %, toggle)
 * DELETE /api/admin/feature-flags/[name]   → delete flag + cache invalidation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import {
  listFlags,
  upsertFlag,
} from '@/lib/feature-flags/service';
import { z } from 'zod';

// ── Auth guard ────────────────────────────────────────────────────────────────

async function requireAdmin(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string })?.role;
  if (!session || role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const upsertSchema = z.object({
  name:           z.string().min(1).max(100),
  enabled:        z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
  userSegment:    z.record(z.string(), z.unknown()).nullable().optional(),
  description:    z.string().optional(),
});

// ── Handlers ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const flags = await listFlags();
  return NextResponse.json(flags);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const flag = await upsertFlag(parsed.data);
  return NextResponse.json(flag, { status: 201 });
}
