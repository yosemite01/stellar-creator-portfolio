'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LiveRegion } from '@/lib/accessibility';
import {
  discoverTransferServer,
  isSuccessStatus,
  isTerminalStatus,
  openInteractiveWindow,
  pollUntilTerminal,
  Sep24Error,
  startInteractiveFlow,
  type Sep24Transaction,
} from '@/lib/stellar/sep24';
import { Sep24Timeline, type Sep24TimelineTransaction } from './sep24-timeline';

/** Shape an anchor transaction for the timeline (history comes from the DB view). */
function toTimelineTransaction(tx: Sep24Transaction, assetCode: string): Sep24TimelineTransaction {
  return {
    id: tx.id,
    kind: tx.kind,
    assetCode,
    status: tx.status,
    amountIn: tx.amount_in,
    amountOut: tx.amount_out,
    amountFee: tx.amount_fee,
    message: tx.message,
    moreInfoUrl: tx.more_info_url,
    stellarTransactionId: tx.stellar_transaction_id,
    externalTransactionId: tx.external_transaction_id,
    startedAt: tx.started_at ?? new Date().toISOString(),
    completedAt: tx.completed_at,
    statusHistory: [],
  };
}

export type Sep24FlowKind = 'deposit' | 'withdraw';

export type Sep24TransactionStatus =
  | 'idle'
  | 'incomplete'
  | 'pending_anchor'
  | 'pending_user'
  | 'pending_external'
  | 'completed'
  | 'error';

export interface Sep24FlowProps {
  kind: Sep24FlowKind;
  assetCode: string;
  anchorTransferServerUrl: string;
  account: string;
  authToken?: string;
  amount?: string;
  onStatusChange?: (status: Sep24TransactionStatus) => void;
  onTransactionUpdate?: (tx: Sep24Transaction) => void;
}

function toComponentStatus(tx: Sep24Transaction): Sep24TransactionStatus {
  if (tx.status === 'incomplete') return 'incomplete';
  if (!isTerminalStatus(tx.status)) return 'pending_anchor';
  return isSuccessStatus(tx.status) ? 'completed' : 'error';
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
  const [status, setStatus] = useState<Sep24TransactionStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<Sep24Transaction | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const advance = useCallback(
    (next: Sep24TransactionStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  const startFlow = useCallback(async () => {
    if (!authToken) {
      setMessage('Sign in with your wallet before starting a transfer.');
      advance('error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setMessage(null);
    setInteractiveUrl(null);
    setTransaction(null);
    advance('incomplete');

    try {
      const transferServer = /^https?:\/\//.test(anchorTransferServerUrl)
        ? anchorTransferServerUrl.replace(/\/+$/, '')
        : await discoverTransferServer(anchorTransferServerUrl);

      const interactive = await startInteractiveFlow({
        transferServer,
        kind,
        assetCode,
        account,
        authToken,
        amount,
      });

      setInteractiveUrl(interactive.url);

      try {
        openInteractiveWindow(interactive.url);
      } catch (err) {
        setMessage(
          err instanceof Sep24Error
            ? err.message
            : 'Could not open the anchor window. Use the link below.',
        );
      }

      advance('pending_anchor');

      const final = await pollUntilTerminal({
        transferServer,
        id: interactive.id,
        authToken,
        signal: controller.signal,
        onUpdate: (tx: Sep24Transaction) => {
          onTransactionUpdate?.(tx);
          setTransaction(tx);
          const mapped = toComponentStatus(tx);
          if (!isTerminalStatus(tx.status)) advance(mapped);
        },
      });

      onTransactionUpdate?.(final);
      setTransaction(final);
      advance(toComponentStatus(final));

      if (!isSuccessStatus(final.status)) {
        setMessage(final.message ?? `Anchor reported: ${final.status}`);
      }
    } catch (err) {
      setMessage(
        err instanceof Sep24Error ? err.message : 'The transfer could not be started.',
      );
      advance('error');
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
  ]);

  const busy = status === 'incomplete' || status === 'pending_anchor';
  const showTimeline = Boolean(transaction);

  const statusAnnouncement =
    status === 'idle'
      ? ''
      : status === 'incomplete'
        ? `Starting ${kind} for ${assetCode} with anchor.`
        : status === 'pending_anchor'
          ? `Waiting for anchor to process ${kind} of ${assetCode}.`
          : status === 'completed'
            ? `${kind === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${assetCode} completed.`
            : status === 'error'
              ? `Transfer error: ${message ?? 'Please try again.'}`
              : `Transfer status: ${status}`;

  return (
    <div className="flex flex-col gap-4">
      {!showTimeline && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {kind === 'deposit' ? 'Deposit' : 'Withdraw'} {assetCode} via anchor (SEP-24)
          </p>

          <Button type="button" onClick={startFlow} disabled={busy} aria-busy={busy}>
            {busy ? 'Waiting for anchor…' : `Start ${kind}`}
          </Button>

          {message && (
            <p className="text-xs text-destructive" role="alert" aria-live="assertive">
              {message}
            </p>
          )}
        </div>
      )}

      {showTimeline && transaction && (
        <Sep24Timeline
          transaction={toTimelineTransaction(transaction, assetCode)}
          onRetry={startFlow}
        />
      )}

      {interactiveUrl && busy && !showTimeline && (
        <a
          href={interactiveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Open the anchor page (opens in new tab)
        </a>
      )}

      <LiveRegion
        message={statusAnnouncement}
        role={status === 'error' ? 'alert' : 'status'}
      />
    </div>
  );
}
