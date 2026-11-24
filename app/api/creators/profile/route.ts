import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { requireAuth } from '@/server/services/authorization';
import { prisma } from '@/lib/db';
import { revalidateCreators } from '@/lib/cache/revalidate';

/**
 * GET  /api/creators/profile   the caller's own availability + rate card
 * PATCH /api/creators/profile  update either, for matching (issue #1609)
 *
 * This is deliberately separate from the public `GET /api/creators/[id]`
 * (which reads static demo data, see lib/services/creators-data.ts) — this
 * route reads/writes the caller's own real `CreatorProfile` row, and only
 * the caller's own: there is no id in the URL, it always resolves from the
 * session.
 */

const updateSchema = z
  .object({
    acceptingWork: z.boolean().optional(),
    hourlyRate: z.number().positive().max(100_000).nullable().optional(),
    projectRateMin: z.number().positive().max(10_000_000).nullable().optional(),
    projectRateMax: z.number().positive().max(10_000_000).nullable().optional(),
  })
  .refine(
    (data) =>
      data.projectRateMin == null ||
      data.projectRateMax == null ||
      data.projectRateMin <= data.projectRateMax,
    { message: 'projectRateMin must be less than or equal to projectRateMax', path: ['projectRateMin'] },
  );

async function requireCreatorProfile(userId: string) {
  return prisma.creatorProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      acceptingWork: true,
      hourlyRate: true,
      projectRateMin: true,
      projectRateMax: true,
    },
  });
}

export async function GET() {
  const session = await getServerSession();
  const user = requireAuth({ user: session?.user });

  const profile = await requireCreatorProfile(user.id);
  if (!profile) {
    return NextResponse.json({ error: 'No creator profile for this account' }, { status: 404 });
  }

  return NextResponse.json(profile);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  const user = requireAuth({ user: session?.user });

  const existing = await requireCreatorProfile(user.id);
  if (!existing) {
    return NextResponse.json({ error: 'No creator profile for this account' }, { status: 404 });
  }

  const json = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // A partial update (e.g. only `projectRateMin`) is still checked against
  // whatever the OTHER bound already is in the database, not just against
  // itself — otherwise a two-step edit could park the row in an invalid
  // min > max state in between.
  const nextMin = parsed.data.projectRateMin !== undefined ? parsed.data.projectRateMin : existing.projectRateMin;
  const nextMax = parsed.data.projectRateMax !== undefined ? parsed.data.projectRateMax : existing.projectRateMax;
  if (nextMin != null && nextMax != null && nextMin > nextMax) {
    return NextResponse.json(
      { error: 'projectRateMin must be less than or equal to projectRateMax' },
      { status: 400 },
    );
  }

  const updated = await prisma.creatorProfile.update({
    where: { userId: user.id },
    data: parsed.data,
    select: {
      id: true,
      acceptingWork: true,
      hourlyRate: true,
      projectRateMin: true,
      projectRateMax: true,
    },
  });

  void revalidateCreators(updated.id);

  return NextResponse.json(updated);
}
