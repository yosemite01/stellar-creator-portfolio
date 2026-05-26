'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { releaseEscrow } from '@/lib/api-client';
import { ApiClientError } from '@/lib/api-client';
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
      <div className="flex flex-col gap-2" data-testid="release-success">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm font-medium">
          <CheckCircle size={16} />
          Funds released successfully
        </div>
        {txHash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View transaction <ExternalLink size={11} />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        onClick={handleRelease}
        disabled={disabled || state === 'submitting'}
        variant="default"
        data-testid="release-button"
      >
        {state === 'submitting' ? (
          <><Loader2 size={15} className="mr-2 animate-spin" />Releasing…</>
        ) : (
          'Release Funds'
        )}
      </Button>
      {state === 'error' && error && (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
