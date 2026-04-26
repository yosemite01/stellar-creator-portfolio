import { describe, it, expect } from 'vitest'
import {
  dateRangeFromPreset,
  isWithinRange,
  computeEarningsMetrics,
  computePerformanceMetrics,
  computeConversionFunnel,
  computeTrendData,
  computePeerComparison,
  computePredictiveTrends,
  formatDataForExport,
  generateMockBounties,
  generateMockApplications,
  type BountyRecord,
  type ApplicationRecord,
  type DateRange,
  type TrendPoint,
} from '@/lib/analytics/analytics-engine'

/* ─── Fixtures ─────────────────────────────────────────────────────────────── */

const NOW = new Date('2025-06-15T12:00:00Z')

function makeBounty(overrides: Partial<BountyRecord> = {}): BountyRecord {
  return {
    id: 'b-1',
    title: 'Test Bounty',
    budget: 50000,
    status: 'completed',
    category: 'Design',
    createdAt: '2025-06-01T00:00:00Z',
    updatedAt: '2025-06-10T00:00:00Z',
    creatorId: 'user-1',
    ...overrides,
  }
}

function makeApp(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: 'a-1',
    bountyId: 'b-1',
    applicantId: 'user-1',
    proposedBudget: 50000,
    status: 'accepted',
    createdAt: '2025-06-02T00:00:00Z',
    updatedAt: '2025-06-02T00:00:00Z',
    ...overrides,
  }
}

/* ─── Date helpers ─────────────────────────────────────────────────────────── */

describe('dateRangeFromPreset', () => {
  it('creates a 7-day range', () => {
    const range = dateRangeFromPreset('7d', NOW)
    const days = (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)
    expect(days).toBeGreaterThanOrEqual(7)
    expect(days).toBeLessThan(9)
  })

  it('creates a 30-day range', () => {
    const range = dateRangeFromPreset('30d', NOW)
    const days = (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)
    expect(days).toBeGreaterThanOrEqual(30)
    expect(days).toBeLessThan(32)
  })

  it('creates a 1-year range', () => {
    const range = dateRangeFromPreset('1y', NOW)
    const days = (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24)
    expect(days).toBeGreaterThanOrEqual(365)
  })

  it('"all" starts from 2020', () => {
    const range = dateRangeFromPreset('all', NOW)
    expect(range.start.getFullYear()).toBe(2020)
  })
})

describe('isWithinRange', () => {
  it('returns true for date inside range', () => {
    const range: DateRange = {
      start: new Date('2025-06-01'),
      end: new Date('2025-06-30'),
    }
    expect(isWithinRange('2025-06-15T00:00:00Z', range)).toBe(true)
  })

  it('returns false for date outside range', () => {
    const range: DateRange = {
      start: new Date('2025-06-01'),
      end: new Date('2025-06-30'),
    }
    expect(isWithinRange('2025-07-15T00:00:00Z', range)).toBe(false)
  })

  it('returns true for dates on range boundaries', () => {
    const range: DateRange = {
      start: new Date('2025-06-01T00:00:00Z'),
      end: new Date('2025-06-30T23:59:59Z'),
    }
    expect(isWithinRange('2025-06-01T00:00:00Z', range)).toBe(true)
    expect(isWithinRange('2025-06-30T23:59:59Z', range)).toBe(true)
  })
})

/* ─── Earnings ─────────────────────────────────────────────────────────────── */

describe('computeEarningsMetrics', () => {
  const range: DateRange = {
    start: new Date('2025-06-01'),
    end: new Date('2025-06-30'),
  }

  it('sums completed bounty budgets within range', () => {
    const bounties = [
      makeBounty({ id: 'b-1', budget: 30000 }),
      makeBounty({ id: 'b-2', budget: 20000 }),
    ]
    const result = computeEarningsMetrics(bounties, [], range)
    expect(result.totalEarnings).toBe(50000)
    expect(result.completedCount).toBe(2)
    expect(result.averagePerBounty).toBe(25000)
  })

  it('excludes non-completed bounties', () => {
    const bounties = [
      makeBounty({ id: 'b-1', budget: 30000 }),
      makeBounty({ id: 'b-2', budget: 20000, status: 'open' }),
    ]
    const result = computeEarningsMetrics(bounties, [], range)
    expect(result.totalEarnings).toBe(30000)
    expect(result.completedCount).toBe(1)
  })

  it('excludes bounties outside date range', () => {
    const bounties = [
      makeBounty({ id: 'b-1', budget: 30000 }),
      makeBounty({ id: 'b-2', budget: 20000, updatedAt: '2025-07-15T00:00:00Z' }),
    ]
    const result = computeEarningsMetrics(bounties, [], range)
    expect(result.totalEarnings).toBe(30000)
  })

  it('returns zero for empty array', () => {
    const result = computeEarningsMetrics([], [], range)
    expect(result.totalEarnings).toBe(0)
    expect(result.averagePerBounty).toBe(0)
    expect(result.completedCount).toBe(0)
    expect(result.trend).toBe(0)
  })

  it('groups earnings by category', () => {
    const bounties = [
      makeBounty({ id: 'b-1', budget: 30000, category: 'Design' }),
      makeBounty({ id: 'b-2', budget: 20000, category: 'Writing' }),
      makeBounty({ id: 'b-3', budget: 10000, category: 'Design' }),
    ]
    const result = computeEarningsMetrics(bounties, [], range)
    expect(result.byCategory['Design']).toBe(40000)
    expect(result.byCategory['Writing']).toBe(20000)
  })

  it('labels null category as Uncategorized', () => {
    const bounties = [makeBounty({ category: null })]
    const result = computeEarningsMetrics(bounties, [], range)
    expect(result.byCategory['Uncategorized']).toBe(50000)
  })
})

