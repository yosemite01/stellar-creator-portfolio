import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/db';
import { z } from 'zod';

// Validation schema for bounty queries
const BountyQuerySchema = z.object({
  difficulty: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  min_budget: z.string().optional().transform(v => v ? parseInt(v) : undefined),
  max_budget: z.string().optional().transform(v => v ? parseInt(v) : undefined),
  limit: z.string().optional().transform(v => parseInt(v || '10')),
  offset: z.string().optional().transform(v => parseInt(v || '0')),
});

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Parse and validate query parameters
    const query = BountyQuerySchema.parse({
      difficulty: searchParams.get('difficulty') || undefined,
      category: searchParams.get('category') || undefined,
      status: searchParams.get('status') || undefined,
      search: searchParams.get('search') || undefined,
      min_budget: searchParams.get('min_budget') || undefined,
      max_budget: searchParams.get('max_budget') || undefined,
      limit: searchParams.get('limit') || '10',
      offset: searchParams.get('offset') || '0',
    });

    let queryBuilder = supabaseServer.from('bounties').select('*');

    // Apply filters
    if (query.difficulty) {
      queryBuilder = queryBuilder.eq('difficulty', query.difficulty);
    }

    if (query.category) {
      queryBuilder = queryBuilder.eq('category', query.category);
    }

    if (query.status) {
      queryBuilder = queryBuilder.eq('status', query.status);
    }

    if (query.search) {
      queryBuilder = queryBuilder.ilike('title', `%${query.search}%`)
        .or(`description.ilike.%${query.search}%`);
    }

    if (query.min_budget !== undefined) {
      queryBuilder = queryBuilder.gte('budget', query.min_budget);
    }

    if (query.max_budget !== undefined) {
      queryBuilder = queryBuilder.lte('budget', query.max_budget);
    }

    // Apply pagination and sorting
    queryBuilder = queryBuilder
      .order('created_at', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1);

    const { data: bounties, error, count } = await queryBuilder;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: bounties,
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

// POST endpoint for creating a new bounty (requires authentication)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // This should be protected by authentication middleware
    const bountySchema = z.object({
      title: z.string().min(10).max(200),
      description: z.string().min(50),
      budget: z.number().positive(),
      currency: z.string().default('USD'),
      deadline: z.string().datetime(),
      difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
      category: z.string(),
      tags: z.array(z.string()),
      created_by: z.string(),
    });

    const validatedData = bountySchema.parse(body);

    const { data, error } = await supabaseServer
      .from('bounties')
      .insert([{
        ...validatedData,
        status: 'open',
      }])
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
