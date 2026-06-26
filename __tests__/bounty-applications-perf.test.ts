import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  __resetBountyStoreForTests,
  submitApplication,
  getApplicantCountsForBounties,
} from '@/lib/services/bounty-service'
import { POST as postCreatorReputationBatch } from '@/app/api/creators/reputation/batch/route'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    review: {
      findMany: vi.fn(),
    },
  },
}))

describe('bounty applications performance', () => {
  beforeEach(() => {
    __resetBountyStoreForTests()
  })

  it('counts scale for many applications', () => {
    const n = 500
    for (let i = 0; i < n; i++) {
      submitApplication({
        bountyId: 'bounty-1',
        applicantId: `applicant-${i}`,
        applicantName: `User ${i}`,
        applicantEmail: `u${i}@example.com`,
        proposedBudget: 1000 + i,
        timelineDays: 7,
        proposal: 'proposal text '.repeat(5),
      })
    }
    const t0 = performance.now()
    const counts = getApplicantCountsForBounties(['bounty-1', 'bounty-2', 'bounty-3'])
    const ms = performance.now() - t0
    expect(counts['bounty-1']).toBe(n)
    expect(ms).toBeLessThan(200)
  })

  it('fetches creator reputation for a 100 creator batch with one query', async () => {
    const creatorIds = Array.from({ length: 100 }, (_, i) => `creator-${i}`)
    const findMany = vi.mocked(prisma.review.findMany)
    findMany.mockResolvedValue([
      {
        id: 'review-1',
        creatorId: 'creator-42',
        reviewerId: 'reviewer-1',
        reviewerName: 'Ada Reviewer',
        rating: 5,
        title: 'Excellent delivery',
        body: 'Great collaboration and delivery.',
        isVerifiedPurchase: true,
        helpfulCount: 0,
        notHelpfulCount: 0,
        status: 'APPROVED',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ])

    const t0 = performance.now()
    const response = await postCreatorReputationBatch(
      new Request('http://localhost/api/creators/reputation/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creatorIds }),
      }) as any,
    )
    const ms = performance.now() - t0

    expect(response.status).toBe(200)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          creatorId: { in: creatorIds },
          status: 'APPROVED',
        },
      }),
    )
    const body = await response.json()
    expect(body['creator-42']).toMatchObject({
      totalReviews: 1,
      averageRating: 5,
      ratingDistribution: { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 },
    })
    expect(ms).toBeLessThan(50)
  })
})
