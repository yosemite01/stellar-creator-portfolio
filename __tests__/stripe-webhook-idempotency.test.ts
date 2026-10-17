import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  recordProcessedWebhookEvent,
  unmarkProcessedWebhookEvent,
  isWebhookEventProcessed,
} from '@/lib/payments/stripe-webhook'
import { POST } from '@/app/api/webhooks/stripe/route'

// Mock prisma with an in-memory set to accurately model uniqueness constraints
const processedEvents = new Map<string, { id: string; eventType: string | null; createdAt: Date }>()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    processedWebhookEvent: {
      create: vi.fn(async ({ data }: { data: { id: string; eventType?: string | null } }) => {
        if (processedEvents.has(data.id)) {
          const err: any = new Error('Unique constraint failed on the fields: (`id`)')
          err.code = 'P2002'
          throw err
        }
        const record = {
          id: data.id,
          eventType: data.eventType ?? null,
          createdAt: new Date(),
        }
        processedEvents.set(data.id, record)
        return record
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (!processedEvents.has(where.id)) {
          const err: any = new Error('Record to delete does not exist.')
          err.code = 'P2025'
          throw err
        }
        const record = processedEvents.get(where.id)
        processedEvents.delete(where.id)
        return record
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return processedEvents.get(where.id) ?? null
      }),
    },
  },
}))

// Mock stripe module for route testing
let constructedEvent: any = null
vi.mock('@/lib/payments/stripe', () => ({
  isStripeConfigured: vi.fn(() => true),
  getStripeWebhookSecret: vi.fn(async () => 'whsec_test_secret'),
  getStripe: vi.fn(async () => ({
    webhooks: {
      constructEvent: vi.fn(() => constructedEvent),
    },
  })),
}))

// Mock escrow processing
const mockProcessStripeWebhookEvent = vi.fn()
vi.mock('@/lib/payments/stripe-webhook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments/stripe-webhook')>()
  return {
    ...actual,
    processStripeWebhookEvent: (...args: any[]) => mockProcessStripeWebhookEvent(...args),
  }
})

describe('Stripe webhook idempotency (Issue #1575)', () => {
  beforeEach(() => {
    processedEvents.clear()
    vi.clearAllMocks()
    mockProcessStripeWebhookEvent.mockResolvedValue(null)
  })

  describe('Core idempotency helpers', () => {
    it('records a new webhook event successfully', async () => {
      const recorded = await recordProcessedWebhookEvent('evt_123', 'payment_intent.succeeded')
      expect(recorded).toBe(true)
      expect(await isWebhookEventProcessed('evt_123')).toBe(true)
    })

    it('returns false when attempting to record a duplicate event', async () => {
      const first = await recordProcessedWebhookEvent('evt_duplicate', 'payment_intent.succeeded')
      expect(first).toBe(true)

      const second = await recordProcessedWebhookEvent('evt_duplicate', 'payment_intent.succeeded')
      expect(second).toBe(false)
    })

    it('unmarks an event so it can be retried', async () => {
      await recordProcessedWebhookEvent('evt_retry', 'payment_intent.failed')
      expect(await isWebhookEventProcessed('evt_retry')).toBe(true)

      await unmarkProcessedWebhookEvent('evt_retry')
      expect(await isWebhookEventProcessed('evt_retry')).toBe(false)

      // Can be recorded again
      const retried = await recordProcessedWebhookEvent('evt_retry', 'payment_intent.failed')
      expect(retried).toBe(true)
    })
  })

  describe('Route POST /api/webhooks/stripe', () => {
    it('processes first delivery and deduplicates subsequent retries', async () => {
      constructedEvent = {
        id: 'evt_stripe_dedup_1',
        type: 'payment_intent.amount_capturable_updated',
        data: { object: { id: 'pi_test' } },
      }

      const req1 = new NextRequest('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_valid' },
        body: JSON.stringify(constructedEvent),
      })

      const res1 = await POST(req1)
      expect(res1.status).toBe(200)
      const data1 = await res1.json()
      expect(data1).toEqual({ received: true })
      expect(mockProcessStripeWebhookEvent).toHaveBeenCalledTimes(1)

      // Second delivery of the exact same event (Stripe retry)
      const req2 = new NextRequest('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_valid' },
        body: JSON.stringify(constructedEvent),
      })

      const res2 = await POST(req2)
      expect(res2.status).toBe(200)
      const data2 = await res2.json()
      expect(data2).toEqual({ received: true, deduplicated: true })
      // Handler was NOT called a second time
      expect(mockProcessStripeWebhookEvent).toHaveBeenCalledTimes(1)
    })

    it('unmarks event on handler failure so future retries are not blocked', async () => {
      constructedEvent = {
        id: 'evt_failing_1',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_fail' } },
      }

      mockProcessStripeWebhookEvent.mockRejectedValueOnce(new Error('Database lock timeout'))

      const req1 = new NextRequest('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_valid' },
        body: JSON.stringify(constructedEvent),
      })

      const res1 = await POST(req1)
      expect(res1.status).toBe(500)
      const data1 = await res1.json()
      expect(data1).toEqual({ error: 'Webhook handler failed' })

      // Event should be unmarked, allowing retry to succeed
      mockProcessStripeWebhookEvent.mockResolvedValueOnce({ id: 'escrow_1' })

      const req2 = new NextRequest('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 'sig_valid' },
        body: JSON.stringify(constructedEvent),
      })

      const res2 = await POST(req2)
      expect(res2.status).toBe(200)
      const data2 = await res2.json()
      expect(data2).toEqual({ received: true })
      expect(mockProcessStripeWebhookEvent).toHaveBeenCalledTimes(2)
    })
  })
})
