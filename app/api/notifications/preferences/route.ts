import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: session.user.id },
    });
    return NextResponse.json({ preferences });
  } catch (error) {
    console.error('[preferences:GET] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { category, emailEnabled, inAppEnabled } = body;

    if (!category) {
      return NextResponse.json({ error: 'Category is required' }, { status: 400 });
    }

    const updated = await prisma.notificationPreference.upsert({
      where: {
        userId_category: { userId: session.user.id, category },
      },
      update: {
        emailEnabled: emailEnabled !== undefined ? emailEnabled : undefined,
        inAppEnabled: inAppEnabled !== undefined ? inAppEnabled : undefined,
      },
      create: {
        userId: session.user.id,
        category,
        emailEnabled: emailEnabled !== undefined ? emailEnabled : true,
        inAppEnabled: inAppEnabled !== undefined ? inAppEnabled : true,
      },
    });

    return NextResponse.json({ preference: updated });
  } catch (error) {
    console.error('[preferences:PATCH] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
