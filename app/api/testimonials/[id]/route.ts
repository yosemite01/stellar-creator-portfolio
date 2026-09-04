import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string })?.role;

  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);

  if (!body || typeof body.featured !== 'boolean') {
    return NextResponse.json(
      { error: '`featured` (boolean) is required in the request body' },
      { status: 400 },
    );
  }

  try {
    const testimonial = await prisma.testimonial.update({
      where: { id },
      data: { featured: body.featured },
    });

    return NextResponse.json({ testimonial });
  } catch (error) {
    // Prisma throws P2025 when the record doesn't exist.
    if ((error as { code?: string })?.code === 'P2025') {
      return NextResponse.json({ error: 'Testimonial not found' }, { status: 404 });
    }
    console.error('Testimonial update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
