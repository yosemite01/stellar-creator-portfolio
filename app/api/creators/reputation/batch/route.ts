import { NextRequest, NextResponse } from "next/server";
import { getReviewsForCreatorsBatch } from "@/lib/services/review-service";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { creatorIds: string[] };
    const { creatorIds } = body;

    if (!Array.isArray(creatorIds) || creatorIds.length === 0) {
      return NextResponse.json(
        { error: "creatorIds must be a non-empty array" },
        { status: 400 },
      );
    }

    if (creatorIds.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 creators per batch" },
        { status: 400 },
      );
    }

    const batchResults = getReviewsForCreatorsBatch(creatorIds);

    const results: Record<string, any> = {};

    for (const creatorId of creatorIds) {
      const { reviews, total } = batchResults[creatorId];

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
    console.error("Batch reputation fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch reputation data" },
      { status: 500 },
    );
  }
}
