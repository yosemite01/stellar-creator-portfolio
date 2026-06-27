import { describe, expect, it } from 'vitest'
import { bountyApplicationSchema } from '@/lib/validations/bounty-application'

describe('bountyApplicationSchema', () => {
  it('accepts valid proposal', () => {
    const r = bountyApplicationSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: 2500,
      timeline: 14,
      proposal: 'a'.repeat(100),
    })
    expect(r.success).toBe(true)
  })

  it('rejects short proposal (under 100 chars)', () => {
    const r = bountyApplicationSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: 100,
      timeline: 7,
      proposal: 'a'.repeat(99),
    })
    expect(r.success).toBe(false)
  })

  it('rejects negative budget', () => {
    const r = bountyApplicationSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: -1,
      timeline: 7,
      proposal: 'a'.repeat(100),
    })
    expect(r.success).toBe(false)
  })

  it('rejects budget exceeding 1,000,000', () => {
    const r = bountyApplicationSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: 1_000_001,
      timeline: 14,
      proposal: 'a'.repeat(100),
    })
    expect(r.success).toBe(false)
  })

  it('rejects timeline exceeding 365 days', () => {
    const r = bountyApplicationSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: 500,
      timeline: 366,
      proposal: 'a'.repeat(100),
    })
    expect(r.success).toBe(false)
  })

  it('accepts boundary values', () => {
    const r = bountyApplicationSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: 1_000_000,
      timeline: 365,
      proposal: 'a'.repeat(100),
    })
    expect(r.success).toBe(true)
  })
})
