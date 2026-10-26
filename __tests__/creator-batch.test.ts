import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/creators/reviews/batch/route';
import { POST as reputationPost } from '@/app/api/creators/reputation/batch/route';
import {
  createReview,
  moderateReview,
  getCachedReviewsForCreators,
} from '@/lib/services/review-service';

function cuid(n: number) {
  return `c${String(n).padStart(24, '0')}`;
}

function post(body: unknown) {
  return new NextRequest('http://localhost:3000/api/creators/reviews/batch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('creator batch endpoints', () => {
  it('rejects batches over 50 ids', async () => {
    const creatorIds = Array.from({ length: 51 }, (_, i) => cuid(i + 1));
    const res = await POST(post({ creatorIds }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed ids', async () => {
    const res = await POST(post({ creatorIds: ['not-a-cuid'] }));
    expect(res.status).toBe(400);
  });

  it('returns approved reviews for a valid batch and serves a cached read', async () => {
    const creatorId = cuid(80);
    const created = createReview({
      creatorId,
      reviewerId: 'user-1',
      reviewerName: 'Ada',
      rating: 5,
      title: 'Solid',
      body: 'Clear work.',
      isVerifiedPurchase: true,
    });
    moderateReview(created.id, 'approved');

    const res = await POST(post({ creatorIds: [creatorId] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[creatorId].total).toBe(1);

    const cached = getCachedReviewsForCreators([creatorId]);
    expect(cached[creatorId].total).toBe(1);

    const reputation = await reputationPost(
      new NextRequest('http://localhost:3000/api/creators/reputation/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: [creatorId] }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(reputation.status).toBe(200);
    expect((await reputation.json())[creatorId].totalReviews).toBe(1);
  });
});
