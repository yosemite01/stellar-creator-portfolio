'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Calendar } from 'lucide-react'

/**
 * Status descriptions for each SEP-24 status.
 */
const STATUS_DESCRIPTIONS: Record<string, { title: string; description: string; color?: string }> = {
  incomplete: {
    title: 'Incomplete',
    description: 'The anchor needs more information to continue.',
    color: 'orange',
  },
  pending_user_transfer_start: {
    title: 'Send Funds',
    description: 'Send the funds to the anchor using the instructions below.',
    color: 'orange',
  },
  pending_user_transfer_complete: {
    title: 'Waiting for Anchor',
    description: 'Waiting for the anchor to confirm receipt of your funds.',
    color: 'yellow',
  },
  pending_external: {
    title: 'External Network',
    description: 'Waiting for the external payment network to confirm the transfer.',
    color: 'blue',
  },
  pending_anchor: {
    title: 'Anchor Processing',
    description: 'The anchor is processing your transaction.',
    color: 'blue',
  },
  pending_stellar: {
    title: 'Stellar Network',
    description: 'Waiting for the Stellar network to confirm the transaction.',
    color: 'blue',
  },
  pending_trust: {
    title: 'Add Trustline',
    description: 'Add a trustline for the asset to continue.',
    color: 'orange',
  },
  pending_user: {
    title: 'User Action Required',
    description: 'The anchor is waiting on you to complete a step in the anchor window.',
    color: 'yellow',
  },
  completed: {
    title: 'Completed',
    description: 'Transaction completed successfully.',
    color: 'green',
  },
  refunded: {
    title: 'Refunded',
    description: 'The transaction was refunded by the anchor.',
    color: 'gray',
  },
  expired: {
    title: 'Expired',
    description: 'The transaction expired before it was completed.',
    color: 'gray',
  },
  no_market: {
    title: 'No Market',
    description: 'The anchor has no market for this asset pair.',
    color: 'gray',
  },
  too_small: {
    title: 'Too Small',
    description: 'The amount is below the anchor’s minimum.',
    color: 'gray',
  },
  too_large: {
    title: 'Too Large',
    description: 'The amount is above the anchor’s maximum.',
    color: 'gray',
  },
  error: {
    title: 'Error',
    description: 'The anchor reported an error for this transaction.',
    color: 'red',
  },
}

interface Sep24Transaction {
  id: string
  anchorId: string
  transferServer: string
  kind: 'deposit' | 'withdrawal'
  assetCode: string
  amountIn?: string
  amountOut?: string
  amountFee?: string
  status: string
  message?: string
  moreInfoUrl?: string
  stellarTransactionId?: string
  externalTransactionId?: string
  startedAt: string
  completedAt?: string
  statusHistory: Sep24StatusEntry[]
}

interface Sep24StatusEntry {
  id: string
  status: string
  message?: string
  metadata?: unknown
  createdAt: string
}

interface Sep24TimelineProps {
  transaction: Sep24Transaction
  onRetry?: () => void
}

/**
 * Display a timeline of status changes for a SEP-24 transaction.
 */
