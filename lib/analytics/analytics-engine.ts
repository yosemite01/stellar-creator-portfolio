/**
 * Analytics Engine — Pure computation module.
 *
 * Every function is side-effect-free: data in → metrics out.
 * All monetary values are in cents to avoid floating-point drift.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DateRange {
  start: Date
  end: Date
}

export type DatePreset = '7d' | '30d' | '90d' | '1y' | 'all'

export type Granularity = 'daily' | 'weekly' | 'monthly'

export interface BountyRecord {
  id: string
  title: string
  budget: number            // cents
  status: 'open' | 'in-progress' | 'completed' | 'cancelled'
  category: string | null
  createdAt: string         // ISO-8601
  updatedAt: string
  creatorId: string
}

export interface ApplicationRecord {
  id: string
  bountyId: string
  applicantId: string
  proposedBudget: number    // cents
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
  createdAt: string
  updatedAt: string
}

// ─── Output metric shapes ─────────────────────────────────────────────────────

export interface EarningsMetrics {
  totalEarnings: number
  averagePerBounty: number
  completedCount: number
  trend: number             // % change vs previous period
  byCategory: Record<string, number>
}

export interface PerformanceMetrics {
  completionRate: number    // 0–100
  acceptanceRate: number    // 0–100
  activeBounties: number
  completedBounties: number
  avgRating: number
  totalApplications: number
}

export interface FunnelStage {
  name: string
  value: number
  percentage: number
}

export interface TrendPoint {
  date: string              // label for the bucket
  value: number
}

export interface PeerComparison {
  metric: string
  you: number
  average: number
  percentile: number        // 0–100
}

export interface PredictiveTrend {
  nextPeriodEstimate: number
  growthRate: number
  confidence: number        // 0–1
}

export interface ExportPayload {
  format: 'csv' | 'json'
  data: string
  filename: string
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function dateRangeFromPreset(preset: DatePreset, now = new Date()): DateRange {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 7)
      break
    case '30d':
      start.setDate(start.getDate() - 30)
      break
    case '90d':
      start.setDate(start.getDate() - 90)
      break
    case '1y':
      start.setFullYear(start.getFullYear() - 1)
      break
    case 'all':
      start.setFullYear(2020, 0, 1)
      break
  }
  return { start, end }
}

export function isWithinRange(dateStr: string, range: DateRange): boolean {
  const d = new Date(dateStr)
  return d >= range.start && d <= range.end
}

function previousRange(range: DateRange): DateRange {
  const durationMs = range.end.getTime() - range.start.getTime()
  return {
    start: new Date(range.start.getTime() - durationMs),
    end: new Date(range.start.getTime() - 1),
  }
}

// ─── Earnings ─────────────────────────────────────────────────────────────────

export function computeEarningsMetrics(
  bounties: BountyRecord[],
  _applications: ApplicationRecord[],
  range: DateRange,
): EarningsMetrics {
  const inRange = bounties.filter(
    (b) => b.status === 'completed' && isWithinRange(b.updatedAt, range),
  )
  const prevRange = previousRange(range)
  const inPrev = bounties.filter(
    (b) => b.status === 'completed' && isWithinRange(b.updatedAt, prevRange),
  )

  const total = inRange.reduce((s, b) => s + b.budget, 0)
  const prevTotal = inPrev.reduce((s, b) => s + b.budget, 0)

  const byCategory: Record<string, number> = {}
  for (const b of inRange) {
    const cat = b.category || 'Uncategorized'
    byCategory[cat] = (byCategory[cat] || 0) + b.budget
  }

  return {
    totalEarnings: total,
    averagePerBounty: inRange.length ? Math.round(total / inRange.length) : 0,
    completedCount: inRange.length,
    trend: prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0,
    byCategory,
  }
}

// ─── Performance ──────────────────────────────────────────────────────────────

export function computePerformanceMetrics(
  bounties: BountyRecord[],
  applications: ApplicationRecord[],
): PerformanceMetrics {
  const completed = bounties.filter((b) => b.status === 'completed').length
  const total = bounties.length
  const active = bounties.filter(
    (b) => b.status === 'open' || b.status === 'in-progress',
  ).length

  const accepted = applications.filter((a) => a.status === 'accepted').length
  const totalApps = applications.length

  return {
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    acceptanceRate: totalApps ? Math.round((accepted / totalApps) * 100) : 0,
    activeBounties: active,
    completedBounties: completed,
    avgRating: 4.5, // placeholder — no ratings table yet
    totalApplications: totalApps,
  }
}

// ─── Conversion funnel ───────────────────────────────────────────────────────

export function computeConversionFunnel(
  bounties: BountyRecord[],
  applications: ApplicationRecord[],
): FunnelStage[] {
  const posted = bounties.length
  const applied = new Set(applications.map((a) => a.bountyId)).size
  const accepted = applications.filter((a) => a.status === 'accepted').length
  const completed = bounties.filter((b) => b.status === 'completed').length

  const stages = [
    { name: 'Bounties Posted', value: posted },
    { name: 'Received Applications', value: applied },
    { name: 'Applications Accepted', value: accepted },
    { name: 'Bounties Completed', value: completed },
  ]

  return stages.map((s) => ({
    ...s,
    percentage: posted ? Math.round((s.value / posted) * 100) : 0,
  }))
}

// ─── Trend bucketing ──────────────────────────────────────────────────────────

function bucketKey(date: Date, granularity: Granularity): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  switch (granularity) {
    case 'daily':
      return `${y}-${m}-${d}`
    case 'weekly': {
      // ISO week start (Monday)
      const day = date.getDay() || 7
      const monday = new Date(date)
      monday.setDate(date.getDate() - day + 1)
      const wm = String(monday.getMonth() + 1).padStart(2, '0')
      const wd = String(monday.getDate()).padStart(2, '0')
      return `${monday.getFullYear()}-${wm}-${wd}`
    }
    case 'monthly':
      return `${y}-${m}`
  }
}

export function computeTrendData(
  items: { date: string; value: number }[],
  range: DateRange,
  granularity: Granularity,
): TrendPoint[] {
  const filtered = items.filter((i) => isWithinRange(i.date, range))
  const buckets: Record<string, number> = {}

  for (const item of filtered) {
    const key = bucketKey(new Date(item.date), granularity)
    buckets[key] = (buckets[key] || 0) + item.value
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }))
}

// ─── Peer comparison ──────────────────────────────────────────────────────────

export function computePeerComparison(
  userMetrics: Record<string, number>,
  platformAverages: Record<string, number>,
): PeerComparison[] {
  return Object.keys(userMetrics).map((metric) => {
    const you = userMetrics[metric]
    const avg = platformAverages[metric] || 1
    // Simplified percentile: ratio-based (capped at 99)
    const percentile = Math.min(99, Math.round((you / avg) * 50))
    return { metric, you, average: avg, percentile }
  })
}

// ─── Predictive trends ───────────────────────────────────────────────────────

export function computePredictiveTrends(
  historical: TrendPoint[],
): PredictiveTrend {
  if (historical.length < 2) {
    return { nextPeriodEstimate: 0, growthRate: 0, confidence: 0 }
  }

  // Simple linear regression: y = mx + b
  const n = historical.length
  const xs = historical.map((_, i) => i)
  const ys = historical.map((p) => p.value)

  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const sumX2 = xs.reduce((a, x) => a + x * x, 0)

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) {
    return { nextPeriodEstimate: ys[n - 1], growthRate: 0, confidence: 0 }
  }

  const m = (n * sumXY - sumX * sumY) / denom
  const b = (sumY - m * sumX) / n

  const nextEstimate = Math.max(0, Math.round(m * n + b))
  const lastValue = ys[n - 1] || 1
  const growthRate = Math.round((m / lastValue) * 100)

  // R² for confidence
  const yMean = sumY / n
  const ssTot = ys.reduce((a, y) => a + (y - yMean) ** 2, 0)
  const ssRes = ys.reduce((a, y, i) => {
    const predicted = m * xs[i] + b
    return a + (y - predicted) ** 2
  }, 0)
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0

  return {
    nextPeriodEstimate: nextEstimate,
    growthRate,
    confidence: Math.max(0, Math.min(1, parseFloat(r2.toFixed(2)))),
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function formatDataForExport(
  metrics: Record<string, unknown>,
  format: 'csv' | 'json',
): ExportPayload {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  if (format === 'json') {
    return {
      format: 'json',
      data: JSON.stringify(metrics, null, 2),
      filename: `analytics-${timestamp}.json`,
    }
  }

  // CSV: flatten to rows
  const rows: string[][] = []
  rows.push(['Metric', 'Value'])

  function flatten(obj: Record<string, unknown>, prefix = '') {
    for (const [key, val] of Object.entries(obj)) {
      const label = prefix ? `${prefix}.${key}` : key
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        flatten(val as Record<string, unknown>, label)
      } else {
        rows.push([label, String(val)])
      }
    }
  }
  flatten(metrics)

  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
  return {
    format: 'csv',
    data: csv,
    filename: `analytics-${timestamp}.csv`,
  }
}

// ─── Mock data generators (development fallback) ─────────────────────────────

export function generateMockBounties(count = 40, userId = 'user-1'): BountyRecord[] {
  const categories = ['Design', 'Development', 'Writing', 'Marketing', 'Video']
  const statuses: BountyRecord['status'][] = ['open', 'in-progress', 'completed', 'cancelled']
  const records: BountyRecord[] = []

  for (let i = 0; i < count; i++) {
    const created = new Date()
    created.setDate(created.getDate() - Math.floor(Math.random() * 365))
    const updated = new Date(created)
    updated.setDate(created.getDate() + Math.floor(Math.random() * 30))

    // Weight towards completed for realistic data
    const statusIdx = Math.random() < 0.45 ? 2 : Math.random() < 0.7 ? 0 : Math.random() < 0.85 ? 1 : 3

    records.push({
      id: `bounty-${i}`,
      title: `Bounty ${i + 1}`,
      budget: (Math.floor(Math.random() * 50) + 5) * 10000, // $50–$550 in cents
      status: statuses[statusIdx],
      category: categories[Math.floor(Math.random() * categories.length)],
      createdAt: created.toISOString(),
      updatedAt: updated.toISOString(),
      creatorId: userId,
    })
  }
  return records
}

export function generateMockApplications(
  bounties: BountyRecord[],
  userId = 'user-1',
): ApplicationRecord[] {
  const statuses: ApplicationRecord['status'][] = ['pending', 'accepted', 'rejected', 'withdrawn']
  const records: ApplicationRecord[] = []
  let idx = 0

  for (const bounty of bounties) {
    const appCount = Math.floor(Math.random() * 5) + 1
    for (let j = 0; j < appCount; j++) {
      const created = new Date(bounty.createdAt)
      created.setDate(created.getDate() + Math.floor(Math.random() * 7))

      // Weight accepted for completed bounties
      let statusIdx = Math.floor(Math.random() * statuses.length)
      if (bounty.status === 'completed' && j === 0) statusIdx = 1

      records.push({
        id: `app-${idx}`,
        bountyId: bounty.id,
        applicantId: j === 0 ? userId : `user-${j + 10}`,
        proposedBudget: bounty.budget + (Math.floor(Math.random() * 10) - 5) * 1000,
        status: statuses[statusIdx],
        createdAt: created.toISOString(),
        updatedAt: created.toISOString(),
      })
      idx++
    }
  }
  return records
}

// ─── Platform averages (mock) ─────────────────────────────────────────────────

export const MOCK_PLATFORM_AVERAGES: Record<string, number> = {
  'Completion Rate': 62,
  'Acceptance Rate': 35,
  'Avg Earnings': 28000, // cents = $280
  'Active Bounties': 3,
  'Rating': 4.2,
}
