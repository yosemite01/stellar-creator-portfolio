'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LiveRegion } from '@/lib/accessibility';
import { releaseEscrow, ApiClientError } from '@/lib/api-client';
import { CheckCircle, Loader2, ExternalLink } from 'lucide-react';

interface Props {
  escrowId: string;
  authorizerAddress: string;
  disabled?: boolean;
  onReleased?: (txHash: string) => void;
}

type State = 'idle' | 'submitting' | 'success' | 'error';

export function EscrowReleaseButton({ escrowId, authorizerAddress, disabled, onReleased }: Props) {
  const [state, setState] = useState<State>('idle');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');

  async function handleRelease() {
    if (!authorizerAddress.trim()) {
      setError('Wallet address required to release escrow.');
      setState('error');
      return;
    }

    setState('submitting');
    setError('');

    try {
      const result = await releaseEscrow(escrowId, authorizerAddress);
      setTxHash(result.txHash);
      setState('success');
      onReleased?.(result.txHash);
    } catch (err) {
      setState('error');
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to release escrow. Please try again.');
      }
    }
  }

  if (state === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col gap-2"
        data-testid="release-success"
      >
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-medium">
          <CheckCircle size={16} aria-hidden="true" />
          Funds released successfully
        </div>
        {txHash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            View transaction <ExternalLink size={11} aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        onClick={handleRelease}
        disabled={disabled || state === 'submitting'}
        aria-busy={state === 'submitting'}
        variant="default"
        data-testid="release-button"
      >
        {state === 'submitting' ? (
          <>
            <Loader2 size={15} className="mr-2 animate-spin" aria-hidden="true" />
            Releasing…
          </>
        ) : (
          'Release Funds'
        )}
      </Button>
      {state === 'submitting' && (
        <LiveRegion message="Submitting escrow payout transaction on Stellar…" role="status" />
      )}
      {state === 'error' && error && (
        <p role="alert" aria-live="assertive" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
