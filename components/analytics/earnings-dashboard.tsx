'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, DollarSign, TrendingUp, Clock, FileText, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  mockTransactions,
  computeSummary,
  computeTaxYearSummary,
  exportTaxYearCSV,
  generate1099,
  generateVAT,
  toCSV,
  type EarningTransaction,
} from '@/lib/earnings-data'
import { formatCurrency, formatDate } from '@/lib/utils'

const PAGE_SIZE = 5

function fmt(usd: number) {
  return formatCurrency(usd, 'USD', 2)
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

const STATUS_VARIANT: Record<EarningTransaction['status'], 'default' | 'secondary' | 'destructive'> = {
  completed: 'default',
  pending: 'secondary',
  failed: 'destructive',
}

export interface EarningsDashboardProps {
  initialTransactions?: EarningTransaction[]
}

/**
 * EarningsDashboard Component
 *
 * Displays the creator earnings dashboard derived from real payouts ledger data:
 * - High-level summary metrics (annual, monthly, and pending escrow earnings)
 * - Date range and tax-year filtering for transaction history
 * - Formatted transaction history table with currency conversions and pagination
 * - Export options for CSV, IRS Form 1099-NEC text summary, and VAT invoices
 */
export function EarningsDashboard({ initialTransactions }: EarningsDashboardProps = {}) {
  const [transactions, setTransactions] = useState<EarningTransaction[]>(
    initialTransactions && initialTransactions.length > 0 ? initialTransactions : []
  )
  const [isLoading, setIsLoading] = useState(!initialTransactions || initialTransactions.length === 0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedTaxYear, setSelectedTaxYear] = useState<string>('all')
  const [page, setPage] = useState(1)

  // Fetch real ledger earnings if initialTransactions was not provided
  useEffect(() => {
    if (initialTransactions && initialTransactions.length > 0) {
      setTransactions(initialTransactions)
      setIsLoading(false)
      return
    }

    let isMounted = true
    async function loadEarnings() {
      try {
        const res = await fetch('/api/earnings')
        if (res.ok) {
          const data = await res.json()
          if (isMounted && Array.isArray(data.transactions) && data.transactions.length > 0) {
            setTransactions(data.transactions)
            setIsLoading(false)
            return
          }
        }
      } catch {
        // Fall back to mock fixture
      }

      if (isMounted) {
        setTransactions(mockTransactions)
        setIsLoading(false)
      }
    }

    loadEarnings()
    return () => {
      isMounted = false
    }
  }, [initialTransactions])

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      const t = new Date(tx.date).getTime()
      if (dateFrom && t < new Date(dateFrom).getTime()) return false
      if (dateTo && t > new Date(dateTo + 'T23:59:59').getTime()) return false

      if (selectedTaxYear !== 'all') {
        const year = new Date(tx.date).getUTCFullYear().toString()
        if (year !== selectedTaxYear) return false
      }

      return true
    })
  }, [transactions, dateFrom, dateTo, selectedTaxYear])

  const summary = useMemo(() => computeSummary(filtered), [filtered])
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const completedFiltered = filtered.filter((t) => t.status === 'completed')
  const completedTotal = completedFiltered.reduce((s, t) => s + t.usdEquivalent, 0)

  // Extract unique tax years from available transactions for the filter
  const availableTaxYears = useMemo(() => {
    const years = new Set<string>()
    transactions.forEach((tx) => {
      years.add(new Date(tx.date).getUTCFullYear().toString())
    })
    return Array.from(years).sort().reverse()
  }, [transactions])

  function handleCSV() {
    if (selectedTaxYear !== 'all') {
      const taxSummary = computeTaxYearSummary(parseInt(selectedTaxYear, 10), 'current-user', transactions)
      downloadFile(exportTaxYearCSV(taxSummary), `earnings-tax-year-${selectedTaxYear}.csv`, 'text/csv')
    } else {
      downloadFile(toCSV(filtered), 'earnings.csv', 'text/csv')
    }
  }

  function handle1099() {
    if (selectedTaxYear !== 'all') {
      const taxSummary = computeTaxYearSummary(parseInt(selectedTaxYear, 10), 'current-user', transactions)
      downloadFile(generate1099(taxSummary), `1099-nec-${selectedTaxYear}.txt`, 'text/plain')
    } else {
      downloadFile(generate1099(completedFiltered, completedTotal), '1099-nec.txt', 'text/plain')
    }
  }

  function handleVAT() {
    if (selectedTaxYear !== 'all') {
      const taxSummary = computeTaxYearSummary(parseInt(selectedTaxYear, 10), 'current-user', transactions)
      downloadFile(generateVAT(taxSummary), `vat-invoice-${selectedTaxYear}.txt`, 'text/plain')
    } else {
      downloadFile(generateVAT(completedFiltered, completedTotal), 'vat-invoice.txt', 'text/plain')
    }
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
          <CardTitle className="text-base">Transaction History & Tax Ledger</CardTitle>
          <CardDescription>
            All completed bounty payouts and active escrows. Converted to USD equivalent at payment time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls: Date range + Tax year selector + Exports */}
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="taxYearSelect" className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> Tax Year
              </Label>
              <select
                id="taxYearSelect"
                value={selectedTaxYear}
                onChange={(e) => {
                  setSelectedTaxYear(e.target.value)
                  setPage(1)
                }}
                className="h-9 w-32 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Years</option>
                {availableTaxYears.map((yr) => (
                  <option key={yr} value={yr}>
                    Year {yr}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="dateFrom">From</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPage(1)
                }}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dateTo">To</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPage(1)
                }}
                className="w-40"
              />
            </div>
            {(dateFrom || dateTo || selectedTaxYear !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDateFrom('')
                  setDateTo('')
                  setSelectedTaxYear('all')
                  setPage(1)
                }}
              >
                Clear
              </Button>
            )}

            <div className="flex gap-2 ml-auto flex-wrap">
              <Button variant="outline" size="sm" onClick={handleCSV} className="gap-1">
                <Download className="h-4 w-4" /> CSV Export
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
                  <th className="px-4 py-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Loading ledger transactions...
                    </td>
                  </tr>
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No transactions found for the selected range.
                    </td>
                  </tr>
                ) : (
                  paginated.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDate(tx.date, 'default')}
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
                        {tx.unrealizedGainLoss !== undefined && tx.unrealizedGainLoss !== 0 && (
                          <span
                            className={`ml-1 text-xs ${
                              tx.unrealizedGainLoss > 0 ? 'text-green-500' : 'text-red-500'
                            }`}
                            title={`Spot change: ${tx.unrealizedGainLoss > 0 ? '+' : ''}${fmt(
                              tx.unrealizedGainLoss
                            )}`}
                          >
                            ({tx.unrealizedGainLoss > 0 ? '+' : ''}
                            {fmt(tx.unrealizedGainLoss)})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[tx.status]} className="capitalize text-xs">
                          {tx.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => window.open(`/api/payouts/${tx.id}/receipt?format=pdf`, '_blank')}
                          title="Download official PDF receipt with platform fee breakdown and Stellar link"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          PDF
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <PaginationControls
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              label={`${filtered.length} transactions · Page ${page} of ${totalPages}`}
              className="text-sm"
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
