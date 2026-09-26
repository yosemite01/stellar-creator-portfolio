'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  discoverTransferServer,
  isSuccessStatus,
  isTerminalStatus,
  openInteractiveWindow,
  pollUntilTerminal,
  Sep24Error,
  startInteractiveFlow,
  type Sep24Transaction,
} from '@/lib/stellar/sep24'

/**
 * SEP-24 interactive deposit/withdraw flow (Issue #1393).
 *
 * Previously a stub that only moved a local `status` variable. It now runs the
 * real protocol: discover the anchor's TRANSFER_SERVER, request an interactive
 * URL, open it, and poll `/transaction` to a terminal status.
 *
 * The polling is the part worth keeping: the anchor does its work out of band,
 * so the popup closing tells you nothing about whether the transfer happened.
 * A flow that stopped at "window closed" would report success for a transfer
 * the anchor later rejected.
 */

export type Sep24FlowKind = 'deposit' | 'withdraw'

export type Sep24TransactionStatus =
  | 'idle'
  | 'incomplete'
  | 'pending_anchor'
  | 'pending_user'
  | 'pending_external'
  | 'completed'
  | 'error'

export interface Sep24FlowProps {
  kind: Sep24FlowKind
  assetCode: string
  /**
   * The anchor's home domain (`TRANSFER_SERVER` is read from its stellar.toml),
   * or a TRANSFER_SERVER URL directly. A full URL is used as-is; anything else
   * is treated as a domain to discover.
   */
  anchorTransferServerUrl: string
  account: string
  /** SEP-10 JWT. The interactive endpoints require authentication. */
  authToken?: string
  amount?: string
  onStatusChange?: (status: Sep24TransactionStatus) => void
  /** Receives every poll, for callers that want the full transaction record. */
  onTransactionUpdate?: (tx: Sep24Transaction) => void
}

/**
 * Collapses the ~15 statuses SEP-24 defines onto the four this component
 * reports. Anything non-terminal is `pending_anchor` — the distinction between
 * `pending_external` and `pending_trust` matters to an anchor, not to someone
 * watching a spinner.
 */
function toComponentStatus(tx: Sep24Transaction): Sep24TransactionStatus {
  if (tx.status === 'incomplete') return 'incomplete'
  if (!isTerminalStatus(tx.status)) return 'pending_anchor'
  return isSuccessStatus(tx.status) ? 'completed' : 'error'
}

export function Sep24Flow({
  kind,
  assetCode,
  anchorTransferServerUrl,
  account,
  authToken,
  amount,
  onStatusChange,
  onTransactionUpdate,
}: Sep24FlowProps) {
  const [status, setStatus] = useState<Sep24TransactionStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null)

  // Aborts the poll if the component unmounts mid-flow, so a closed page does
  // not leave a request loop running against the anchor.
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const advance = useCallback(
    (next: Sep24TransactionStatus) => {
      setStatus(next)
      onStatusChange?.(next)
    },
    [onStatusChange],
  )

  const startFlow = useCallback(async () => {
    if (!authToken) {
      setMessage('Sign in with your wallet before starting a transfer.')
      advance('error')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setMessage(null)
    setInteractiveUrl(null)
    advance('incomplete')

    try {
      const transferServer = /^https?:\/\//.test(anchorTransferServerUrl)
        ? anchorTransferServerUrl.replace(/\/+$/, '')
        : await discoverTransferServer(anchorTransferServerUrl)

      const interactive = await startInteractiveFlow({
        transferServer,
        kind,
        assetCode,
        account,
        authToken,
        amount,
      })

      setInteractiveUrl(interactive.url)

      // A blocked popup is recoverable — the URL is rendered as a link below —
      // so it must not abort the flow, because the transaction already exists
      // at the anchor and still needs polling.
      try {
        openInteractiveWindow(interactive.url)
      } catch (err) {
        setMessage(
          err instanceof Sep24Error
            ? err.message
            : 'Could not open the anchor window. Use the link below.',
        )
      }

      advance('pending_anchor')

      const final = await pollUntilTerminal({
        transferServer,
        id: interactive.id,
        authToken,
        signal: controller.signal,
        onUpdate: (tx) => {
          onTransactionUpdate?.(tx)
          const mapped = toComponentStatus(tx)
          // Only push non-terminal updates here; the terminal one is set below
          // from the resolved value, so `onStatusChange` does not fire twice
          // for the same state.
          if (!isTerminalStatus(tx.status)) advance(mapped)
        },
      })

      onTransactionUpdate?.(final)
      advance(toComponentStatus(final))

      if (!isSuccessStatus(final.status)) {
        setMessage(final.message ?? `Anchor reported: ${final.status}`)
      }
    } catch (err) {
      setMessage(
        err instanceof Sep24Error ? err.message : 'The transfer could not be started.',
      )
      advance('error')
    }
  }, [
    advance,
    amount,
    anchorTransferServerUrl,
    assetCode,
    account,
    authToken,
    kind,
    onTransactionUpdate,
  ])

  const busy = status === 'incomplete' || status === 'pending_anchor'

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">
        {kind === 'deposit' ? 'Deposit' : 'Withdraw'} {assetCode} via anchor (SEP-24)
      </p>

      <Button onClick={startFlow} disabled={busy}>
        {busy ? 'Waiting for anchor…' : `Start ${kind}`}
      </Button>

      {status !== 'idle' && (
        <p className="text-xs text-muted-foreground" role="status">
          Status: {status}
        </p>
      )}

      {/* Shown when the popup was blocked, so the flow is still completable. */}
      {interactiveUrl && busy && (
        <a
          href={interactiveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline"
        >
          Open the anchor page
        </a>
      )}

      {message && (
        <p className="text-xs text-destructive" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}