/* ─── Performance ──────────────────────────────────────────────────────────── */

describe('computePerformanceMetrics', () => {
  it('calculates completion rate', () => {
    const bounties = [
      makeBounty({ id: 'b-1', status: 'completed' }),
      makeBounty({ id: 'b-2', status: 'open' }),
      makeBounty({ id: 'b-3', status: 'in-progress' }),
      makeBounty({ id: 'b-4', status: 'completed' }),
    ]
    const result = computePerformanceMetrics(bounties, [])
    expect(result.completionRate).toBe(50)
    expect(result.activeBounties).toBe(2)
    expect(result.completedBounties).toBe(2)
  })

  it('calculates acceptance rate', () => {
    const apps = [
      makeApp({ id: 'a-1', status: 'accepted' }),
      makeApp({ id: 'a-2', status: 'rejected' }),
      makeApp({ id: 'a-3', status: 'pending' }),
      makeApp({ id: 'a-4', status: 'accepted' }),
    ]
    const result = computePerformanceMetrics([], apps)
    expect(result.acceptanceRate).toBe(50)
    expect(result.totalApplications).toBe(4)
  })

  it('handles empty inputs', () => {
    const result = computePerformanceMetrics([], [])
    expect(result.completionRate).toBe(0)
    expect(result.acceptanceRate).toBe(0)
    expect(result.activeBounties).toBe(0)
  })
})

/* ─── Conversion funnel ───────────────────────────────────────────────────── */

describe('computeConversionFunnel', () => {
  it('returns four stages', () => {
    const bounties = [
      makeBounty({ id: 'b-1', status: 'completed' }),
      makeBounty({ id: 'b-2', status: 'open' }),
    ]
    const apps = [
      makeApp({ id: 'a-1', bountyId: 'b-1', status: 'accepted' }),
      makeApp({ id: 'a-2', bountyId: 'b-1', status: 'rejected' }),
    ]
    const result = computeConversionFunnel(bounties, apps)
    expect(result).toHaveLength(4)
    expect(result[0].name).toBe('Bounties Posted')
    expect(result[0].value).toBe(2)
    expect(result[3].name).toBe('Bounties Completed')
    expect(result[3].value).toBe(1)
  })

  it('calculates percentages relative to total posted', () => {
    const bounties = [
      makeBounty({ id: 'b-1', status: 'completed' }),
      makeBounty({ id: 'b-2', status: 'completed' }),
      makeBounty({ id: 'b-3', status: 'open' }),
      makeBounty({ id: 'b-4', status: 'open' }),
    ]
    const result = computeConversionFunnel(bounties, [])
    expect(result[0].percentage).toBe(100) // 4/4
    expect(result[3].percentage).toBe(50)  // 2/4
  })

  it('handles empty data', () => {
    const result = computeConversionFunnel([], [])
    expect(result[0].value).toBe(0)
    expect(result[0].percentage).toBe(0)
  })
})

/* ─── Trend data ───────────────────────────────────────────────────────────── */

describe('computeTrendData', () => {
  const range: DateRange = {
    start: new Date('2025-06-01'),
    end: new Date('2025-06-30'),
  }

  it('buckets items by day', () => {
    const items = [
      { date: '2025-06-10T00:00:00Z', value: 100 },
      { date: '2025-06-10T12:00:00Z', value: 200 },
      { date: '2025-06-11T00:00:00Z', value: 50 },
    ]
    const result = computeTrendData(items, range, 'daily')
    expect(result).toHaveLength(2)
    expect(result[0].value).toBe(300) // two items on June 10
    expect(result[1].value).toBe(50)
  })

  it('buckets items by month', () => {
    const items = [
      { date: '2025-06-05T00:00:00Z', value: 100 },
      { date: '2025-06-20T00:00:00Z', value: 200 },
    ]
    const result = computeTrendData(items, range, 'monthly')
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(300)
  })

  it('filters out items outside range', () => {
    const items = [
      { date: '2025-05-15T00:00:00Z', value: 100 },
      { date: '2025-06-15T00:00:00Z', value: 200 },
    ]
    const result = computeTrendData(items, range, 'daily')
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(200)
  })

  it('returns empty for no matching items', () => {
    const result = computeTrendData([], range, 'daily')
    expect(result).toHaveLength(0)
  })
})

