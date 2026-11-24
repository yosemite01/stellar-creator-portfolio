import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const querySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
  role: z.string().trim().min(1).max(50).optional(),
  sort: z.enum(['recent', 'name']).default('recent'),
});

export const revalidate = 60;

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { cursor, limit, search, role, sort } = parsed.data;

  // Creators are `CreatorProfile` rows; `role` filters by discipline.
  const where: Prisma.CreatorProfileWhereInput = {};
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (role) {
    where.discipline = { equals: role, mode: 'insensitive' };
  }

  const orderBy: Prisma.CreatorProfileOrderByWithRelationInput[] =
    sort === 'name'
      ? [{ displayName: 'asc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

  try {
    const creators = await prisma.creatorProfile.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = creators.length > limit;
    const page = hasMore ? creators.slice(0, limit) : creators;
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

    return NextResponse.json(
      { data: page, nextCursor, hasMore },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      },
    );
  } catch (error) {
    console.error('Failed to list creators', error);
    return NextResponse.json(
      { error: 'Failed to load creators' },
      { status: 500 },
    );
  }
}