export function Sep24Timeline({ transaction, onRetry }: Sep24TimelineProps) {
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null)

  const getStatusInfo = (status: string) => STATUS_DESCRIPTIONS[status] || {
    title: status,
    description: 'Unknown status',
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    })
  }

  const handleRetry = () => {
    onRetry?.()
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-xl">SEP-24 Transaction Timeline</span>
          <Badge variant={transaction.status === 'completed' ? 'default' : 'secondary'}>
            {transaction.kind}
          </Badge>
          <Badge variant={transaction.status === 'completed' ? 'default' : 'secondary'}>
            {transaction.assetCode}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Current status</p>
              <h3 className="text-lg font-medium capitalize">{getStatusInfo(transaction.status).title}</h3>
            </div>
            <Badge
              className="capitalize"
              variant={transaction.status === 'completed' ? 'default' : 'outline'}
            >
              {transaction.status}
            </Badge>
          </div>
          {transaction.message && (
            <p className="text-sm text-muted-foreground mt-2">{transaction.message}</p>
          )}
        </div>

        {/* Amount Information */}
        <div className="grid grid-cols-3 gap-4">
          {transaction.amountIn && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Amount In</p>
              <p className="font-medium">{transaction.amountIn} {transaction.assetCode}</p>
            </div>
          )}
          {transaction.amountOut && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Amount Out</p>
              <p className="font-medium">{transaction.amountOut} {transaction.assetCode}</p>
            </div>
          )}
          {transaction.amountFee && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Fee</p>
              <p className="font-medium">{transaction.amountFee} {transaction.assetCode}</p>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="space-y-6">
          <h4 className="text-sm font-medium text-muted-foreground">Status History</h4>
          <div className="space-y-4">
            {transaction.statusHistory.map((entry, index, array) => {
              const info = getStatusInfo(entry.status)
              const isLast = index === array.length - 1
              const isHovered = hoveredStatus === entry.id

              return (
                <div
                  key={entry.id}
                  className="relative pl-8"
                  onMouseEnter={() => setHoveredStatus(entry.id)}
                  onMouseLeave={() => setHoveredStatus(null)}
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-0 top-1.5 h-4 w-4 rounded-full border-2 transition-colors ${
                      isHovered ? 'ring-2 ring-offset-2 ring-ring' : ''
                    } ${
                      entry.status === 'completed'
                        ? 'bg-green-500 border-green-600'
                        : entry.status === 'error'
                        ? 'bg-red-500 border-red-600'
                        : entry.status === 'refunded' || entry.status === 'expired'
                        ? 'bg-gray-500 border-gray-600'
                        : entry.status === 'pending_user_transfer_start' || entry.status === 'pending_user'
                        ? 'bg-orange-500 border-orange-600'
                        : entry.status === 'pending_stellar' || entry.status === 'pending_external'
                        ? 'bg-blue-500 border-blue-600'
                        : entry.status === 'pending_anchor'
                        ? 'bg-yellow-500 border-yellow-600'
                        : 'bg-gray-400 border-gray-500'
                    }`}
                  />
                  
                  {/* Content */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium capitalize">{info.title}</p>
                        <p className="text-sm text-muted-foreground">{info.description}</p>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        {formatDate(entry.createdAt)}
                      </div>
                    </div>
                    
                    {entry.message && (
                      <p className="text-sm text-muted-foreground mt-1">{entry.message}</p>
                    )}
                    
                    {entry.metadata && (
                      <pre className="text-xs text-muted-foreground bg-muted p-2 rounded mt-1 overflow-x-auto">
                        {JSON.stringify(entry.metadata, null, 2)}
                      </pre>
                    )}
                  </div>

                  {/* Connector line */}
                  {!isLast && (
                    <div className="absolute left-2 top-6 bottom-[-16px] w-px bg-border" />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t">
          {transaction.status === 'error' && (
            <button
              onClick={handleRetry}
              className="text-sm text-destructive hover:underline"
            >
              Try again
            </button>
          )}
          {transaction.status === 'pending_user_transfer_start' && transaction.moreInfoUrl && (
            <a
              href={transaction.moreInfoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Open anchor window
            </a>
          )}
          {transaction.status === 'pending_anchor' && transaction.stellarTransactionId && (
            <a
              href={`https://stellar.expert/explorer/tx/${transaction.stellarTransactionId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              View on Stellar Expert
            </a>
          )}
        </div>

        {/* Transaction Details */}
        {transaction.stellarTransactionId && (
          <div className="space-y-2">
            <Separator />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Stellar Transaction ID</p>
              <p className="font-mono text-sm break-all">
                {transaction.stellarTransactionId}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Separator />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Started</p>
              <p className="text-sm">{formatDate(transaction.startedAt)}</p>
            </div>
            {transaction.completedAt && (
              <div>
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-sm">{formatDate(transaction.completedAt)}</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}