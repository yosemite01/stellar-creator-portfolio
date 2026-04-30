import { describe, it, expect, beforeEach } from 'vitest'

// We test the pure logic functions directly - no module mocking needed
// Import after resetting module state via a fresh import each test suite

describe('calculateAggregate', () => {
  it('returns zeros for empty list', async () => {
    const { calculateAggregate } = await import('@/lib/review-service')
    const result = calculateAggregate([])
    expect(result.average).toBe(0)
    expect(result.total).toBe(0)
    expect(result.breakdown[5]).toBe(0)
  })

  it('calculates correct average and breakdown', async () => {
    const { calculateAggregate } = await import('@/lib/review-service')
    const reviews = [
      { rating: 5, status: 'approved' },
      { rating: 4, status: 'approved' },
      { rating: 3, status: 'approved' },
    ] as any[]

    const result = calculateAggregate(reviews)
    expect(result.average).toBe(4)
    expect(result.total).toBe(3)
    expect(result.breakdown[5]).toBe(1)
    expect(result.breakdown[4]).toBe(1)
    expect(result.breakdown[3]).toBe(1)
    expect(result.breakdown[1]).toBe(0)
  })

  it('rounds average to 1 decimal place', async () => {
    const { calculateAggregate } = await import('@/lib/review-service')
    const reviews = [
      { rating: 5, status: 'approved' },
      { rating: 4, status: 'approved' },
    ] as any[]
    const result = calculateAggregate(reviews)
    expect(result.average).toBe(4.5)
  })

  it('ignores non-approved reviews', async () => {
    const { calculateAggregate } = await import('@/lib/review-service')
    const reviews = [
      { rating: 5, status: 'approved' },
      { rating: 1, status: 'pending' },
      { rating: 1, status: 'rejected' },
    ] as any[]
    const result = calculateAggregate(reviews)
    expect(result.average).toBe(5)
    expect(result.total).toBe(1)
  })
})

describe('createReview', () => {
  it('creates a review with pending status', async () => {
    const { createReview } = await import('@/lib/review-service')
    const review = createReview({
      creatorId: 'creator-test',
      reviewerId: 'user-test',
      reviewerName: 'Test User',
      rating: 4,
      title: 'Great work',
      body: 'Really enjoyed working with this creator.',
      isVerifiedPurchase: false,
    })
    expect(review.id).toBeTruthy()
    expect(review.status).toBe('pending')
    expect(review.helpfulCount).toBe(0)
    expect(review.rating).toBe(4)
  })
})

describe('voteOnReview', () => {
  it('increments helpful count', async () => {
    const { createReview, voteOnReview } = await import('@/lib/review-service')
    const review = createReview({
      creatorId: 'c1',
      reviewerId: 'r1',
      reviewerName: 'Voter Test',
      rating: 5,
      title: 'Test',
      body: 'Test body content here.',
      isVerifiedPurchase: false,
    })
    const updated = voteOnReview(review.id, 'voter-1', 'helpful')
    expect(updated?.helpfulCount).toBe(1)
  })

  it('toggles vote off when same vote submitted twice', async () => {
    const { createReview, voteOnReview } = await import('@/lib/review-service')
    const review = createReview({
      creatorId: 'c2',
      reviewerId: 'r2',
      reviewerName: 'Toggle Test',
      rating: 3,
      title: 'Toggle',
      body: 'Toggle test body content.',
      isVerifiedPurchase: false,
    })
    voteOnReview(review.id, 'voter-2', 'helpful')
    const toggled = voteOnReview(review.id, 'voter-2', 'helpful')
    expect(toggled?.helpfulCount).toBe(0)
  })

  it('returns null for non-existent review', async () => {
    const { voteOnReview } = await import('@/lib/review-service')
    const result = voteOnReview('non-existent-id', 'user', 'helpful')
    expect(result).toBeNull()
  })
})

describe('moderateReview', () => {
  it('approves a pending review', async () => {
    const { createReview, moderateReview } = await import('@/lib/review-service')
    const review = createReview({
      creatorId: 'c3',
      reviewerId: 'r3',
      reviewerName: 'Mod Test',
      rating: 4,
      title: 'Moderation test',
      body: 'Testing moderation flow here.',
      isVerifiedPurchase: true,
    })
    expect(review.status).toBe('pending')
    const approved = moderateReview(review.id, 'approved')
    expect(approved?.status).toBe('approved')
  })

  it('rejects a review', async () => {
    const { createReview, moderateReview } = await import('@/lib/review-service')
    const review = createReview({
      creatorId: 'c4',
      reviewerId: 'r4',
      reviewerName: 'Reject Test',
      rating: 1,
      title: 'Spam',
      body: 'This is spam content.',
      isVerifiedPurchase: false,
    })
    const rejected = moderateReview(review.id, 'rejected')
    expect(rejected?.status).toBe('rejected')
  })
})

describe('getReviewsForCreator', () => {
  it('only returns approved reviews', async () => {
    const { createReview, moderateReview, getReviewsForCreator } = await import('@/lib/review-service')
    const creatorId = 'creator-filter-test'
    const r1 = createReview({ creatorId, reviewerId: 'u1', reviewerName: 'A', rating: 5, title: 'T', body: 'Body content here.', isVerifiedPurchase: false })
    const r2 = createReview({ creatorId, reviewerId: 'u2', reviewerName: 'B', rating: 3, title: 'T', body: 'Body content here.', isVerifiedPurchase: false })
    moderateReview(r1.id, 'approved')
    // r2 stays pending

    const { reviews } = getReviewsForCreator(creatorId)
    expect(reviews.every((r) => r.status === 'approved')).toBe(true)
    expect(reviews.find((r) => r.id === r2.id)).toBeUndefined()
  })

  it('filters by rating', async () => {
    const { createReview, moderateReview, getReviewsForCreator } = await import('@/lib/review-service')
    const creatorId = 'creator-rating-filter'
    const r1 = createReview({ creatorId, reviewerId: 'u3', reviewerName: 'C', rating: 5, title: 'T', body: 'Body content here.', isVerifiedPurchase: false })
    const r2 = createReview({ creatorId, reviewerId: 'u4', reviewerName: 'D', rating: 3, title: 'T', body: 'Body content here.', isVerifiedPurchase: false })
    moderateReview(r1.id, 'approved')
    moderateReview(r2.id, 'approved')

    const { reviews } = getReviewsForCreator(creatorId, { filterRating: 5 })
    expect(reviews.every((r) => r.rating === 5)).toBe(true)
  })
})

describe('review validator schemas', () => {
  it('rejects rating outside 1-5', async () => {
    const { reviewSchema } = await import('@/lib/validators')
    const result = reviewSchema.safeParse({ creatorId: 'c', rating: 6, title: 'T', body: 'Body content here.' })
    expect(result.success).toBe(false)
  })

  it('rejects body shorter than 10 chars', async () => {
    const { reviewSchema } = await import('@/lib/validators')
    const result = reviewSchema.safeParse({ creatorId: 'c', rating: 4, title: 'T', body: 'Short' })
    expect(result.success).toBe(false)
  })

  it('accepts valid review input', async () => {
    const { reviewSchema } = await import('@/lib/validators')
    const result = reviewSchema.safeParse({ creatorId: 'c', rating: 4, title: 'Great', body: 'This is a valid review body.' })
    expect(result.success).toBe(true)
  })
})
