import { NextRequest, NextResponse } from 'next/server';
import { parseCreatorBatchBody } from '@/lib/validations/creator-batch';
import { getCachedReviewsForCreators } from '@/lib/services/review-service';

/**
 * POST /api/creators/reputation/batch
 * Read-only reputation summaries. Same 50-id cap and 60s cache as reviews.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = parseCreatorBatchBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const batchResults = getCachedReviewsForCreators(parsed.creatorIds);
    const results: Record<string, unknown> = {};

    for (const creatorId of parsed.creatorIds) {
      const { reviews, total } = batchResults[creatorId] ?? { reviews: [], total: 0 };

      const avgRating =
        reviews.length > 0
          ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
          : 0;

      const ratingDistribution = {
        5: reviews.filter((r) => r.rating === 5).length,
        4: reviews.filter((r) => r.rating === 4).length,
        3: reviews.filter((r) => r.rating === 3).length,
        2: reviews.filter((r) => r.rating === 2).length,
        1: reviews.filter((r) => r.rating === 1).length,
      };

      results[creatorId] = {
        totalReviews: total,
        averageRating: Math.round(avgRating * 10) / 10,
        ratingDistribution,
        recentReviews: reviews.slice(0, 3),
      };
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error('Batch reputation fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reputation data' },
      { status: 500 },
    );
  }
}
