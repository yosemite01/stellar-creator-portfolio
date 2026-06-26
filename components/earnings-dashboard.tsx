'use client'

import { useMemo, useState } from 'react'
import { Download, DollarSign, TrendingUp, Clock, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  mockTransactions,
  computeSummary,
  type EarningTransaction,
} from '@/lib/earnings-data'

const PAGE_SIZE = 5

function fmt(usd: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd)
}

// ── CSV export ────────────────────────────────────────────────────────────────
function toCSV(rows: EarningTransaction[]): string {
  const headers = ['Date', 'Bounty ID', 'Bounty Title', 'Client', 'Amount', 'Currency', 'USD Equivalent', 'Status', 'Tx Hash']
  const lines = rows.map((r) => [
    new Date(r.date).toISOString().slice(0, 10),
    r.bountyId,
    `"${r.bountyTitle.replace(/"/g, '""')}"`,
    `"${r.clientName.replace(/"/g, '""')}"`,
    r.amount,
    r.currency,
    r.usdEquivalent,
    r.status,
    r.txHash,
  ].join(','))
  return [headers.join(','), ...lines].join('\n')
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── 1099-NEC text template ────────────────────────────────────────────────────
function generate1099(rows: EarningTransaction[], totalUSD: number): string {
  return [
    '1099-NEC EQUIVALENT — NON-EMPLOYEE COMPENSATION',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Total Non-Employee Compensation (Box 1): ${fmt(totalUSD)}`,
    '',
    'TRANSACTION DETAIL',
    '─'.repeat(60),
    ...rows.map((r) =>
      `${new Date(r.date).toISOString().slice(0, 10)}  ${r.bountyTitle.padEnd(35)} ${fmt(r.usdEquivalent)}`
    ),
    '─'.repeat(60),
    `TOTAL  ${fmt(totalUSD)}`,
    '',
    'NOTE: This document is for reference only. Consult a tax professional.',
  ].join('\n')
}

// ── VAT invoice text template ─────────────────────────────────────────────────
function generateVAT(rows: EarningTransaction[], totalUSD: number): string {
  const vatRate = 0.20
  const netAmount = totalUSD
  const vatAmount = parseFloat((totalUSD * vatRate).toFixed(2))
  const grossAmount = parseFloat((netAmount + vatAmount).toFixed(2))
  return [
    'VAT INVOICE',
    `Invoice Date: ${new Date().toISOString().slice(0, 10)}`,
    '',
    'SERVICES RENDERED',
    '─'.repeat(60),
    ...rows.map((r) =>
      `${new Date(r.date).toISOString().slice(0, 10)}  ${r.bountyTitle.padEnd(35)} ${fmt(r.usdEquivalent)}`
    ),
    '─'.repeat(60),
    `Net Amount:   ${fmt(netAmount)}`,
    `VAT (20%):    ${fmt(vatAmount)}`,
    `Gross Amount: ${fmt(grossAmount)}`,
    '',
    'NOTE: This document is for reference only. Consult a tax professional.',
  ].join('\n')
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_VARIANT: Record<EarningTransaction['status'], 'default' | 'secondary' | 'destructive'> = {
  completed: 'default',
  pending: 'secondary',
  failed: 'destructive',
}

export function EarningsDashboard() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    return mockTransactions.filter((tx) => {
      const t = new Date(tx.date).getTime()
      if (dateFrom && t < new Date(dateFrom).getTime()) return false
      if (dateTo && t > new Date(dateTo + 'T23:59:59').getTime()) return false
      return true
    })
  }, [dateFrom, dateTo])

  const summary = useMemo(() => computeSummary(filtered), [filtered])
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const completedFiltered = filtered.filter((t) => t.status === 'completed')
  const completedTotal = completedFiltered.reduce((s, t) => s + t.usdEquivalent, 0)

  function handleCSV() {
    downloadFile(toCSV(filtered), 'earnings.csv', 'text/csv')
  }
  function handle1099() {
    downloadFile(generate1099(completedFiltered, completedTotal), '1099-nec.txt', 'text/plain')
  }
  function handleVAT() {
    downloadFile(generateVAT(completedFiltered, completedTotal), 'vat-invoice.txt', 'text/plain')
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4" /> This Year
            </CardDescription>
            <CardTitle className="text-2xl">{fmt(summary.totalThisYear)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-4 w-4" /> This Month
            </CardDescription>
            <CardTitle className="text-2xl">{fmt(summary.totalThisMonth)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Clock className="h-4 w-4" /> Pending Escrow
            </CardDescription>
            <CardTitle className="text-2xl">{fmt(summary.pendingEscrow)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters + export */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction History</CardTitle>
          <CardDescription>All completed bounty payments. Amounts shown in USD equivalent.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date range filter */}
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="dateFrom">From</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dateTo">To</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                className="w-40"
              />
            </div>
            {(dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); setPage(1) }}>
                Clear
              </Button>
            )}
            <div className="flex gap-2 ml-auto flex-wrap">
              <Button variant="outline" size="sm" onClick={handleCSV} className="gap-1">
                <Download className="h-4 w-4" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handle1099} className="gap-1">
                <FileText className="h-4 w-4" /> 1099-NEC (US)
              </Button>
              <Button variant="outline" size="sm" onClick={handleVAT} className="gap-1">
                <FileText className="h-4 w-4" /> VAT Invoice (EU)
              </Button>
            </div>
          </div>

          {/* Transaction table */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Bounty</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">USD Equiv.</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No transactions found.
                    </td>
                  </tr>
                ) : paginated.map((tx) => (
                  <tr key={tx.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {new Date(tx.date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate" title={tx.bountyTitle}>
                      {tx.bountyTitle}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{tx.clientName}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {tx.amount.toLocaleString()} {tx.currency}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      {fmt(tx.usdEquivalent)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[tx.status]} className="capitalize text-xs">
                        {tx.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {filtered.length} transactions · Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
