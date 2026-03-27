import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getStripe, getStripeWebhookSecret } from '@/lib/stripe'
import {
  findEscrowByPaymentIntent,
  getEscrow,
  markFailed,
  markFundedAuthorized,
  markRefunded,
} from '@/lib/escrow-service'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  let secret: string
  try {
    secret = getStripeWebhookSecret()
  } catch {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const rawBody = await request.text()
  let event: Stripe.Event
  try {
    const stripe = getStripe()
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    if (err instanceof Error && err.message.includes('STRIPE_SECRET_KEY')) {
      return NextResponse.json({ error: 'Payments not configured' }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Invalid payload'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    await processStripeWebhookEvent(event)
  } catch (e) {
    console.error('[stripe webhook]', e)
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

export async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'payment_intent.amount_capturable_updated': {
      const pi = event.data.object as Stripe.PaymentIntent
      const escrowId = pi.metadata?.escrowId
      const escrow = escrowId ? getEscrow(escrowId) : findEscrowByPaymentIntent(pi.id)
      if (!escrow) break
      if (pi.status === 'requires_capture' && escrow.status === 'pending_funding') {
        const charge = pi.latest_charge
        const receiptUrl =
          typeof charge === 'object' && charge && 'receipt_url' in charge
            ? (charge.receipt_url as string | null) ?? undefined
            : undefined
        markFundedAuthorized(escrow.id, receiptUrl)
      }
      break
    }
    case 'payment_intent.payment_failed': {
      const pi = event.data.object as Stripe.PaymentIntent
      const escrow = pi.metadata?.escrowId
        ? getEscrow(pi.metadata.escrowId)
        : findEscrowByPaymentIntent(pi.id)
      if (escrow) {
        markFailed(escrow.id, pi.last_payment_error?.message ?? 'Payment failed')
      }
      break
    }
    case 'payment_intent.canceled': {
      const pi = event.data.object as Stripe.PaymentIntent
      const escrow = pi.metadata?.escrowId
        ? getEscrow(pi.metadata.escrowId)
        : findEscrowByPaymentIntent(pi.id)
      if (escrow && escrow.status === 'pending_funding') {
        markFailed(escrow.id, 'Payment intent canceled')
      }
      break
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
      if (!piId) break
      const escrow = findEscrowByPaymentIntent(piId)
      if (escrow && escrow.status !== 'refunded') {
        markRefunded(escrow.id)
      }
      break
    }
    default:
      break
  }
}
