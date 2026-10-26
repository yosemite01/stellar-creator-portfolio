import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { POST, STRIPE_WEBHOOK_TOLERANCE_SECONDS } from '../route'

const WEBHOOK_SECRET = 'whsec_test_secret'
const stripe = new Stripe('sk_test_123')

vi.mock('@/lib/payments/stripe', () => ({
  getStripe: vi.fn(async () => stripe),
  getStripeWebhookSecret: vi.fn(async () => WEBHOOK_SECRET),
  isStripeConfigured: vi.fn(() => true),
}))

vi.mock('@/lib/payments/stripe-webhook', () => ({
  processStripeWebhookEvent: vi.fn(async () => undefined),
}))

import { processStripeWebhookEvent } from '@/lib/payments/stripe-webhook'

function eventPayload(id = 'evt_test_webhook') {
  return JSON.stringify({
    id,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_test', object: 'payment_intent' } },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  })
}

function signedRequest(payload: string, timestamp?: number) {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
    timestamp,
  })
  return new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: payload,
  })
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a raw body with a valid signature and processes the event', async () => {
    const payload = eventPayload()
    const constructEvent = vi.spyOn(stripe.webhooks, 'constructEvent')

    const res = await POST(signedRequest(payload))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(constructEvent).toHaveBeenCalledWith(
      payload,
      expect.any(String),
      WEBHOOK_SECRET,
      STRIPE_WEBHOOK_TOLERANCE_SECONDS,
    )
    expect(typeof constructEvent.mock.calls[0][0]).toBe('string')
    expect(processStripeWebhookEvent).toHaveBeenCalledOnce()
  })

  it('returns 400 for a tampered body and does not process it', async () => {
    const payload = eventPayload()
    const request = signedRequest(payload)
    const tampered = new NextRequest(request.url, {
      method: 'POST',
      headers: { 'stripe-signature': request.headers.get('stripe-signature') ?? '' },
      body: payload.replace('evt_test_webhook', 'evt_test_tampered'),
    })

    const res = await POST(tampered)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(processStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('returns 400 for an event older than the tolerance', async () => {
    const payload = eventPayload('evt_test_stale')
    const staleTimestamp = Math.floor(Date.now() / 1000) - STRIPE_WEBHOOK_TOLERANCE_SECONDS - 60

    const res = await POST(signedRequest(payload, staleTimestamp))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(processStripeWebhookEvent).not.toHaveBeenCalled()
  })
})
