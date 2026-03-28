import { clientConfig } from '@/lib/config'

/** Client-safe env (no server Stripe SDK). Use for UI that reads subscription Price ids. */
export function getPremiumSubscriptionPriceId(): string | null {
  const id = clientConfig.stripe.premiumMonthlyPriceId
  return id?.trim() ? id : null
}
