import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe, getStripeWebhookSecret, isStripeConfigured } from '@/lib/payments/stripe'
import { processStripeWebhookEvent } from '@/lib/payments/stripe-webhook'

export const runtime = 'nodejs'

/** Reject signed events older than this. Matches Stripe's default tolerance. */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300

/**
 * POST /api/webhooks/stripe
 *
 * Stripe calls this endpoint with payment events. The payload is only
 * trusted after its signature is verified against STRIPE_WEBHOOK_SECRET,
 * which needs the exact raw body — so it is read as text, never parsed first.
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const payload = await request.text()

  let event: Stripe.Event
  try {
    const stripe = await getStripe()
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      await getStripeWebhookSecret(),
      STRIPE_WEBHOOK_TOLERANCE_SECONDS,
    )
  } catch (error) {
    console.warn('[stripe-webhook] signature verification failed:', error)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    await processStripeWebhookEvent(event)
  } catch (error) {
    // A 5xx makes Stripe retry the delivery.
    console.error(`[stripe-webhook] failed to process ${event.type}:`, error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
