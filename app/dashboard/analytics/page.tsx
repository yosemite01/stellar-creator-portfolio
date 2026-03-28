'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  EarningsChart,
  ConversionFunnel,
  PerformanceRadar,
  PeerComparisonBar,
  TrendSparkline,
} from '@/components/widgets/analytics-chart'
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Star,
  Briefcase,
  Download,
  ArrowUpRight,
  Activity,
  Sparkles,
} from 'lucide-react'

/* ──────────────────────── Types ──────────────────────── */

interface AnalyticsData {
  range: { start: string; end: string }
  granularity: string
  earnings: {
    totalEarnings: number
    averagePerBounty: number
    completedCount: number
    trend: number
    byCategory: Record<string, number>
  }
  performance: {
    completionRate: number
    acceptanceRate: number
    activeBounties: number
    completedBounties: number
    avgRating: number
    totalApplications: number
  }
  funnel: { name: string; value: number; percentage: number }[]
  trend: { date: string; value: number }[]
  prediction: {
    nextPeriodEstimate: number
    growthRate: number
    confidence: number
  }
  peerComparison: {
    metric: string
    you: number
    average: number
    percentile: number
  }[]
}

type Preset = '7d' | '30d' | '90d' | '1y'

/* ──────────────────────── Helpers ─────────────────────── */

