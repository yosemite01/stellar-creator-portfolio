import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { handleProfileEvent } from '@/server/services/profile-events';

/**
 * GET  /api/creators/profile   the caller's own profile, rate card, and completion score
 * PATCH /api/creators/profile  update profile fields, triggering event-driven completion sync and nudges (issue #1825)
 */

const updateSchema = z
  .object({
    displayName: z.string().min(2).max(100).optional(),
    bio: z.string().max(2000).nullable().optional(),
    avatar: z.string().url().nullable().optional().or(z.literal('')),
    discipline: z.string().max(100).nullable().optional(),
    skills: z.array(z.string()).optional(),
    portfolio: z.any().optional(),
    githubUrl: z.string().url().nullable().optional().or(z.literal('')),
    figmaUrl: z.string().url().nullable().optional().or(z.literal('')),
    linkedinUrl: z.string().url().nullable().optional().or(z.literal('')),
    websiteUrl: z.string().url().nullable().optional().or(z.literal('')),
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
      userId: true,
      displayName: true,
      bio: true,
      avatar: true,
      discipline: true,
      skills: true,
      portfolio: true,
      githubUrl: true,
      figmaUrl: true,
      linkedinUrl: true,
      websiteUrl: true,
      acceptingWork: true,
      hourlyRate: true,
      projectRateMin: true,
      projectRateMax: true,
      completionScore: true,
    },
  });
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profile = await requireCreatorProfile(session.user.id);
  if (!profile) {
    return NextResponse.json({ error: 'No creator profile for this account' }, { status: 404 });
  }

  return NextResponse.json(profile);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existing = await requireCreatorProfile(session.user.id);
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

  const nextMin = parsed.data.projectRateMin !== undefined ? parsed.data.projectRateMin : existing.projectRateMin;
  const nextMax = parsed.data.projectRateMax !== undefined ? parsed.data.projectRateMax : existing.projectRateMax;
  if (nextMin != null && nextMax != null && nextMin > nextMax) {
    return NextResponse.json(
      { error: 'projectRateMin must be less than or equal to projectRateMax' },
      { status: 400 },
    );
  }

  const updated = await prisma.creatorProfile.update({
    where: { userId: session.user.id },
    data: parsed.data,
    select: {
      id: true,
      userId: true,
      displayName: true,
      bio: true,
      avatar: true,
      discipline: true,
      skills: true,
      portfolio: true,
      githubUrl: true,
      figmaUrl: true,
      linkedinUrl: true,
      websiteUrl: true,
      acceptingWork: true,
      hourlyRate: true,
      projectRateMin: true,
      projectRateMax: true,
      completionScore: true,
    },
  });

  // Event-driven recalculation of completion score and nudge evaluation
  const { completion, nudge } = await handleProfileEvent({
    type: 'profile.updated',
    userId: session.user.id,
  });

  return NextResponse.json({
    ...updated,
    completionScore: completion.percentage,
    nudge,
  });
}
