'use client';

/**
 * usePaymaster
 *
 * React hook that wraps the paymaster client.  Components use this to submit
 * transactions without any fee/gas language surfacing in the UI.
 */

import { useState, useCallback } from 'react';
import { sponsorTransaction, friendlyTxStatus, SmartWalletInterface } from '@/lib/payments/paymasterClient';

interface UsePaymasterResult {
  submit: (signedXdr: string, wallet?: SmartWalletInterface) => Promise<void>;
  status: string;
  txHash: string | null;
  isSubmitting: boolean;
  error: string | null;
  reset: () => void;
}

export function usePaymaster(): UsePaymasterResult {
  const [status, setStatus] = useState('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (signedXdr: string, wallet?: SmartWalletInterface) => {
    setIsSubmitting(true);
    setError(null);
    setStatus('pending');
    try {
      const result = await sponsorTransaction(signedXdr, wallet);
      setTxHash(result.txHash);
      setStatus('success');
    } catch (err) {
      setStatus('failed');
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setTxHash(null);
    setError(null);
    setIsSubmitting(false);
  }, []);

  return {
    submit,
    status,
    txHash,
    isSubmitting,
    error,
    reset,
  };
}