function fmt(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function TrendBadge({ value }: { value: number }) {
  if (value === 0) return <Badge variant="secondary" className="text-xs gap-1">0%</Badge>
  const positive = value > 0
  return (
    <Badge
      variant="secondary"
      className={`text-xs gap-1 ${positive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}
    >
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}{value}%
    </Badge>
  )
}

/* ──────────────────────── Page ────────────────────────── */

export default function AnalyticsPage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [preset, setPreset] = useState<Preset>('30d')
  const [exporting, setExporting] = useState(false)

  const fetchAnalytics = useCallback(async (p: Preset) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/analytics?preset=${p}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch {
      // silently fail — chart will show empty state
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/auth/login')
      return
    }
    if (authStatus === 'authenticated' || authStatus === 'loading') {
      fetchAnalytics(preset)
    }
  }, [authStatus, preset, router, fetchAnalytics])

  const handleExport = async (format: 'csv' | 'json') => {
    setExporting(true)
    try {
      const res = await fetch(`/api/analytics?preset=${preset}&format=${format}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `analytics-export.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // ignore
    } finally {
      setExporting(false)
    }
  }

  /* ──── Loading skeleton ──── */
  if (loading && !data) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Skeleton className="h-8 w-72 mb-2" />
          <Skeleton className="h-4 w-96 mb-8" />
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[380px] rounded-xl mb-8" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-[320px] rounded-xl" />
            <Skeleton className="h-[320px] rounded-xl" />
          </div>
        </main>
      </div>
    )
  }

  const d = data!

  /* ──── KPI stat cards ──── */
  const kpis = [
    {
      title: 'Total Earnings',
      value: fmt(d.earnings.totalEarnings),
      change: d.earnings.trend,
      icon: DollarSign,
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
    },
    {
      title: 'Completion Rate',
      value: `${d.performance.completionRate}%`,
      change: 0,
      icon: Target,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Avg Rating',
      value: d.performance.avgRating.toFixed(1),
      change: 0,
      icon: Star,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
    },
    {
      title: 'Active Bounties',
      value: String(d.performance.activeBounties),
      change: 0,
      icon: Briefcase,
      color: 'text-violet-500',
      bgColor: 'bg-violet-500/10',
    },
  ]

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ── Header Row ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon" className="h-8 w-8" id="back-to-dashboard">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Analytics</h1>
            </div>
            <p className="text-muted-foreground ml-11">
              Track your performance, earnings, and growth insights.
            </p>
          </div>

          <div className="flex items-center gap-2 ml-11 sm:ml-0">
            {/* Date range tabs */}
            <Tabs value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <TabsList id="date-range-tabs">
                <TabsTrigger value="7d" className="text-xs">7D</TabsTrigger>
                <TabsTrigger value="30d" className="text-xs">30D</TabsTrigger>
                <TabsTrigger value="90d" className="text-xs">90D</TabsTrigger>
                <TabsTrigger value="1y" className="text-xs">1Y</TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Export */}
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport('csv')}
                disabled={exporting}
                id="export-csv"
                className="text-xs gap-1"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport('json')}
                disabled={exporting}
                id="export-json"
                className="text-xs gap-1"
              >
                <Download className="h-3.5 w-3.5" />
                JSON
              </Button>
            </div>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
          {kpis.map((kpi) => (
            <Card key={kpi.title} className="relative overflow-hidden border-border/50 bg-card/80 backdrop-blur-sm transition-shadow hover:shadow-lg" id={`kpi-${kpi.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {kpi.title}
                </CardTitle>
                <div className={`p-2 rounded-lg ${kpi.bgColor}`}>
                  <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold">{kpi.value}</p>
                    {kpi.change !== 0 && (
                      <div className="mt-1">
                        <TrendBadge value={kpi.change} />
                      </div>
                    )}
                  </div>
                  {d.trend.length > 1 && (
                    <TrendSparkline data={d.trend.slice(-7)} color={kpi.color.replace('text-', 'var(--chart-')} />
                  )}
                </div>
              </CardContent>
              {/* Subtle gradient glow */}
              <div
                className={`absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-[0.07] blur-2xl ${kpi.bgColor}`}
                aria-hidden
              />
            </Card>
          ))}
        </div>

        {/* ── Earnings Chart ── */}
        <Card className="mb-8 border-border/50 bg-card/80 backdrop-blur-sm" id="earnings-chart-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  Earnings Over Time
                </CardTitle>
                <CardDescription>
                  {d.earnings.completedCount} bounties completed · {fmt(d.earnings.averagePerBounty)} avg
                </CardDescription>
              </div>
              <TrendBadge value={d.earnings.trend} />
            </div>
          </CardHeader>
          <CardContent>
            {d.trend.length > 0 ? (
              <EarningsChart data={d.trend} />
            ) : (
              <div className="flex items-center justify-center h-[320px] text-muted-foreground">
                No earnings data in this period
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Two-column: Funnel + Radar ── */}
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm" id="funnel-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-primary" />
                Conversion Funnel
              </CardTitle>
              <CardDescription>
                Bounty pipeline from posting to completion
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ConversionFunnel data={d.funnel} />
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/80 backdrop-blur-sm" id="radar-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Performance Overview
              </CardTitle>
              <CardDescription>
                Your metrics vs platform average
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PerformanceRadar
                data={d.peerComparison.map((p) => ({
                  metric: p.metric,
                  you: p.you,
                  average: p.average,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        {/* ── Peer Comparison ── */}
        <Card className="mb-8 border-border/50 bg-card/80 backdrop-blur-sm" id="peer-comparison-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-primary" />
                  Peer Comparison
                </CardTitle>
                <CardDescription>
                  How you stack up against other creators on the platform
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <PeerComparisonBar
              data={d.peerComparison.map((p) => ({
                metric: p.metric,
                you: p.you,
                average: p.average,
              }))}
            />
          </CardContent>
        </Card>

        {/* ── Predictive Insights ── */}
        {d.prediction.confidence > 0 && (
          <Card className="border-border/50 bg-gradient-to-br from-primary/5 via-card/80 to-accent/5 backdrop-blur-sm" id="prediction-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Predictive Insights
              </CardTitle>
              <CardDescription>
                AI-powered projections based on your performance trends
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Next Period Estimate</p>
                  <p className="text-3xl font-bold">{fmt(d.prediction.nextPeriodEstimate)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Growth Rate</p>
                  <div className="flex items-center gap-2">
                    <p className="text-3xl font-bold">{d.prediction.growthRate}%</p>
                    <TrendBadge value={d.prediction.growthRate} />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Confidence</p>
                  <p className="text-3xl font-bold">{Math.round(d.prediction.confidence * 100)}%</p>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-2">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-700"
                      style={{ width: `${d.prediction.confidence * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
