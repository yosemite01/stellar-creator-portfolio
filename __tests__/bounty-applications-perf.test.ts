import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetBountyStoreForTests,
  submitApplication,
  getApplicantCountsForBounties,
} from '@/lib/bounty-service'

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
