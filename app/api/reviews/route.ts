import { NextRequest, NextResponse } from 'next/server';

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
