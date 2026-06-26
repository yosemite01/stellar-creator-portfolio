import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { computeProfileCompletion } from '@/lib/profile-completion';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profile = await prisma.creatorProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      displayName: true,
      avatar: true,
      bio: true,
      skills: true,
      portfolio: true,
      githubUrl: true,
      linkedinUrl: true,
      verified: true,
    },
  });

  if (!profile) {
    return NextResponse.json(computeProfileCompletion({}));
  }

  return NextResponse.json(computeProfileCompletion(profile));
}
