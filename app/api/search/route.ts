import { NextRequest, NextResponse } from 'next/server';
import { searchCreators, searchBounties, parseSearchOperators } from '@/lib/search-utils';
import { z } from 'zod';

// Validation schema for search queries
const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(['creators', 'bounties', 'all']).default('all'),
  discipline: z.string().optional(),
  category: z.string().optional(),
  minBudget: z.string().optional().transform(v => v ? parseInt(v) : undefined),
  maxBudget: z.string().optional().transform(v => v ? parseInt(v) : undefined),
  limit: z.string().optional().transform(v => parseInt(v || '20')),
  offset: z.string().optional().transform(v => parseInt(v || '0')),
});

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    const query = SearchQuerySchema.parse({
      q: searchParams.get('q') || '',
      type: (searchParams.get('type') as any) || 'all',
      discipline: searchParams.get('discipline') || undefined,
      category: searchParams.get('category') || undefined,
      minBudget: searchParams.get('minBudget') || undefined,
      maxBudget: searchParams.get('maxBudget') || undefined,
      limit: searchParams.get('limit') || '20',
      offset: searchParams.get('offset') || '0',
    });

    // Parse search operators from query string
    const filters = parseSearchOperators(query.q);
    filters.limit = query.limit;
    filters.offset = query.offset;

    // Override with explicit parameters if provided
    if (query.discipline) filters.discipline = query.discipline;

    const results: any = {};
    let totalResults = 0;

    // Search creators
    if (query.type === 'all' || query.type === 'creators') {
      const { data: creators, error: creatorsError, count: creatorsCount } = await searchCreators(filters);
      
      if (creatorsError) {
        console.error('Creator search error:', creatorsError);
        return NextResponse.json(
          { error: 'Error searching creators' },
          { status: 500 }
        );
      }

      results.creators = {
        data: creators,
        count: creatorsCount,
      };
      totalResults += creatorsCount || 0;
    }

    // Search bounties
    if (query.type === 'all' || query.type === 'bounties') {
      const bountyFilters = {
        query: filters.query,
        category: query.category,
        minBudget: query.minBudget,
        maxBudget: query.maxBudget,
        limit: query.limit,
        offset: query.offset,
      };

      const { data: bounties, error: bountiesError, count: bountiesCount } = await searchBounties(bountyFilters);
      
      if (bountiesError) {
        console.error('Bounty search error:', bountiesError);
        return NextResponse.json(
          { error: 'Error searching bounties' },
          { status: 500 }
        );
      }

      results.bounties = {
        data: bounties,
        count: bountiesCount,
      };
      totalResults += bountiesCount || 0;
    }

    return NextResponse.json({
      success: true,
      query: query.q,
      type: query.type,
      totalResults,
      results,
      limit: query.limit,
      offset: query.offset,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid search parameters', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
