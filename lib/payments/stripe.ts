import Stripe from 'stripe'
import { serverConfig, clientConfig } from '@/lib/config'

/**
 * Server-side Stripe client. Requires `STRIPE_SECRET_KEY`.
 * Card data never touches this server — use Stripe.js / Elements or Checkout on the client (PCI DSS scope reduction).
 */
let stripeSingleton: Stripe | null = null

export function getStripe(): Stripe {
  const key = serverConfig.stripe.secretKey
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key)
  }
  return stripeSingleton
}

export function isStripeConfigured(): boolean {
  return Boolean(serverConfig.stripe.secretKey?.trim())
}

export function getStripePublishableKey(): string {
  const k = clientConfig.stripe.publishableKey
  if (!k?.trim()) {
    throw new Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured')
  }
  return k
}

export function getStripeWebhookSecret(): string {
  const s = serverConfig.stripe.webhookSecret
  if (!s?.trim()) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
  }
  return s
}
