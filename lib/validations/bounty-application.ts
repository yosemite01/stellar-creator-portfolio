import { z } from 'zod'

export const bountyApplicationSchema = z.object({
  bounty_id: z.string().min(1).max(128),
  proposed_budget: z.number().positive().max(1_000_000),
  timeline: z.number().int().min(1).max(365),
  proposal: z.string().min(100, 'Proposal must be at least 100 characters').max(5000),
})

export type BountyApplicationInput = z.infer<typeof bountyApplicationSchema>
