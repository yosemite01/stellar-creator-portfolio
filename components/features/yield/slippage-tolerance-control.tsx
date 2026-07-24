'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { calculateMinShares } from '@/lib/utils/yield-slippage'

/**
 * Frontend half of the yield-deposit slippage-tolerance control described in
 * IMPLEMENTATION_NOTES.md#yield-deposit-slippage-tolerance. It's
 * presentational/standalone: it computes and surfaces `min_shares`, but does
 * not call `deposit_to_yield` directly, since that contract call doesn't
 * exist yet. Wire `onConfirm` up to the real deposit once it lands.
 */

export interface SlippageToleranceControlProps {
  /** Shares quoted for the deposit at request time. */
  expectedShares: number
  /** Actual shares the vault would currently mint, if known (e.g. from a fresh quote). */
  actualShares?: number
  assetCode: string
  /** Default tolerance in basis points. Defaults to 50 (0.50%). */
  defaultMaxSlippageBps?: number
  onConfirm?: (minShares: number, maxSlippageBps: number) => void
}

export function SlippageToleranceControl({
  expectedShares,
  actualShares,
  assetCode,
  defaultMaxSlippageBps = 50,
  onConfirm,
}: SlippageToleranceControlProps) {
  const [maxSlippageBps, setMaxSlippageBps] = useState(defaultMaxSlippageBps)

  const minShares = useMemo(() => {
    if (!Number.isFinite(maxSlippageBps) || maxSlippageBps < 0 || maxSlippageBps > 10_000) {
      return null
    }
    return calculateMinShares({ expectedShares, maxSlippageBps })
  }, [expectedShares, maxSlippageBps])

  const belowMinimum =
    actualShares !== undefined && minShares !== null && actualShares < minShares

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Expected shares</span>
        <span className="font-medium">
          {expectedShares.toLocaleString()} {assetCode}
        </span>
      </div>

      {actualShares !== undefined && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Actual shares</span>
          <span className={belowMinimum ? 'font-medium text-destructive' : 'font-medium'}>
            {actualShares.toLocaleString()} {assetCode}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="max-slippage-bps">Max slippage tolerance (bps)</Label>
        <Input
          id="max-slippage-bps"
          type="number"
          min={0}
          max={10_000}
          step={1}
          value={maxSlippageBps}
          onChange={(e) => setMaxSlippageBps(Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          {(maxSlippageBps / 100).toFixed(2)}% maximum tolerated deviation from expected shares.
        </p>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Recommended min. shares</span>
        <span className="font-medium">
          {minShares !== null ? minShares.toLocaleString() : '—'} {assetCode}
        </span>
      </div>

      {belowMinimum && (
        <p className="text-xs text-destructive" role="alert">
          Actual shares are below your minimum tolerance. Confirming would
          revert on-chain once deposit_to_yield enforces min_shares.
        </p>
      )}

      <Button
        disabled={minShares === null || belowMinimum}
        onClick={() => minShares !== null && onConfirm?.(minShares, maxSlippageBps)}
      >
        Confirm deposit
      </Button>
    </div>
  )
}
