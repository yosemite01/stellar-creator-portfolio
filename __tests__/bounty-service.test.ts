import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetBountyStoreForTests,
  submitApplication,
  getApplicationById,
  updateApplicationStatus,
  clientCanManageBounty,
  canViewApplication,
  getApplicantCountsForBounties,
  listApplicationsForBounty,
} from '@/lib/bounty-service'
import { getBountyById } from '@/lib/creators-data'

describe('bounty-service', () => {
  beforeEach(() => {
    __resetBountyStoreForTests()
  })

  it('submits application and prevents duplicate', () => {
    const first = submitApplication({
      bountyId: 'bounty-1',
      applicantId: 'user-a',
      applicantName: 'Alice',
      applicantEmail: 'a@example.com',
      proposedBudget: 2000,
      timelineDays: 10,
      proposal: 'x'.repeat(60),
    })
    expect('application' in first).toBe(true)
    if ('application' in first) {
      expect(first.application.status).toBe('pending')
    }

    const dup = submitApplication({
      bountyId: 'bounty-1',
      applicantId: 'user-a',
      applicantName: 'Alice',
      applicantEmail: 'a@example.com',
      proposedBudget: 2000,
      timelineDays: 10,
      proposal: 'y'.repeat(60),
    })
    expect('error' in dup).toBe(true)
  })

  it('updates status from pending only', () => {
    const { application } = submitApplication({
      bountyId: 'bounty-2',
      applicantId: 'user-b',
      applicantName: 'Bob',
      applicantEmail: 'b@example.com',
      proposedBudget: 1500,
      timelineDays: 5,
      proposal: 'z'.repeat(55),
    }) as { application: { id: string } }

    const ok = updateApplicationStatus({
      applicationId: application.id,
      status: 'accepted',
      actorId: 'client-1',
      actorName: 'Client',
    })
    expect('application' in ok).toBe(true)

    const bad = updateApplicationStatus({
      applicationId: application.id,
      status: 'rejected',
      actorId: 'client-1',
      actorName: 'Client',
    })
    expect('error' in bad).toBe(true)
  })

  it('clientCanManageBounty respects ownerUserId', () => {
    const bounty = getBountyById('bounty-1')
    expect(bounty).toBeDefined()
    if (!bounty) return
    expect(clientCanManageBounty('any', 'CLIENT', bounty)).toBe(true)
  })

  it('canViewApplication denies stranger', () => {
    const { application } = submitApplication({
      bountyId: 'bounty-3',
      applicantId: 'user-c',
      applicantName: 'C',
      applicantEmail: 'c@example.com',
      proposedBudget: 1000,
      timelineDays: 3,
      proposal: 'p'.repeat(50),
    }) as { application: { id: string; applicantId: string } }

    const bounty = getBountyById('bounty-3')
    const app = getApplicationById(application.id)
    expect(bounty && app).toBeTruthy()
    if (!bounty || !app) return

    expect(canViewApplication('stranger', 'CREATOR', app, bounty)).toBe(false)
    expect(canViewApplication(application.applicantId, 'CREATOR', app, bounty)).toBe(true)
  })

  it('counts applications per bounty', () => {
    submitApplication({
      bountyId: 'bounty-4',
      applicantId: 'u1',
      applicantName: 'U1',
      applicantEmail: 'u1@example.com',
      proposedBudget: 500,
      timelineDays: 2,
      proposal: 'q'.repeat(50),
    })
    submitApplication({
      bountyId: 'bounty-4',
      applicantId: 'u2',
      applicantName: 'U2',
      applicantEmail: 'u2@example.com',
      proposedBudget: 600,
      timelineDays: 2,
      proposal: 'r'.repeat(50),
    })
    const counts = getApplicantCountsForBounties(['bounty-4', 'bounty-1'])
    expect(counts['bounty-4']).toBe(2)
    expect(listApplicationsForBounty('bounty-4')).toHaveLength(2)
  })
})
