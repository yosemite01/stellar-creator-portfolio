'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  SUPPORTED_CHAINS,
  getSwapQuote,
  formatRoutePath,
  getChainInfo,
  type ChainId,
} from '@/lib/swap/cross-chain-sdk'
import {
  ArrowRight,
  CheckCircle,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  Route,
  ShieldAlert,
  X,
  Zap,
  Wallet,
  Lock,
  Unlock,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Copy,
} from 'lucide-react'
import { toast } from 'sonner'

export type SwapStatus =
  | 'idle'
  | 'quote_requested'
  | 'quote_received'
  | 'htlc_locking'
  | 'htlc_locked'
  | 'destination_claiming'
  | 'destination_claimed'
  | 'refund_requested'
  | 'refunded'
  | 'error'
  | 'expired'
  | 'cancelled'

interface SwapSession {
  id: string
  fromChain: string
  toChain: string
  fromAmount: string
  toAmount: string
  minOut: string
  quoteExpiry: string
  htlcHash?: string
  status: SwapStatus
  phase?: string
  hops?: Array<{ chain: string; protocol: string; feeBps: number }>
}

interface CrossChainSwapUIProps {
  sessionId?: string
  onStatusChange?: (status: SwapStatus) => void
}

/**
 * Cross-chain swap UI with clear states for:
 * - Quote expiry (show countdown)
 * - Min-out enforcement
 * - Refund path
 * - Crash recovery
 */
