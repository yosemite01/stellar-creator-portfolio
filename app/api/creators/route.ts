import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listCreatorsFromDB } from '@/server/services/creators-directory';

const querySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(12),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  discipline: z.string().optional(),
  search: z.string().optional(),
  skills: z
    .string()
    .transform((val) => val.split(',').map((s) => s.trim()).filter(Boolean))
    .optional(),
  verified: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()));

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { limit, take, ...filters } = parsed.data;
    const pageSize = limit ?? take;

    const result = await listCreatorsFromDB({
      take: pageSize,
      ...filters,
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to fetch creators', message: error.message },
      { status: 500 },
    );
  }
}
