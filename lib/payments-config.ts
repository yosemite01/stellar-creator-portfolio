/** Client-safe env (no server Stripe SDK). Use for UI that reads subscription Price ids. */
export function getPremiumSubscriptionPriceId(): string | null {
  const id = process.env.NEXT_PUBLIC_STRIPE_PRICE_PREMIUM_MONTHLY
  return id?.trim() ? id : null
}
