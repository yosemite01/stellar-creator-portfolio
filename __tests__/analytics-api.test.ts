import { describe, it, expect } from 'vitest'

/**
 * Analytics API integration tests.
 *
 * We import the route handler directly and invoke it with a crafted
 * NextRequest — no running server required.
 */

import { GET } from '@/app/api/analytics/route'
import { NextRequest } from 'next/server'

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost:3000/api/analytics')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new NextRequest(url)
}

describe('GET /api/analytics', () => {
  it('returns 200 with valid preset', async () => {
    const res = await GET(makeRequest({ preset: '30d' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.earnings).toBeDefined()
    expect(body.performance).toBeDefined()
    expect(body.funnel).toBeDefined()
    expect(body.trend).toBeDefined()
    expect(body.prediction).toBeDefined()
    expect(body.peerComparison).toBeDefined()
  })

  it('defaults to 30d if no preset given', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.range).toBeDefined()
  })

  it('accepts custom date range', async () => {
    const res = await GET(makeRequest({
      startDate: '2025-01-01',
      endDate: '2025-06-01',
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(new Date(body.range.start).getFullYear()).toBe(2025)
  })

  it('returns 400 for invalid date range (start > end)', async () => {
    const res = await GET(makeRequest({
      startDate: '2025-06-30',
      endDate: '2025-06-01',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid date range/)
  })

  it('returns 400 for invalid preset', async () => {
    const res = await GET(makeRequest({ preset: 'invalid' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid preset/)
  })

  it('returns CSV when format=csv', async () => {
    const res = await GET(makeRequest({ preset: '30d', format: 'csv' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment/)
    const text = await res.text()
    expect(text).toContain('Metric')
  })

  it('returns correct granularity for short range', async () => {
    const res = await GET(makeRequest({ preset: '7d' }))
    const body = await res.json()
    expect(body.granularity).toBe('daily')
  })

  it('returns correct granularity for long range', async () => {
    const res = await GET(makeRequest({ preset: '1y' }))
    const body = await res.json()
    expect(['weekly', 'monthly']).toContain(body.granularity)
  })

  it('accepts explicit granularity param', async () => {
    const res = await GET(makeRequest({ preset: '30d', granularity: 'monthly' }))
    const body = await res.json()
    expect(body.granularity).toBe('monthly')
  })

  it('earnings metrics have expected shape', async () => {
    const res = await GET(makeRequest({ preset: '1y' }))
    const body = await res.json()
    expect(typeof body.earnings.totalEarnings).toBe('number')
    expect(typeof body.earnings.averagePerBounty).toBe('number')
    expect(typeof body.earnings.completedCount).toBe('number')
    expect(typeof body.earnings.trend).toBe('number')
    expect(typeof body.earnings.byCategory).toBe('object')
  })

  it('funnel has four stages', async () => {
    const res = await GET(makeRequest({ preset: '30d' }))
    const body = await res.json()
    expect(body.funnel).toHaveLength(4)
    expect(body.funnel[0].name).toBe('Bounties Posted')
  })

  it('peer comparison returns array of metrics', async () => {
    const res = await GET(makeRequest({ preset: '30d' }))
    const body = await res.json()
    expect(Array.isArray(body.peerComparison)).toBe(true)
    expect(body.peerComparison.length).toBeGreaterThan(0)
    expect(body.peerComparison[0]).toHaveProperty('metric')
    expect(body.peerComparison[0]).toHaveProperty('you')
    expect(body.peerComparison[0]).toHaveProperty('average')
  })
})
