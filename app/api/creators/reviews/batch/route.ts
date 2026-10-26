import { NextRequest, NextResponse } from 'next/server';
import { parseCreatorBatchBody } from '@/lib/validations/creator-batch';
import { getCachedReviewsForCreators } from '@/lib/services/review-service';

/**
 * POST /api/creators/reviews/batch
 * Read-only batch of approved reviews. Bodies are capped at 50 cuid ids
 * and served from one lookup plus a 60s per-creator cache.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseCreatorBatchBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const batch = getCachedReviewsForCreators(parsed.creatorIds);
    const results: Record<string, { reviews: unknown[]; total: number }> = {};
    for (const creatorId of parsed.creatorIds) {
      const { reviews, total } = batch[creatorId] ?? { reviews: [], total: 0 };
      results[creatorId] = { reviews: reviews.slice(0, 10), total };
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Batch reviews fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 },
    );
  }
}
