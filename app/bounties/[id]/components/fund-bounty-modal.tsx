'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { submitEscrowTransaction } from '@/lib/api-client';
import { validateEscrowTransaction } from '@/lib/api-models';
import { ApiClientError } from '@/lib/api-client';
import { getAllowedEscrowTokens, isAllowedEscrowToken } from '@/lib/escrow/allowed-tokens';
import { simulateForFeeEstimate, type FeeEstimate } from '@/lib/soroban/simulate-before-sign';
import { CheckCircle, Loader2, X, ExternalLink, AlertTriangle, Info } from 'lucide-react';

interface FundBountyModalProps {
  bountyId: string;
  bountyTitle: string;
  /** Contract ID of the escrow Soroban contract — used for pre-flight simulation. */
  escrowContractId?: string;
  budget: number;
  currency: string;
  onClose: () => void;
}

type FundState = 'idle' | 'simulating' | 'simulated' | 'submitting' | 'success' | 'error';

export function FundBountyModal({
  bountyId,
  bountyTitle,
  escrowContractId,
  budget,
  currency,
  onClose,
}: FundBountyModalProps) {
  const [amount, setAmount] = useState(String(budget));
  const [walletAddress, setWalletAddress] = useState('');
  const [payeeAddress, setPayeeAddress] = useState('');
  // #1715: only offer tokens the escrow contract has allowlisted.
  const allowedTokens = getAllowedEscrowTokens();
  const [tokenAddress, setTokenAddress] = useState(allowedTokens[0]?.contractId ?? '');
  const [state, setState] = useState<FundState>('idle');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [simWarning, setSimWarning] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setError('Amount must be a positive number');
      return;
    }
    if (!walletAddress.trim()) {
      setError('Your Stellar wallet address is required');
      return;
    }
    if (!payeeAddress.trim()) {
      setError('Payee (freelancer) address is required');
      return;
    }
    if (!isAllowedEscrowToken(tokenAddress, allowedTokens)) {
      setError('Select a supported token');
      return;
    }

    const txRequest = {
      bountyId,
      operation: 'deposit' as const,
      amount: parsedAmount,
      payerAddress: walletAddress.trim(),
      payeeAddress: payeeAddress.trim(),
      tokenAddress: tokenAddress.trim(),
    };

    const validationErrors = validateEscrowTransaction(txRequest);
    if (validationErrors) {
      setError(validationErrors[0].message);
      return;
    }

    setError('');
    setSimWarning('');

    // ── #1732: Pre-flight simulation ───────────────────────────────────────
    // Run simulateTransaction before prompting the wallet so the user sees
    // the resource fee and any contract errors before signing.
    if (escrowContractId && state !== 'simulated') {
      setState('simulating');
      setFeeEstimate(null);

      const sim = await simulateForFeeEstimate({
        contractId: escrowContractId,
        method: 'deposit',
        args: [walletAddress.trim(), payeeAddress.trim(), parsedAmount, tokenAddress.trim()],
        sourceAccount: walletAddress.trim(),
      });

      if (!sim.success) {
        setState('error');
        setError(`Pre-flight check failed: ${sim.error}`);
        return;
      }

      setFeeEstimate(sim);
      setState('simulated');
      // Show the fee breakdown — user must click "Confirm & Sign" to proceed.
      return;
    }

    // ── Actual submission (after user confirms the fee) ────────────────────
    setState('submitting');

    try {
      const result = await submitEscrowTransaction(txRequest);
      setTxHash(result.txHash);
      setState('success');
    } catch (err) {
      setState('error');
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    }
  }

  /** Reset fee review state so the user can edit fields and re-simulate. */
  function handleEditFields() {
    setState('idle');
    setFeeEstimate(null);
    setSimWarning('');
    setError('');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fund-modal-title"
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 id="fund-modal-title" className="text-lg font-semibold">
            Fund Bounty
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {state === 'success' ? (
            <div className="text-center space-y-4">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
              <p className="font-semibold text-lg text-foreground">Funds Locked in Escrow</p>
              <p className="text-sm text-muted-foreground">
                Your deposit for <span className="font-medium text-foreground">{bountyTitle}</span> has been
                confirmed. Funds are now securely held in the Soroban escrow contract.
              </p>
              {txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View transaction <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <Button onClick={onClose} className="w-full mt-2">
                Done
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <p className="text-sm text-muted-foreground">
                Deposit funds into escrow for{' '}
                <span className="font-medium text-foreground">{bountyTitle}</span>.
                Funds are held securely until the bounty is completed.
              </p>

              {/* Amount */}
              <div className="space-y-1">
                <label htmlFor="fund-amount" className="text-sm font-medium">
                  Amount ({currency})
                </label>
                <input
                  id="fund-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={state === 'simulated'}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  required
                />
              </div>

              {/* Payer wallet */}
              <div className="space-y-1">
                <label htmlFor="fund-payer" className="text-sm font-medium">
                  Your Stellar Wallet Address
                </label>
                <input
                  id="fund-payer"
                  type="text"
                  placeholder="G..."
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  disabled={state === 'simulated'}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  required
                />
              </div>

              {/* Payee address */}
              <div className="space-y-1">
                <label htmlFor="fund-payee" className="text-sm font-medium">
                  Freelancer Wallet Address
                </label>
                <input
                  id="fund-payee"
                  type="text"
                  placeholder="G..."
                  value={payeeAddress}
                  onChange={(e) => setPayeeAddress(e.target.value)}
                  disabled={state === 'simulated'}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  required
                />
              </div>

              {/* Token address */}
              <div className="space-y-1">
                <label htmlFor="fund-token" className="text-sm font-medium">
                  Token
                </label>
                <select
                  id="fund-token"
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={allowedTokens.length === 0 || state === 'simulated'}
                  required
                >
                  {allowedTokens.length === 0 && <option value="">No supported tokens configured</option>}
                  {allowedTokens.map((t) => (
                    <option key={t.contractId} value={t.contractId}>
                      {t.code}
                    </option>
                  ))}
                </select>
              </div>

              {/* #1732: Fee breakdown shown after simulation */}
              {state === 'simulated' && feeEstimate && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-blue-700 dark:text-blue-300">
                    <Info className="w-4 h-4 shrink-0" />
                    Transaction Fee Estimate
                  </div>
                  <div className="text-xs text-blue-600 dark:text-blue-400 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Inclusion fee</span>
                      <span>{feeEstimate.inclusionFeeLumens} stroops</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Resource fee (CPU / memory / IO)</span>
                      <span>{feeEstimate.resourceFeeLumens} stroops</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t border-blue-200 dark:border-blue-700 pt-1 mt-1">
                      <span>Total</span>
                      <span>{feeEstimate.totalFeeXlm}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Simulation warning */}
              {simWarning && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 p-3 text-sm text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {simWarning}
                </div>
              )}

              {/* Error */}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              {/* Actions */}
              {state === 'simulated' ? (
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleEditFields}
                    className="flex-1"
                  >
                    Edit
                  </Button>
                  <Button type="submit" className="flex-1">
                    {state === 'simulated' ? 'Confirm & Sign' : 'Deposit Funds'}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onClose}
                    className="flex-1"
                    disabled={state === 'simulating' || state === 'submitting'}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={state === 'simulating' || state === 'submitting'}
                  >
                    {state === 'simulating' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Estimating fee…
                      </>
                    ) : state === 'submitting' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Depositing…
                      </>
                    ) : (
                      escrowContractId ? 'Review Fee & Deposit' : 'Deposit Funds'
                    )}
                  </Button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
