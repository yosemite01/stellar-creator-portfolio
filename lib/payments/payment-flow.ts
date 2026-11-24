import { z } from 'zod'
import { isValidStellarAddress } from '@/lib/utils/stellar-address'

/** Stellar amounts carry at most 7 decimal places (stroop precision). */
const MAX_DECIMALS = 7
/** MEMO_TEXT is limited to 28 bytes by the protocol. */
const MAX_MEMO_BYTES = 28

/**
 * Shape of the SEP-24 payment form. Shared by the form (client-side
 * feedback) and POST /api/payments/sep24 (the actual control).
 */
export const paymentFlowSchema = z.object({
  recipientAddress: z
    .string()
    .trim()
    .refine(isValidStellarAddress, 'Enter a valid Stellar public key (G...)'),
  amount: z
    .number({
      error: (iss) => (iss.input === undefined ? undefined : 'Enter an amount'),
    })
    .positive('Amount must be greater than zero')
    .finite()
    .refine(
      (value) => Number.isInteger(Number((value * 10 ** MAX_DECIMALS).toFixed(4))),
      `Amount supports at most ${MAX_DECIMALS} decimal places`,
    ),
  description: z.string().trim().min(1, 'Description is required').max(200),
  memo: z
    .string()
    .trim()
    .refine(
      (value) => new TextEncoder().encode(value).length <= MAX_MEMO_BYTES,
      `Memo must be at most ${MAX_MEMO_BYTES} bytes`,
    )
    .optional(),
})

export type PaymentFlowData = z.infer<typeof paymentFlowSchema>

/** Validates a payment payload, flattening issues to display strings. */
export function validatePaymentFlow(
  data: unknown,
): { valid: true; data: PaymentFlowData } | { valid: false; errors: string[] } {
  const result = paymentFlowSchema.safeParse(data)
  if (result.success) return { valid: true, data: result.data }
  return { valid: false, errors: result.error.issues.map((issue) => issue.message) }
}
