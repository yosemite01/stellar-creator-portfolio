import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetBountyStoreForTests,
  submitApplication,
  getApplicantCountsForBounties,
} from '@/lib/services/bounty-service'
import { getReviewsForCreatorsBatch } from '@/lib/services/review-service'

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
})

describe('batch reputation query count', () => {
  it('executes a single batch call regardless of input size', () => {
    const creatorIds = Array.from({ length: 100 }, (_, i) => `creator-${i}`)

    const t0 = performance.now()
    const results = getReviewsForCreatorsBatch(creatorIds)
    const ms = performance.now() - t0

    expect(Object.keys(results)).toHaveLength(100)
    for (const id of creatorIds) {
      expect(results[id]).toBeDefined()
      expect(results[id].reviews).toBeInstanceOf(Array)
      expect(typeof results[id].total).toBe('number')
    }
    expect(ms).toBeLessThan(50)
  })
})
