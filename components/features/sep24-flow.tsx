'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * SEP-24 interactive deposit/withdraw flow.
 *
 * TODO: not implemented yet. This currently only tracks UI state; the actual
 * SEP-24 interactive URL request (POST /transactions/deposit/interactive or
 * /transactions/withdraw/interactive against the anchor's TRANSFER_SERVER)
 * and transaction-status polling (GET /transaction?id=...) still need to be
 * wired in. See IMPLEMENTATION_NOTES.md and __tests__/sep24-flow.e2e.test.ts
 * for the test cases scoped alongside this implementation.
 */

export type Sep24FlowKind = 'deposit' | 'withdraw'

export type Sep24TransactionStatus =
  | 'idle'
  | 'incomplete'
  | 'pending_anchor'
  | 'completed'
  | 'error'

export interface Sep24FlowProps {
  kind: Sep24FlowKind
  assetCode: string
  anchorTransferServerUrl: string
  account: string
  onStatusChange?: (status: Sep24TransactionStatus) => void
}

export function Sep24Flow({ kind, assetCode, onStatusChange }: Sep24FlowProps) {
  const [status, setStatus] = useState<Sep24TransactionStatus>('idle')

  const startFlow = async () => {
    // TODO: request the interactive URL from the anchor's TRANSFER_SERVER,
    // open it (popup/iframe), then poll /transaction until status is
    // terminal (completed | error). Update `status` accordingly.
    setStatus('incomplete')
    onStatusChange?.('incomplete')
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">
        {kind === 'deposit' ? 'Deposit' : 'Withdraw'} {assetCode} via anchor
        (SEP-24) — not yet implemented.
      </p>
      <Button onClick={startFlow} disabled={status !== 'idle'}>
        Start {kind}
      </Button>
      {status !== 'idle' && (
        <p className="text-xs text-muted-foreground">Status: {status}</p>
      )}
    </div>
  )
}
