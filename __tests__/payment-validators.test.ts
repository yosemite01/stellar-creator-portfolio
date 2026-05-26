import { describe, it, expect } from 'vitest'
import { paymentPostBodySchema } from '@/lib/payments/payment-validators'

describe('paymentPostBodySchema', () => {
  it('accepts bounty_escrow', () => {
    const r = paymentPostBodySchema.safeParse({
      type: 'bounty_escrow',
      bountyId: 'bounty-1',
      amountCents: 5000,
      currency: 'usd',
    })
    expect(r.success).toBe(true)
  })

  it('rejects invalid amount', () => {
    const r = paymentPostBodySchema.safeParse({
      type: 'bounty_escrow',
      bountyId: 'b-1',
      amountCents: 0,
    })
    expect(r.success).toBe(false)
  })

  it('accepts subscription', () => {
    const r = paymentPostBodySchema.safeParse({
      type: 'subscription',
      priceId: 'price_123',
    })
    expect(r.success).toBe(true)
  })

  it('accepts escrow_release with uuid', () => {
    const r = paymentPostBodySchema.safeParse({
      type: 'escrow_release',
      escrowId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(r.success).toBe(true)
  })
})
