import { describe, it, expect, beforeEach } from 'vitest'
import {
  __resetEscrowStoreForTests,
  computeFreelancerPayoutCents,
  computePlatformFeeCents,
  createEscrow,
  attachPaymentIntent,
  markFundedAuthorized,
  markReleased,
  markRefunded,
  getEscrow,
} from '@/lib/escrow-service'

describe('escrow-service', () => {
  beforeEach(() => {
    __resetEscrowStoreForTests()
  })

  it('computes platform fee at 10% by default', () => {
    expect(computePlatformFeeCents(10_000)).toBe(1000)
    expect(computePlatformFeeCents(100)).toBe(10)
  })

  it('computes freelancer payout after fee', () => {
    expect(computeFreelancerPayoutCents(10_000, 1000)).toBe(9000)
  })

  it('creates escrow in pending_funding', () => {
    const e = createEscrow({
      bountyId: 'b-1',
      clientUserId: 'user-1',
      amountCents: 5000,
    })
    expect(e.status).toBe('pending_funding')
    expect(e.platformFeeCents).toBe(500)
  })

  it('transitions funded -> released', () => {
    const e = createEscrow({
      bountyId: 'b-1',
      clientUserId: 'user-1',
      amountCents: 2000,
    })
    attachPaymentIntent(e.id, 'pi_test')
    markFundedAuthorized(e.id)
    expect(getEscrow(e.id)?.status).toBe('funded_authorized')
    markReleased(e.id, 'https://pay.stripe.com/receipt')
    expect(getEscrow(e.id)?.status).toBe('released')
    expect(getEscrow(e.id)?.receiptUrl).toBe('https://pay.stripe.com/receipt')
  })

  it('supports refund path', () => {
    const e = createEscrow({
      bountyId: 'b-1',
      clientUserId: 'user-1',
      amountCents: 2000,
    })
    markRefunded(e.id)
    expect(getEscrow(e.id)?.status).toBe('refunded')
  })
})
