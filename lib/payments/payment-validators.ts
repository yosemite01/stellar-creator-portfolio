import { z } from 'zod'

export const bountyEscrowPaymentSchema = z.object({
  type: z.literal('bounty_escrow'),
  bountyId: z.string().min(1).max(128),
  amountCents: z.number().int().positive().max(99_999_999),
  currency: z.string().length(3).optional().default('usd'),
})

export const subscriptionCheckoutSchema = z.object({
  type: z.literal('subscription'),
  priceId: z.string().min(1).max(128),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
})

export const escrowReleaseSchema = z.object({
  type: z.literal('escrow_release'),
  escrowId: z.string().uuid(),
})

export const escrowRefundSchema = z.object({
  type: z.literal('escrow_refund'),
  escrowId: z.string().uuid(),
})

export const paymentPostBodySchema = z.discriminatedUnion('type', [
  bountyEscrowPaymentSchema,
  subscriptionCheckoutSchema,
  escrowReleaseSchema,
  escrowRefundSchema,
])

export type PaymentPostBody = z.infer<typeof paymentPostBodySchema>
