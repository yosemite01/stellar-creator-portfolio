import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const reviewSchema = z.object({
  creatorId: z.string().min(1),
  rating: z.number().min(1).max(5),
  text: z.string().min(20).max(500),
});

export async function GET(request: NextRequest) {
  try {
    const creatorId = request.nextUrl.searchParams.get('creatorId');
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '10');

    if (!creatorId) {
      return NextResponse.json(
        { error: 'creatorId is required' },
        { status: 400 }
      );
    }

    // In production, fetch from database
    // const reviews = await db.reviews.findMany({
    //   where: { creatorId },
    //   orderBy: { createdAt: 'desc' },
    //   take: limit
    // });

    return NextResponse.json({
      reviews: [],
      total: 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch reviews' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = reviewSchema.parse(body);

    // In production, save to database
    // const review = await db.reviews.create({
    //   ...data,
    //   authorId: session.user.id,
    //   createdAt: new Date()
    // });

    return NextResponse.json(
      {
        id: `rev_${Date.now()}`,
        ...data,
        author: 'Current User',
        avatar: '/avatars/default.jpg',
        date: new Date().toLocaleDateString(),
        bountyTitle: 'Completed Bounty',
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid review data', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to submit review' },
      { status: 500 }
    );

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const creatorId = searchParams.get('creatorId');

  if (!creatorId) {
    return NextResponse.json({ success: false, error: 'creatorId is required' }, { status: 400 });
  }

  try {
    const backendUrl = process.env.RUST_API_URL || 'http://localhost:3001';
    const res = await fetch(`${backendUrl}/api/v1/creators/${creatorId}/reputation`);
    
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.data) {
        // Map the Rust response to what the UI expects
        const rustData = data.data;
        const aggregate = {
          average: rustData.aggregation.averageRating,
          total: rustData.aggregation.totalReviews,
          breakdown: {
            1: rustData.aggregation.stars1,
            2: rustData.aggregation.stars2,
            3: rustData.aggregation.stars3,
            4: rustData.aggregation.stars4,
            5: rustData.aggregation.stars5,
          }
        };
        return NextResponse.json({ success: true, aggregate });
      }
    }

    // Fallback or error
    return NextResponse.json({ success: false, error: 'Failed to fetch from backend' }, { status: 500 });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
