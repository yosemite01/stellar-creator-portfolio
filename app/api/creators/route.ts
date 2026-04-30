import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/db';
import { z } from 'zod';

// Validation schema for creator queries
const CreatorQuerySchema = z.object({
  discipline: z.string().optional(),
  search: z.string().optional(),
  skill: z.string().optional(),
  limit: z.string().optional().transform(v => parseInt(v || '10')),
  offset: z.string().optional().transform(v => parseInt(v || '0')),
});

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Parse and validate query parameters
    const query = CreatorQuerySchema.parse({
      discipline: searchParams.get('discipline') || undefined,
      search: searchParams.get('search') || undefined,
      skill: searchParams.get('skill') || undefined,
      limit: searchParams.get('limit') || '10',
      offset: searchParams.get('offset') || '0',
    });

    let queryBuilder = supabaseServer.from('creators').select('*');

    // Apply filters
    if (query.discipline) {
      queryBuilder = queryBuilder.eq('discipline', query.discipline);
    }

    if (query.search) {
      queryBuilder = queryBuilder.ilike('bio', `%${query.search}%`)
        .or(`title.ilike.%${query.search}%`);
    }

    if (query.skill) {
      queryBuilder = queryBuilder.contains('skills', [query.skill]);
    }

    // Apply pagination
    queryBuilder = queryBuilder.range(query.offset, query.offset + query.limit - 1);

    const { data: creators, error, count } = await queryBuilder;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: creators,
      count,
      limit: query.limit,
      offset: query.offset,
      success: true,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST endpoint for creating a new creator profile (requires authentication)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // This should be protected by authentication middleware
    // For now, we'll validate the input
    const creatorSchema = z.object({
      user_id: z.string(),
      title: z.string().min(1).max(100),
      discipline: z.string(),
      tagline: z.string().max(200),
      skills: z.array(z.string()),
      hourly_rate: z.number().optional(),
      availability: z.enum(['available', 'limited', 'unavailable']),
    });

    const validatedData = creatorSchema.parse(body);

    const { data, error } = await supabaseServer
      .from('creators')
      .insert([validatedData])
      .select();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { data, success: true },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
