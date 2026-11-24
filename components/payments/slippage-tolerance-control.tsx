'use client';

import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { calculateMinShares } from '@/lib/utils/yield-slippage';

export interface SlippageToleranceControlProps {
  /** Shares quoted for the deposit at request time. */
  expectedShares: number;
  /** Actual shares the vault would currently mint, if known (e.g. from a fresh quote). */
  actualShares?: number;
  assetCode: string;
  /** Default tolerance in basis points. Defaults to 50 (0.50%). */
  defaultMaxSlippageBps?: number;
  onConfirm?: (minShares: number, maxSlippageBps: number) => void;
}

export function SlippageToleranceControl({
  expectedShares,
  actualShares,
  assetCode,
  defaultMaxSlippageBps = 50,
  onConfirm,
}: SlippageToleranceControlProps) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const [maxSlippageBps, setMaxSlippageBps] = useState(defaultMaxSlippageBps);

  const outOfRange =
    !Number.isFinite(maxSlippageBps) || maxSlippageBps < 0 || maxSlippageBps > 10_000;

  const minShares = useMemo(() => {
    if (outOfRange) return null;
    return calculateMinShares({ expectedShares, maxSlippageBps });
  }, [expectedShares, maxSlippageBps, outOfRange]);

  const belowMinimum =
    actualShares !== undefined && minShares !== null && actualShares < minShares;

  const describedBy = [helpId, outOfRange || belowMinimum ? errorId : null]
    .filter(Boolean)
    .join(' ');

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
        <Label htmlFor={inputId}>Max slippage tolerance (bps)</Label>
        <Input
          id={inputId}
          type="number"
          min={0}
          max={10_000}
          step={1}
          value={maxSlippageBps}
          aria-invalid={outOfRange || belowMinimum}
          aria-describedby={describedBy}
          onChange={(e) => setMaxSlippageBps(Number(e.target.value))}
        />
        <p id={helpId} className="text-xs text-muted-foreground">
          {outOfRange
            ? 'Enter a value between 0 and 10,000 basis points.'
            : `${(maxSlippageBps / 100).toFixed(2)}% maximum tolerated deviation from expected shares.`}
        </p>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-between text-sm"
      >
        <span className="text-muted-foreground">Recommended min. shares</span>
        <span className="font-medium">
          {minShares !== null ? minShares.toLocaleString() : '—'} {assetCode}
        </span>
      </div>

      {outOfRange && (
        <p id={errorId} className="text-xs text-destructive" role="alert" aria-live="assertive">
          Slippage tolerance must be between 0 and 10,000 basis points (0% to 100%).
        </p>
      )}

      {!outOfRange && belowMinimum && (
        <p id={errorId} className="text-xs text-destructive" role="alert" aria-live="assertive">
          Actual shares are below your minimum tolerance. Confirming would
          revert on-chain once deposit_to_yield enforces min_shares.
        </p>
      )}

      <Button
        type="button"
        disabled={minShares === null || belowMinimum}
        onClick={() => minShares !== null && onConfirm?.(minShares, maxSlippageBps)}
      >
        Confirm deposit
      </Button>
    </div>
  );
}