export function CrossChainSwapUI({ sessionId, onStatusChange }: CrossChainSwapUIProps) {
  const [status, setStatus] = useState<SwapStatus>('idle')
  const [fromChain, setFromChain] = useState<ChainId>('stellar')
  const [toChain, setToChain] = useState<ChainId>('polygon')
  const [amount, setAmount] = useState('100')
  const [quote, setQuote] = useState<SwapSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [expiryCountdown, setExpiryCountdown] = useState<number>(0)

  useEffect(() => {
    if (sessionId) {
      // Resume from session ID
      void resumeSwap(sessionId)
    }
  }, [sessionId])

  useEffect(() => {
    // Countdown expiry
    if (quote?.quoteExpiry) {
      const updateCountdown = () => {
        const now = new Date().getTime()
        const expiry = new Date(quote.quoteExpiry).getTime()
        setExpiryCountdown(Math.max(0, Math.floor((expiry - now) / 1000)))
      }
      updateCountdown()
      const interval = setInterval(updateCountdown, 1000)
      return () => clearInterval(interval)
    }
  }, [quote?.quoteExpiry])

  const resumeSwap = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/swaps/${id}`)
      if (response.ok) {
        const data = await response.json()
        setQuote(data)
        setStatus(data.status as SwapStatus)
        onStatusChange?.(data.status as SwapStatus)
      } else if (response.status === 410) {
        setStatus('expired')
        toast.error('Quote has expired. Please request a new quote.')
      }
    } finally {
      setLoading(false)
    }
  }, [onStatusChange])

  const requestQuote = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/swaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromChain,
          toChain,
          fromAmount: amount,
          slippageBps: 50,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to request quote')
      }

      const data = await response.json()
      setQuote(data)
      setStatus('quote_received')
      onStatusChange?.('quote_received')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to request quote')
      setStatus('error')
      onStatusChange?.('error')
    } finally {
      setLoading(false)
    }
  }, [fromChain, toChain, amount, onStatusChange])

  const confirmQuote = useCallback(async () => {
    if (!quote) return

    setLoading(true)
    try {
      const response = await fetch(`/api/swaps/${quote.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toAmount: quote.toAmount,
          minOut: quote.minOut,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to confirm quote')
      }

      const data = await response.json()
      setQuote({ ...quote, status: 'htlc_locking' as SwapStatus })
      setStatus('htlc_locking')
      onStatusChange?.('htlc_locking')

      // Simulate HTLC lock
      setTimeout(() => {
        setQuote({ ...quote, status: 'htlc_locked' as SwapStatus })
        setStatus('htlc_locked')
        onStatusChange?.('htlc_locked')
      }, 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm quote')
      setStatus('error')
      onStatusChange?.('error')
    } finally {
      setLoading(false)
    }
  }, [quote, onStatusChange])

  const requestRefund = useCallback(async () => {
    if (!quote) return

    setLoading(true)
    try {
      const response = await fetch(`/api/swaps/${quote.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locktimeExpired: true,
          refundTxId: 'ref-123',
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to request refund')
      }

      const data = await response.json()
      setQuote({ ...quote, status: 'refund_requested' as SwapStatus })
      setStatus('refund_requested')
      onStatusChange?.('refund_requested')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to request refund')
      setStatus('error')
      onStatusChange?.('error')
    } finally {
      setLoading(false)
    }
  }, [quote, onStatusChange])

  // Status descriptions
  const getStatusInfo = useCallback((s: SwapStatus) => {
    switch (s) {
      case 'idle':
        return { title: 'Ready to Swap', description: 'Select your chain pair and amount' }
      case 'quote_requested':
        return { title: 'Getting Quote', description: 'Connecting to bridges...' }
      case 'quote_received':
        return { title: 'Quote Ready', description: 'Review the terms before locking' }
      case 'htlc_locking':
        return { title: 'Locking HTLC', description: 'Creating hash lock on source chain...' }
      case 'htlc_locked':
        return { title: 'HTLC Locked', description: 'Source chain locked. Waiting for destination...' }
      case 'destination_claiming':
        return { title: 'Claiming', description: 'Processing on destination chain...' }
      case 'destination_claimed':
        return { title: 'Swap Complete', description: 'Funds received!' }
      case 'refund_requested':
        return { title: 'Refund Initiated', description: 'Funds being returned...' }
      case 'refunded':
        return { title: 'Refunded', description: 'Funds returned to your wallet' }
      case 'error':
        return { title: 'Error', description: 'Something went wrong. Try again.' }
      case 'expired':
        return { title: 'Quote Expired', description: 'Request a new quote to continue' }
      case 'cancelled':
        return { title: 'Cancelled', description: 'Swap cancelled by user' }
      default:
        return { title: 'Unknown', description: '' }
    }
  }, [])

  // Countdown formatter
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Render
  const fromInfo = getChainInfo(fromChain)
  const toInfo = getChainInfo(toChain)
  const statusInfo = getStatusInfo(status)

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Cross-Chain Swap</h2>
          <p className="text-sm text-muted-foreground">{statusInfo.title}</p>
        </div>
        {status === 'quote_received' && (
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${expiryCountdown < 60 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            <Clock className="h-4 w-4" />
            {formatTime(expiryCountdown)}
          </div>
        )}
      </div>

      {/* Status Card */}
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-start gap-3">
          {status === 'error' && <ShieldAlert className="h-5 w-5 text-destructive mt-0.5" />}
          {status === 'expired' && <Clock className="h-5 w-5 text-amber-500 mt-0.5" />}
          {status === 'refunded' && <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />}
          {status === 'completed' && <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />}
          <div>
            <p className="font-medium text-sm">{statusInfo.title}</p>
            <p className="text-xs text-muted-foreground">{statusInfo.description}</p>
          </div>
        </div>

        {status === 'quote_received' && (
          <div className="mt-2 p-3 bg-amber-50 rounded-lg text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 inline mr-1" />
            Quote expires in {formatTime(expiryCountdown)}. Min-out: {quote?.minOut} {toInfo.nativeSymbol}
          </div>
        )}

        {status === 'refunded' && quote && (
          <div className="mt-2 p-3 bg-green-50 rounded-lg text-xs text-green-800">
            <CheckCircle className="h-4 w-4 inline mr-1" />
            Refund initiated. Funds will arrive in ~5-10 minutes.
          </div>
        )}

        {status === 'error' && (
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={requestQuote} size="sm" className="text-xs">
              <RefreshCw className="h-3 w-3 mr-1" /> Try Again
            </Button>
            <Button variant="outline" onClick={() => setStatus('cancelled')} size="sm" className="text-xs">
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Main Content */}
      {status === 'idle' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_CHAINS.map((chain) => (
              <button
                key={chain.id}
                type="button"
                onClick={() => setFromChain(chain.id)}
                className={`flex items-center gap-2 p-3 rounded-xl border text-left ${
                  fromChain === chain.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'
                }`}
              >
                <span className="text-lg">{chain.icon}</span>
                <span className="text-sm font-medium">{chain.name}</span>
              </button>
            ))}
          </div>

          <div className="flex justify-center">
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_CHAINS.filter((c) => c.id !== fromChain).map((chain) => (
              <button
                key={chain.id}
                type="button"
                onClick={() => setToChain(chain.id)}
                className={`flex items-center gap-2 p-3 rounded-xl border text-left ${
                  toChain === chain.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'
                }`}
              >
                <span className="text-lg">{chain.icon}</span>
                <span className="text-sm font-medium">{chain.name}</span>
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Amount ({fromInfo.nativeSymbol})</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm"
              />
              <Button variant="outline" onClick={requestQuote} disabled={loading} className="whitespace-nowrap">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Get Quote'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {status === 'quote_received' && quote && (
        <div className="space-y-4">
          <div className="rounded-xl bg-muted/40 p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">You send</span>
              <span className="font-semibold">{quote.fromAmount} {fromInfo.nativeSymbol}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">You receive</span>
              <div className="text-right">
                <span className="font-semibold text-primary block">≈ {quote.toAmount} {toInfo.nativeSymbol}</span>
                <span className="text-xs text-destructive">Min-out: {quote.minOut}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Route className="h-4 w-4 text-primary" />
              Routing Path
            </div>
            {quote.hops?.map((hop, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{hop.protocol} ({hop.chain})</span>
                <span>{hop.feeBps / 100}% fee</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStatus('cancelled')} className="flex-1">
              Cancel
            </Button>
            <Button onClick={confirmQuote} disabled={loading} className="flex-1 gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Lock HTLC
            </Button>
          </div>
        </div>
      )}

      {(status === 'htlc_locked' || status === 'destination_claiming' || status === 'completed') && quote && (
        <div className="text-center py-8">
          {status === 'htlc_locked' && <Lock className="h-12 w-12 text-primary mx-auto mb-4" />}
          {status === 'destination_claiming' && <Loader2 className="h-12 w-12 text-primary mx-auto mb-4 animate-spin" />}
          {status === 'completed' && <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />}
          
          <p className="text-lg font-semibold">
            {status === 'htlc_locked' ? 'HTLC Locked' : status === 'completed' ? 'Swap Complete' : 'Claiming...'}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            {status === 'htlc_locked' ? 'Waiting for destination leg...' : status === 'completed' ? 'Funds received!' : 'Processing on destination chain...'}
          </p>
        </div>
      )}

      {(status === 'refund_requested' || status === 'refunded') && quote && (
        <div className="space-y-4">
          <div className="text-center py-4">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <p className="text-lg font-semibold">Refund in Progress</p>
            <p className="text-sm text-muted-foreground mt-2">
              {status === 'refund_requested' ? 'Returning funds to your wallet...' : 'Funds have been returned.'}
            </p>
          </div>
          
          {quote.refundTxId && (
            <div className="p-4 rounded-xl bg-muted/40 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Refund Tx</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{quote.refundTxId.slice(0, 16)}...</span>
                  <button className="text-primary hover:underline">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}