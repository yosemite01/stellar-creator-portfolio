import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/creators/reputation/batch
 * Batch fetch reputation stats for multiple creators
 * Aggregates review data without fetching individual reviews
 */
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

    const reviews = await prisma.review.findMany({
      where: {
        creatorId: { in: creatorIds },
        status: "APPROVED",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        creatorId: true,
        reviewerId: true,
        reviewerName: true,
        rating: true,
        title: true,
        body: true,
        isVerifiedPurchase: true,
        helpfulCount: true,
        notHelpfulCount: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const reviewsByCreator = new Map<string, typeof reviews>();
    for (const review of reviews) {
      const creatorReviews = reviewsByCreator.get(review.creatorId) ?? [];
      creatorReviews.push(review);
      reviewsByCreator.set(review.creatorId, creatorReviews);
    }

    const results: Record<string, any> = {};
    for (const creatorId of creatorIds) {
      const creatorReviews = reviewsByCreator.get(creatorId) ?? [];
      const ratingDistribution = {
        5: creatorReviews.filter((review) => review.rating === 5).length,
        4: creatorReviews.filter((review) => review.rating === 4).length,
        3: creatorReviews.filter((review) => review.rating === 3).length,
        2: creatorReviews.filter((review) => review.rating === 2).length,
        1: creatorReviews.filter((review) => review.rating === 1).length,
      };
      const avgRating =
        creatorReviews.length > 0
          ? creatorReviews.reduce((sum, review) => sum + review.rating, 0) /
            creatorReviews.length
          : 0;

      results[creatorId] = {
        totalReviews: creatorReviews.length,
        averageRating: Math.round(avgRating * 10) / 10,
        ratingDistribution,
        recentReviews: creatorReviews.slice(0, 3).map((review) => ({
          ...review,
          status: review.status.toLowerCase(),
          createdAt: review.createdAt.toISOString(),
          updatedAt: review.updatedAt.toISOString(),
        })),
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
