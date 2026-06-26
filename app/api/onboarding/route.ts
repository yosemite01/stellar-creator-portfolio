import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      onboardingStep: true,
      onboardingCompletedAt: true,
      onboardingData: true,
      role: true,
      emailVerified: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { step, data, role } = body as {
    step?: number;
    data?: Record<string, unknown>;
    role?: 'CREATOR' | 'CLIENT';
  };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const mergedData = {
    ...((user.onboardingData as Record<string, unknown> | null) ?? {}),
    ...(data ?? {}),
  };

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      onboardingStep: step ?? user.onboardingStep,
      onboardingData: mergedData,
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
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { role, profile } = body as {
    role: 'CREATOR' | 'CLIENT';
    profile: Record<string, unknown>;
  };

  const userId = session.user.id;

  await prisma.$transaction(async (tx) => {
    if (role === 'CREATOR') {
      await tx.creatorProfile.upsert({
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

  return NextResponse.json({ completed: true });
}
