import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { POST } from '@/app/api/webhooks/stripe/route'

const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_signature_verification_123'
const mockStripe = new Stripe('sk_test_mock_key_for_testing')

vi.mock('@/lib/payments/stripe', () => ({
  isStripeConfigured: vi.fn(() => true),
  getStripeWebhookSecret: vi.fn(async () => TEST_WEBHOOK_SECRET),
  getStripe: vi.fn(async () => mockStripe),
}))

const mockProcessStripeWebhookEvent = vi.fn()
vi.mock('@/lib/payments/stripe-webhook', () => ({
  processStripeWebhookEvent: (...args: any[]) => mockProcessStripeWebhookEvent(...args),
}))

describe('Stripe webhook raw body signature verification (Issue #1521)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProcessStripeWebhookEvent.mockResolvedValue(null)
  })

  it('rejects requests missing the stripe-signature header with 400', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' })
    const request = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: payload,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json).toEqual({ error: 'Missing stripe-signature header' })
    expect(mockProcessStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('accepts valid signatures computed over the exact raw body', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_valid_123',
      object: 'event',
      type: 'payment_intent.amount_capturable_updated',
      data: {
        object: {
          id: 'pi_test_123',
          object: 'payment_intent',
          amount: 5000,
        },
      },
    })

    const signature = mockStripe.webhooks.generateTestHeaderString({
      payload: rawPayload,
      secret: TEST_WEBHOOK_SECRET,
    })

    const request = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: rawPayload,
    })

    const response = await POST(request)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toEqual({ received: true })
    expect(mockProcessStripeWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessStripeWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt_valid_123',
        type: 'payment_intent.amount_capturable_updated',
      })
    )
  })

  it('rejects tampered payloads where the body was modified after signing with 400', async () => {
    const originalPayload = JSON.stringify({
      id: 'evt_original',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_original', amount: 1000 } },
    })

    const signature = mockStripe.webhooks.generateTestHeaderString({
      payload: originalPayload,
      secret: TEST_WEBHOOK_SECRET,
    })

    // Attacker modifies the payload (e.g. changes amount or target)
    const tamperedPayload = JSON.stringify({
      id: 'evt_original',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_original', amount: 9999999 } },
    })

    const request = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: tamperedPayload,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json).toEqual({ error: 'Invalid signature' })
    expect(mockProcessStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('rejects signatures created with an incorrect secret with 400', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_wrong_secret',
      type: 'payment_intent.succeeded',
    })

    const signature = mockStripe.webhooks.generateTestHeaderString({
      payload: rawPayload,
      secret: 'whsec_completely_different_secret',
    })

    const request = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: rawPayload,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json).toEqual({ error: 'Invalid signature' })
    expect(mockProcessStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('rejects expired events older than Stripe tolerance window (300 seconds) with 400', async () => {
    const rawPayload = JSON.stringify({
      id: 'evt_expired',
      type: 'payment_intent.succeeded',
    })

    // 10 minutes ago
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 600

    const signature = mockStripe.webhooks.generateTestHeaderString({
      payload: rawPayload,
      secret: TEST_WEBHOOK_SECRET,
      timestamp: expiredTimestamp,
    })

    const request = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: rawPayload,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json).toEqual({ error: 'Invalid signature' })
    expect(mockProcessStripeWebhookEvent).not.toHaveBeenCalled()
  })

  it('fails verification if whitespace/formatting differs from the signed raw body', async () => {
    const rawPayloadWithSpaces = '{\n  "id": "evt_formatted",\n  "type": "payment_intent.succeeded"\n}'

    const signature = mockStripe.webhooks.generateTestHeaderString({
      payload: rawPayloadWithSpaces,
      secret: TEST_WEBHOOK_SECRET,
    })

    // Minified payload with same semantic JSON but different byte stream
    const minifiedPayload = '{"id":"evt_formatted","type":"payment_intent.succeeded"}'

    const request = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body: minifiedPayload,
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json).toEqual({ error: 'Invalid signature' })
    expect(mockProcessStripeWebhookEvent).not.toHaveBeenCalled()
  })
})
