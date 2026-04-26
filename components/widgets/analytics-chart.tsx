'use client'

import * as React from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
  Line,
  LineChart,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'

// ─── Earnings Area Chart ────────────────────────────────────────────────────

interface EarningsChartProps {
  data: { date: string; value: number }[]
}

const earningsConfig: ChartConfig = {
  value: {
    label: 'Earnings',
    color: 'var(--chart-1)',
  },
}

export function EarningsChart({ data }: EarningsChartProps) {
  const formatted = data.map((d) => ({
    date: d.date,
    value: d.value / 100, // cents → dollars
  }))

  return (
    <ChartContainer config={earningsConfig} className="h-[320px] w-full">
      <AreaChart data={formatted} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="earningsGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v: string) => {
            if (v.length === 7) return v  // monthly "2025-03"
            const d = new Date(v)
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(v: number) => `$${v.toLocaleString()}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Earnings']}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#earningsGradient)"
        />
      </AreaChart>
    </ChartContainer>
  )
}

// ─── Conversion Funnel ──────────────────────────────────────────────────────

interface FunnelStage {
  name: string
  value: number
  percentage: number
}

interface ConversionFunnelProps {
  data: FunnelStage[]
}

const funnelColors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
]

const funnelConfig: ChartConfig = {
  value: { label: 'Count', color: 'var(--chart-1)' },
}

export function ConversionFunnel({ data }: ConversionFunnelProps) {
  return (
    <ChartContainer config={funnelConfig} className="h-[280px] w-full">
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          tickLine={false}
          axisLine={false}
          width={160}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, _name, entry) => {
                const pct = (entry?.payload as FunnelStage)?.percentage ?? 0
                return [`${value} (${pct}%)`, 'Count']
              }}
            />
          }
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={32}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={funnelColors[idx % funnelColors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// ─── Performance Radar ──────────────────────────────────────────────────────

interface PerformanceRadarProps {
  data: { metric: string; you: number; average: number }[]
}

const radarConfig: ChartConfig = {
  you: { label: 'You', color: 'var(--chart-1)' },
  average: { label: 'Platform Avg', color: 'var(--chart-3)' },
}

export function PerformanceRadar({ data }: PerformanceRadarProps) {
  return (
    <ChartContainer config={radarConfig} className="h-[320px] w-full">
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
        />
        <PolarRadiusAxis tick={false} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Radar
          name="you"
          dataKey="you"
          stroke="var(--chart-1)"
          fill="var(--chart-1)"
          fillOpacity={0.3}
          strokeWidth={2}
        />
        <Radar
          name="average"
          dataKey="average"
          stroke="var(--chart-3)"
          fill="var(--chart-3)"
          fillOpacity={0.15}
          strokeWidth={2}
          strokeDasharray="5 5"
        />
      </RadarChart>
    </ChartContainer>
  )
}

// ─── Peer Comparison Bar ────────────────────────────────────────────────────

interface PeerComparisonBarProps {
  data: { metric: string; you: number; average: number }[]
}

const comparisonConfig: ChartConfig = {
  you: { label: 'You', color: 'var(--chart-1)' },
  average: { label: 'Platform Avg', color: 'var(--chart-4)' },
}

export function PeerComparisonBar({ data }: PeerComparisonBarProps) {
  return (
    <ChartContainer config={comparisonConfig} className="h-[280px] w-full">
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="metric" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="you" fill="var(--chart-1)" radius={[6, 6, 0, 0]} barSize={24} />
        <Bar dataKey="average" fill="var(--chart-4)" radius={[6, 6, 0, 0]} barSize={24} />
      </BarChart>
    </ChartContainer>
  )
}

// ─── Trend Sparkline ────────────────────────────────────────────────────────

interface TrendSparklineProps {
  data: { date: string; value: number }[]
  color?: string
}

const sparklineConfig: ChartConfig = {
  value: { label: 'Value', color: 'var(--chart-2)' },
}

export function TrendSparkline({ data, color = 'var(--chart-2)' }: TrendSparklineProps) {
  return (
    <ChartContainer config={sparklineConfig} className="h-[40px] w-[100px]">
      <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
        />
      </LineChart>
    </ChartContainer>
  )
}
