'use client';

import { ExternalLink, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import type { EscrowTransactionResponse, EscrowOperation } from '@/lib/api-models';

export interface TransactionLogEntry extends EscrowTransactionResponse {
  fee?: number;
  feeToken?: string;
}

const STATUS_ICON: Record<EscrowTransactionResponse['status'], React.ReactNode> = {
  confirmed: <CheckCircle size={14} className="text-green-500" aria-hidden="true" />,
  pending: <Clock size={14} className="text-yellow-500" aria-hidden="true" />,
  failed: <XCircle size={14} className="text-red-500" aria-hidden="true" />,
};

const OP_LABEL: Record<EscrowOperation, string> = {
  deposit: 'Deposit',
  release: 'Release',
  refund: 'Refund',
  dispute: 'Dispute',
};

const OP_COLOR: Record<EscrowOperation, string> = {
  deposit: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  release: 'bg-green-500/15 text-green-700 dark:text-green-400',
  refund: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  dispute: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

interface Props {
  transactions: TransactionLogEntry[];
  explorerBase?: string;
}

export function TransactionLogTable({
  transactions,
  explorerBase = 'https://stellar.expert/explorer/testnet/tx',
}: Props) {
  if (transactions.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2"
      >
        <AlertCircle size={32} className="opacity-40" aria-hidden="true" />
        <p className="text-sm">No transactions yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">Escrow transaction history</caption>
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <th scope="col" className="px-4 py-3">Operation</th>
            <th scope="col" className="px-4 py-3">Escrow ID</th>
            <th scope="col" className="px-4 py-3">Tx Hash</th>
            <th scope="col" className="px-4 py-3">Status</th>
            <th scope="col" className="px-4 py-3">Fee</th>
            <th scope="col" className="px-4 py-3">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr
              key={tx.txHash}
              className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
            >
              <td className="px-4 py-3">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${OP_COLOR[tx.operation]}`}>
                  {OP_LABEL[tx.operation]}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {tx.escrowId}
              </td>
              <td className="px-4 py-3 font-mono text-xs">
                <a
                  href={`${explorerBase}/${tx.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View transaction ${tx.txHash.slice(0, 8)} on Stellar explorer (opens in new tab)`}
                  className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {tx.txHash.slice(0, 8)}…{tx.txHash.slice(-6)}
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5 capitalize">
                  {STATUS_ICON[tx.status]}
                  {tx.status}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {tx.fee != null ? `${tx.fee} ${tx.feeToken ?? 'XLM'}` : '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                {new Date(tx.timestamp).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
