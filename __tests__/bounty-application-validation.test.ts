import { describe, expect, it } from 'vitest'
import { applicationSubmitSchema } from '@/lib/validators'

describe('applicationSubmitSchema', () => {
  it('accepts valid proposal', () => {
    const r = applicationSubmitSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: 2500,
      timeline: 14,
      proposal: 'a'.repeat(50),
    })
    expect(r.success).toBe(true)
  })

  it('rejects short proposal', () => {
    const r = applicationSubmitSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: 100,
      timeline: 7,
      proposal: 'short',
    })
    expect(r.success).toBe(false)
  })

  it('rejects negative budget', () => {
    const r = applicationSubmitSchema.safeParse({
      bounty_id: 'bounty-1',
      proposed_budget: -1,
      timeline: 7,
      proposal: 'a'.repeat(50),
    })
    expect(r.success).toBe(false)
  })
})
