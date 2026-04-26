import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getStripe, isStripeConfigured } from '@/lib/stripe'
import {
  createEscrow,
  attachPaymentIntent,
  getEscrow,
  listEscrowsForUser,
  markReleased,
  markRefunded,
} from '@/lib/payments/escrow-service'
import { paymentPostBodySchema } from '@/lib/payments/payment-validators'
import { validateRequest, formatZodErrors } from '@/lib/validators'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const escrows = listEscrowsForUser(session.user.id)
  return NextResponse.json({
    escrows,
    stripeConfigured: isStripeConfigured(),
  })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = validateRequest(paymentPostBodySchema, body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: formatZodErrors(parsed.errors) },
      { status: 400 },
    )
  }

  const data = parsed.data

  if (data.type === 'bounty_escrow') {
    if (session.user.role !== 'CLIENT' && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only clients can fund bounties' }, { status: 403 })
    }

    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Payments are not configured (missing STRIPE_SECRET_KEY)' },
        { status: 503 },
      )
    }

    const escrow = createEscrow({
      bountyId: data.bountyId,
      clientUserId: session.user.id,
      amountCents: data.amountCents,
      currency: data.currency,
    })

    const stripe = getStripe()
    const pi = await stripe.paymentIntents.create({
      amount: data.amountCents,
      currency: data.currency,
      capture_method: 'manual',
      automatic_payment_methods: { enabled: true },
      metadata: {
        escrowId: escrow.id,
        bountyId: data.bountyId,
        clientUserId: session.user.id,
        kind: 'bounty_escrow',
      },
    })

    attachPaymentIntent(escrow.id, pi.id)

    return NextResponse.json({
      escrowId: escrow.id,
      clientSecret: pi.client_secret,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
      amountCents: data.amountCents,
      currency: data.currency,
    })
  }

  if (data.type === 'subscription') {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
    }

    const base = process.env.NEXTAUTH_URL ?? request.nextUrl.origin
    const successUrl = data.successUrl ?? `${base}/dashboard/payments?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = data.cancelUrl ?? `${base}/dashboard/payments?canceled=1`

    const stripe = getStripe()
    const sessionCheckout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: data.priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: session.user.email ?? undefined,
      metadata: { userId: session.user.id },
    })

    return NextResponse.json({ url: sessionCheckout.url })
  }

  if (data.type === 'escrow_release') {
    if (session.user.role !== 'CLIENT' && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const escrow = getEscrow(data.escrowId)
    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }
    if (escrow.clientUserId !== session.user.id && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (escrow.status !== 'funded_authorized') {
      return NextResponse.json({ error: 'Escrow is not in a releasable state' }, { status: 400 })
    }
    if (!escrow.paymentIntentId) {
      return NextResponse.json({ error: 'Missing payment intent' }, { status: 400 })
    }

    if (!isStripeConfigured()) {
      markReleased(escrow.id)
      return NextResponse.json({ ok: true, escrow: getEscrow(escrow.id), mode: 'simulated' })
    }

    const stripe = getStripe()
    const captured = await stripe.paymentIntents.capture(escrow.paymentIntentId, {
      expand: ['latest_charge'],
    })
    const charge = captured.latest_charge
    const receiptUrl =
      typeof charge === 'object' && charge && !charge.deleted && 'receipt_url' in charge
        ? (charge.receipt_url as string | null) ?? undefined
        : undefined
    markReleased(escrow.id, receiptUrl)

    return NextResponse.json({ ok: true, escrow: getEscrow(escrow.id), receiptUrl })
  }

  if (data.type === 'escrow_refund') {
    if (escrowRefundAllowed(session.user.role, session.user.id, data.escrowId) === false) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const escrow = getEscrow(data.escrowId)
    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }
    if (escrow.status !== 'funded_authorized' && escrow.status !== 'pending_funding') {
      return NextResponse.json({ error: 'Escrow cannot be refunded in this state' }, { status: 400 })
    }

    if (!isStripeConfigured()) {
      markRefunded(escrow.id)
      return NextResponse.json({ ok: true, escrow: getEscrow(escrow.id), mode: 'simulated' })
    }

    if (!escrow.paymentIntentId) {
      markRefunded(escrow.id)
      return NextResponse.json({ ok: true, escrow: getEscrow(escrow.id) })
    }

    const stripe = getStripe()
    const pi = await stripe.paymentIntents.retrieve(escrow.paymentIntentId)
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.cancel(escrow.paymentIntentId)
    } else if (pi.status === 'succeeded') {
      const chargeId = pi.latest_charge
      if (typeof chargeId === 'string') {
        await stripe.refunds.create({ charge: chargeId })
      }
    }

    markRefunded(escrow.id)
    return NextResponse.json({ ok: true, escrow: getEscrow(escrow.id) })
  }

  return NextResponse.json({ error: 'Unsupported' }, { status: 400 })
}

function escrowRefundAllowed(role: string, userId: string, escrowId: string): boolean {
  const escrow = getEscrow(escrowId)
  if (!escrow) return false
  if (role === 'ADMIN') return true
  return escrow.clientUserId === userId
}