/* ─── Peer comparison ──────────────────────────────────────────────────────── */

describe('computePeerComparison', () => {
  it('calculates percentile for each metric', () => {
    const user = { 'Completion': 80, 'Rating': 4.5 }
    const avg = { 'Completion': 60, 'Rating': 4.0 }
    const result = computePeerComparison(user, avg)
    expect(result).toHaveLength(2)
    expect(result[0].metric).toBe('Completion')
    expect(result[0].you).toBe(80)
    expect(result[0].average).toBe(60)
    expect(result[0].percentile).toBeGreaterThan(50)
  })

  it('caps percentile at 99', () => {
    const user = { 'Score': 10000 }
    const avg = { 'Score': 1 }
    const result = computePeerComparison(user, avg)
    expect(result[0].percentile).toBeLessThanOrEqual(99)
  })

  it('handles empty metrics', () => {
    const result = computePeerComparison({}, {})
    expect(result).toHaveLength(0)
  })
})

/* ─── Predictive trends ───────────────────────────────────────────────────── */

describe('computePredictiveTrends', () => {
  it('returns zero estimate for < 2 data points', () => {
    const result = computePredictiveTrends([])
    expect(result.nextPeriodEstimate).toBe(0)
    expect(result.confidence).toBe(0)
  })

  it('returns zero estimate for single point', () => {
    const result = computePredictiveTrends([{ date: '2025-06-01', value: 100 }])
    expect(result.nextPeriodEstimate).toBe(0)
    expect(result.confidence).toBe(0)
  })

  it('predicts increasing trend for ascending data', () => {
    const data: TrendPoint[] = [
      { date: '2025-06-01', value: 100 },
      { date: '2025-06-02', value: 200 },
      { date: '2025-06-03', value: 300 },
      { date: '2025-06-04', value: 400 },
    ]
    const result = computePredictiveTrends(data)
    expect(result.nextPeriodEstimate).toBeGreaterThan(400)
    expect(result.growthRate).toBeGreaterThan(0)
    expect(result.confidence).toBeGreaterThan(0.9) // perfect linear
  })

  it('returns non-negative estimate even for declining data', () => {
    const data: TrendPoint[] = [
      { date: '2025-06-01', value: 400 },
      { date: '2025-06-02', value: 300 },
      { date: '2025-06-03', value: 200 },
      { date: '2025-06-04', value: 100 },
    ]
    const result = computePredictiveTrends(data)
    expect(result.nextPeriodEstimate).toBeGreaterThanOrEqual(0)
    expect(result.growthRate).toBeLessThan(0)
  })

  it('confidence is between 0 and 1', () => {
    const data: TrendPoint[] = [
      { date: '2025-06-01', value: 100 },
      { date: '2025-06-02', value: 150 },
      { date: '2025-06-03', value: 90 },
      { date: '2025-06-04', value: 170 },
    ]
    const result = computePredictiveTrends(data)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })
})

/* ─── Export ───────────────────────────────────────────────────────────────── */

describe('formatDataForExport', () => {
  const sample = { earnings: 50000, rate: 85 }

  it('exports valid JSON', () => {
    const result = formatDataForExport(sample, 'json')
    expect(result.format).toBe('json')
    expect(JSON.parse(result.data)).toEqual(sample)
    expect(result.filename).toMatch(/\.json$/)
  })

  it('exports valid CSV', () => {
    const result = formatDataForExport(sample, 'csv')
    expect(result.format).toBe('csv')
    expect(result.data).toContain('Metric')
    expect(result.data).toContain('earnings')
    expect(result.data).toContain('50000')
    expect(result.filename).toMatch(/\.csv$/)
  })

  it('flattens nested objects in CSV', () => {
    const nested = { top: { inner: 42 } }
    const result = formatDataForExport(nested, 'csv')
    expect(result.data).toContain('top.inner')
    expect(result.data).toContain('42')
  })
})

/* ─── Mock data generators ─────────────────────────────────────────────────── */

describe('generateMockBounties', () => {
  it('generates the requested number of bounties', () => {
    const bounties = generateMockBounties(20)
    expect(bounties).toHaveLength(20)
  })

  it('each bounty has required fields', () => {
    const bounties = generateMockBounties(5)
    for (const b of bounties) {
      expect(b.id).toBeTruthy()
      expect(b.budget).toBeGreaterThan(0)
      expect(['open', 'in-progress', 'completed', 'cancelled']).toContain(b.status)
      expect(b.creatorId).toBeTruthy()
    }
  })
})

describe('generateMockApplications', () => {
  it('generates applications for each bounty', () => {
    const bounties = generateMockBounties(5)
    const apps = generateMockApplications(bounties)
    expect(apps.length).toBeGreaterThan(0)
    // Every app should reference an existing bounty
    const bountyIds = new Set(bounties.map((b) => b.id))
    for (const a of apps) {
      expect(bountyIds.has(a.bountyId)).toBe(true)
    }
  })
})
