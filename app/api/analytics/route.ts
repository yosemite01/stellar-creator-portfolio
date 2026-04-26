import { NextRequest, NextResponse } from 'next/server'
import {
  computeEarningsMetrics,
  computePerformanceMetrics,
  computeConversionFunnel,
  computeTrendData,
  computePeerComparison,
  computePredictiveTrends,
  formatDataForExport,
  dateRangeFromPreset,
  generateMockBounties,
  generateMockApplications,
  MOCK_PLATFORM_AVERAGES,
  type DatePreset,
  type DateRange,
  type Granularity,
} from '@/lib/analytics/analytics-engine'

const VALID_PRESETS = new Set(['7d', '30d', '90d', '1y', 'all'])

/**
 * GET /api/analytics
 *
 * Query params:
 *   preset   – 7d | 30d | 90d | 1y | all  (default: 30d)
 *   startDate / endDate – ISO-8601 (overrides preset)
 *   granularity – daily | weekly | monthly (default: auto)
 *   format   – json | csv  (default: json)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl

  // --- Date range -----------------------------------------------------------
  let range: DateRange
  const startParam = searchParams.get('startDate')
  const endParam = searchParams.get('endDate')
  const preset = (searchParams.get('preset') || '30d') as DatePreset

  if (startParam && endParam) {
    const start = new Date(startParam)
    const end = new Date(endParam)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return NextResponse.json(
        { error: 'Invalid date range. startDate must be before endDate.' },
        { status: 400 },
      )
    }
    range = { start, end }
  } else if (VALID_PRESETS.has(preset)) {
    range = dateRangeFromPreset(preset)
  } else {
    return NextResponse.json(
      { error: `Invalid preset. Must be one of: ${[...VALID_PRESETS].join(', ')}` },
      { status: 400 },
    )
  }

  // --- Granularity ----------------------------------------------------------
  const durationDays = Math.ceil(
    (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24),
  )
  const granularityParam = searchParams.get('granularity') as Granularity | null
  const granularity: Granularity =
    granularityParam && ['daily', 'weekly', 'monthly'].includes(granularityParam)
      ? granularityParam
      : durationDays <= 31
        ? 'daily'
        : durationDays <= 180
          ? 'weekly'
          : 'monthly'

  // --- Data (mock fallback) -------------------------------------------------
  const userId = 'user-1' // TODO: extract from session
  const bounties = generateMockBounties(40, userId)
  const applications = generateMockApplications(bounties, userId)

  // --- Compute metrics ------------------------------------------------------
  const earnings = computeEarningsMetrics(bounties, applications, range)
  const performance = computePerformanceMetrics(bounties, applications)
  const funnel = computeConversionFunnel(bounties, applications)

  const trendItems = bounties
    .filter((b) => b.status === 'completed')
    .map((b) => ({ date: b.updatedAt, value: b.budget }))
  const trend = computeTrendData(trendItems, range, granularity)
  const prediction = computePredictiveTrends(trend)

  const userMetrics: Record<string, number> = {
    'Completion Rate': performance.completionRate,
    'Acceptance Rate': performance.acceptanceRate,
    'Avg Earnings': earnings.averagePerBounty,
    'Active Bounties': performance.activeBounties,
    Rating: performance.avgRating,
  }
  const peerComparison = computePeerComparison(userMetrics, MOCK_PLATFORM_AVERAGES)

  const payload = {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    granularity,
    earnings,
    performance,
    funnel,
    trend,
    prediction,
    peerComparison,
  }

  // --- Export format ---------------------------------------------------------
  const format = searchParams.get('format')
  if (format === 'csv') {
    const exported = formatDataForExport(payload as unknown as Record<string, unknown>, 'csv')
    return new NextResponse(exported.data, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${exported.filename}"`,
      },
    })
  }

  return NextResponse.json(payload)
}
