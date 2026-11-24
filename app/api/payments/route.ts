import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireAuth, requireRole, requireOwnerOrAdmin } from '@/server/services/authorization'
import { getStripe, isStripeConfigured } from '@/lib/payments/stripe'
import {
  createEscrow,
  attachPaymentIntent,
  getEscrow,
  listEscrowsForUser,
  markReleased,
  markRefunded,
} from '@/lib/payments/escrow-service'
import { paymentPostBodySchema } from '@/lib/payments/payment-validators'
import { validateRequest, formatZodErrors } from '@/lib/utils/validators'
import { getCachedResponse, cacheResponse } from '@/lib/payments/idempotency'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getServerSession(authOptions)
  const user = requireAuth({ user: session?.user })

  const escrows = listEscrowsForUser(user.id)
  return NextResponse.json({
    escrows,
    stripeConfigured: isStripeConfigured(),
  })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const user = requireAuth({ user: session?.user })

  const idempotencyKey = request.headers.get('Idempotency-Key')
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: 'Missing Idempotency-Key header' },
      { status: 400 },
    )
  }

  const cached = await getCachedResponse(idempotencyKey)
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status })
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
    try {
      requireRole(user, ['CLIENT', 'ADMIN'])
    } catch (error) {
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
      clientUserId: user.id,
      amountCents: data.amountCents,
      currency: data.currency,
    })

    const stripe = await getStripe()
    const pi = await stripe.paymentIntents.create({
      amount: data.amountCents,
      currency: data.currency,
      capture_method: 'manual',
      automatic_payment_methods: { enabled: true },
      metadata: {
        escrowId: escrow.id,
        bountyId: data.bountyId,
        clientUserId: user.id,
        kind: 'bounty_escrow',
      },
    })

    attachPaymentIntent(escrow.id, pi.id)

    const responseBody = {
      escrowId: escrow.id,
      clientSecret: pi.client_secret,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
      amountCents: data.amountCents,
      currency: data.currency,
    }
    await cacheResponse(idempotencyKey, 200, responseBody)
    return NextResponse.json(responseBody)
  }

  if (data.type === 'subscription') {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
    }

    const base = process.env.NEXTAUTH_URL ?? request.nextUrl.origin
    const successUrl = data.successUrl ?? `${base}/dashboard/payments?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = data.cancelUrl ?? `${base}/dashboard/payments?canceled=1`

    const stripe = await getStripe()
    const sessionCheckout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: data.priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user.email ?? undefined,
      metadata: { userId: user.id },
    })

    const responseBody = { url: sessionCheckout.url }
    await cacheResponse(idempotencyKey, 200, responseBody)
    return NextResponse.json(responseBody)
  }

  if (data.type === 'escrow_release') {
    const escrow = getEscrow(data.escrowId)
    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }
    try {
      requireOwnerOrAdmin(escrow.clientUserId, { user })
    } catch (error) {
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
      const responseBody = { ok: true, escrow: getEscrow(escrow.id), mode: 'simulated' }
      await cacheResponse(idempotencyKey, 200, responseBody)
      return NextResponse.json(responseBody)
    }

    const stripe = await getStripe()
    const captured = await stripe.paymentIntents.capture(escrow.paymentIntentId, {
      expand: ['latest_charge'],
    })
    const charge = captured.latest_charge
    const receiptUrl =
      typeof charge === 'object' && charge && 'receipt_url' in charge
        ? charge.receipt_url ?? undefined
        : undefined
    markReleased(escrow.id, receiptUrl)

    const responseBody = { ok: true, escrow: getEscrow(escrow.id), receiptUrl }
    await cacheResponse(idempotencyKey, 200, responseBody)
    return NextResponse.json(responseBody)
  }

  if (data.type === 'escrow_refund') {
    const escrow = getEscrow(data.escrowId)
    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 })
    }
    try {
      requireOwnerOrAdmin(escrow.clientUserId, { user })
    } catch (error) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (escrow.status !== 'funded_authorized' && escrow.status !== 'pending_funding') {
      return NextResponse.json({ error: 'Escrow cannot be refunded in this state' }, { status: 400 })
    }

    if (!isStripeConfigured()) {
      markRefunded(escrow.id)
      const responseBody = { ok: true, escrow: getEscrow(escrow.id), mode: 'simulated' }
      await cacheResponse(idempotencyKey, 200, responseBody)
      return NextResponse.json(responseBody)
    }

    if (!escrow.paymentIntentId) {
      markRefunded(escrow.id)
      const responseBody = { ok: true, escrow: getEscrow(escrow.id) }
      await cacheResponse(idempotencyKey, 200, responseBody)
      return NextResponse.json(responseBody)
    }

    const stripe = await getStripe()
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
    const responseBody = { ok: true, escrow: getEscrow(escrow.id) }
    await cacheResponse(idempotencyKey, 200, responseBody)
    return NextResponse.json(responseBody)
  }

  return NextResponse.json({ error: 'Unsupported' }, { status: 400 })
}
