import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetBountyStoreForTests,
  submitApplication,
  canViewApplication,
  getApplicationById,
} from '@/lib/bounty-service'
import { getBountyById } from '@/lib/creators-data'

describe('bounty application access control', () => {
  beforeEach(() => {
    __resetBountyStoreForTests()
  })

  it('does not leak application data to unrelated users', () => {
    const result = submitApplication({
      bountyId: 'bounty-1',
      applicantId: 'applicant-secret',
      applicantName: 'Secret',
      applicantEmail: 'sec@example.com',
      proposedBudget: 3000,
      timelineDays: 14,
      proposal: 'Confidential '.repeat(10),
    })
    expect('application' in result).toBe(true)
    if (!('application' in result)) return

    const bounty = getBountyById('bounty-1')
    const app = getApplicationById(result.application.id)
    expect(bounty).toBeDefined()
    expect(app).toBeDefined()
    if (!bounty || !app) return

    expect(canViewApplication('other-user', 'CREATOR', app, bounty)).toBe(false)
    expect(canViewApplication('other-user', 'USER', app, bounty)).toBe(false)
  })
})
