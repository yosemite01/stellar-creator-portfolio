import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/server/services/authorization';
import { type Prisma, type Role } from '@prisma/client';
import { onProfileChanged } from '@/server/services/search';

export async function GET() {
  const session = await getServerSession();
  const user = requireAuth({ user: session?.user });

  const userRecord = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      onboardingStep: true,
      onboardingCompletedAt: true,
      onboardingData: true,
      role: true,
      emailVerified: true,
    },
  });

  if (!userRecord) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(userRecord);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  const user = requireAuth({ user: session?.user });

  const body = await req.json();
  const { step, data, role } = body as {
    step?: number;
    data?: Record<string, unknown>;
    role?: 'CREATOR' | 'CLIENT';
  };

  const userRecord = await prisma.user.findUnique({
    where: { id: user.id },
  });
  if (!userRecord) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const mergedData = {
    ...((userRecord.onboardingData as Record<string, unknown> | null) ?? {}),
    ...(data ?? {}),
  };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      onboardingStep: step ?? userRecord.onboardingStep,
      onboardingData: mergedData as Prisma.InputJsonObject,
      ...(role ? { role: role as Role } : {}),
    },
    select: {
      onboardingStep: true,
      onboardingCompletedAt: true,
      onboardingData: true,
      role: true,
    },
  });

  return NextResponse.json(updated);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  const user = requireAuth({ user: session?.user });

  const body = await req.json();
  const { role, profile } = body as {
    role: 'CREATOR' | 'CLIENT';
    profile: Record<string, unknown>;
  };

  const userId = user.id;

  // Populated only when role === 'CREATOR', then used to refresh the
  // creator's search embedding once the transaction below has committed
  // (see Issue #1619 — stale embeddings otherwise keep semantic search
  // returning results against a creator's pre-onboarding profile text).
  let updatedCreatorProfile: Prisma.CreatorProfileGetPayload<object> | null = null;

  await prisma.$transaction(async (tx) => {
    if (role === 'CREATOR') {
      updatedCreatorProfile = await tx.creatorProfile.upsert({
        where: { userId },
        create: {
          userId,
          displayName: (profile.displayName as string) || 'Creator',
          bio: (profile.bio as string) || null,
          avatar: (profile.avatar as string) || null,
          discipline: (profile.discipline as string) || null,
          skills: (profile.skills as string[]) || [],
        },
        update: {
          displayName: (profile.displayName as string) || undefined,
          bio: (profile.bio as string) || null,
          avatar: (profile.avatar as string) || null,
          discipline: (profile.discipline as string) || null,
          skills: (profile.skills as string[]) || undefined,
        },
      });
    } else {
      await tx.clientProfile.upsert({
        where: { userId },
        create: {
          userId,
          companyName: (profile.companyName as string) || null,
          projectType: (profile.projectType as string) || null,
          budgetRange: (profile.budgetRange as string) || null,
        },
        update: {
          companyName: (profile.companyName as string) || null,
          projectType: (profile.projectType as string) || null,
          budgetRange: (profile.budgetRange as string) || null,
        },
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        role: role as Role,
        onboardingCompletedAt: new Date(),
        onboardingStep: 3,
      },
    });
  });

  // Fire-and-forget, after the transaction has committed — re-indexing
  // (and the OpenAI/HuggingFace embedding call it makes) must never be
  // able to roll back the profile write, and must never add its latency
  // to this response.
  // TS can't see the assignment inside the transaction callback, so re-widen.
  const p = updatedCreatorProfile as Prisma.CreatorProfileGetPayload<object> | null;
  if (p) {
    onProfileChanged({
      id: p.id,
      displayName: p.displayName,
      bio: p.bio,
      discipline: p.discipline,
      skills: p.skills,
      updatedAt: p.updatedAt.toISOString(),
      githubUrl: p.githubUrl,
      linkedinUrl: p.linkedinUrl,
      verified: p.verified,
      rating: p.rating,
      completedProjects: p.completedProjects,
    });
  }

  return NextResponse.json({ completed: true });
}
