'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AccessibleErrorMessage, LiveRegion, useFocusTrap } from '@/lib/accessibility';
import {
  SUPPORTED_CHAINS,
  getSwapQuote,
  formatRoutePath,
  getChainInfo,
  type ChainId,
  type SwapQuote,
} from '@/lib/swap/cross-chain-sdk';
import {
  ArrowRight,
  CheckCircle,
  ChevronRight,
  Loader2,
  Route,
  X,
  Zap,
} from 'lucide-react';

interface CrossChainSwapModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'select' | 'review' | 'confirm' | 'success';

const STEP_DESCRIPTIONS: Record<Step, string> = {
  select: 'Step 1 of 4: Select source chain, destination chain, and swap amount.',
  review: 'Step 2 of 4: Review swap quote, routing path, and live gas estimates.',
  confirm: 'Step 3 of 4: Confirm atomic swap details before execution.',
  success: 'Step 4 of 4: Cross-chain atomic swap initiated successfully.',
};

export function CrossChainSwapModal({ open, onClose }: CrossChainSwapModalProps) {
  const titleId = useId();
  const stepDescId = useId();
  const amountErrorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const stepRegionRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [fromChain, setFromChain] = useState<ChainId>('stellar');
  const [toChain, setToChain] = useState<ChainId>('polygon');
  const [amount, setAmount] = useState('100');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [gasRefreshing, setGasRefreshing] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');

  useFocusTrap(dialogRef, {
    enabled: open,
    onEscape: onClose,
    restoreFocus: true,
  });

  useEffect(() => {
    if (!open) {
      setStep('select');
      setQuote(null);
      setAmountError(null);
      setSubmitError(null);
      setLiveStatus('');
    } else {
      setLiveStatus(STEP_DESCRIPTIONS.select);
    }
  }, [open]);

  // Announce step transitions and keep destination chain distinct from source chain
  useEffect(() => {
    if (!open) return;
    setLiveStatus(STEP_DESCRIPTIONS[step]);
    if (step !== 'select') {
      stepRegionRef.current?.focus();
    }
  }, [open, step]);

  const handleSelectFromChain = useCallback(
    (chainId: ChainId) => {
      setFromChain(chainId);
      if (toChain === chainId) {
        const fallback = SUPPORTED_CHAINS.find((c) => c.id !== chainId);
        if (fallback) setToChain(fallback.id);
      }
    },
    [toChain],
  );

  useEffect(() => {
    if (step !== 'review' && step !== 'confirm') return;
    let cancelled = false;

    const refresh = async () => {
      setGasRefreshing(true);
      try {
        const q = await getSwapQuote(fromChain, toChain, amount);
        if (!cancelled) {
          setQuote(q);
          setGasRefreshing(false);
        }
      } catch {
        if (!cancelled) {
          setGasRefreshing(false);
          setSubmitError('Unable to refresh gas estimates. Please check your connection.');
        }
      }
    };

    void refresh();
    const interval = setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, fromChain, toChain, amount]);

  const handleContinue = useCallback(async () => {
    setSubmitError(null);

    if (step === 'select') {
      const parsedAmount = Number(amount);
      if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setAmountError('Enter a valid swap amount greater than 0.');
        return;
      }
      setAmountError(null);
      setLoading(true);
      setLiveStatus('Fetching cross-chain swap quote…');
      try {
        const q = await getSwapQuote(fromChain, toChain, amount);
        setQuote(q);
        setStep('review');
        setLiveStatus(STEP_DESCRIPTIONS.review);
      } catch {
        setSubmitError('Failed to fetch swap quote. Please try again.');
      } finally {
        setLoading(false);
      }
    } else if (step === 'review') {
      setStep('confirm');
      setLiveStatus(STEP_DESCRIPTIONS.confirm);
    } else if (step === 'confirm') {
      setLoading(true);
      setLiveStatus('Executing cross-chain atomic swap…');
      try {
        await new Promise((r) => setTimeout(r, 1500));
        setStep('success');
        setLiveStatus(STEP_DESCRIPTIONS.success);
      } catch {
        setSubmitError('Swap execution failed. No funds were moved.');
      } finally {
        setLoading(false);
      }
    }
  }, [step, fromChain, toChain, amount]);

  if (!open) return null;

  const fromInfo = getChainInfo(fromChain);
  const toInfo = getChainInfo(toChain);
  const destinationChains = SUPPORTED_CHAINS.filter((c) => c.id !== fromChain);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={stepDescId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl overflow-hidden focus:outline-none"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 id={titleId} className="text-lg font-semibold">
              Cross-Chain Swap
            </h2>
            <p id={stepDescId} className="text-xs text-muted-foreground">
              Step {step === 'select' ? 1 : step === 'review' ? 2 : step === 'confirm' ? 3 : 4} of 4
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close swap modal"
            className="p-2 rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div
          ref={stepRegionRef}
          tabIndex={-1}
          className="px-6 py-5 space-y-5 min-h-[320px] focus:outline-none"
        >
          {submitError && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              {submitError}
            </div>
          )}

          {step === 'select' && (
            <>
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">From</legend>
                <div
                  role="radiogroup"
                  aria-label="Source blockchain network"
                  className="grid grid-cols-2 gap-2"
                >
                  {SUPPORTED_CHAINS.map((chain) => {
                    const selected = fromChain === chain.id;
                    return (
                      <button
                        key={chain.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => handleSelectFromChain(chain.id)}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <span className="text-lg" aria-hidden="true">
                          {chain.icon}
                        </span>
                        <span className="text-sm font-medium">{chain.name}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex justify-center" aria-hidden="true">
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">To</legend>
                <div
                  role="radiogroup"
                  aria-label="Destination blockchain network"
                  className="grid grid-cols-2 gap-2"
                >
                  {destinationChains.map((chain) => {
                    const selected = toChain === chain.id;
                    return (
                      <button
                        key={chain.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setToChain(chain.id)}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <span className="text-lg" aria-hidden="true">
                          {chain.icon}
                        </span>
                        <span className="text-sm font-medium">{chain.name}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="space-y-2">
                <label htmlFor="swap-amount" className="text-sm font-medium">
                  Amount ({fromInfo.nativeSymbol})
                </label>
                <input
                  id="swap-amount"
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  aria-required="true"
                  aria-invalid={Boolean(amountError)}
                  aria-describedby={amountError ? amountErrorId : undefined}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (amountError) setAmountError(null);
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <AccessibleErrorMessage id={amountErrorId} message={amountError} />
              </div>
            </>
          )}

          {step === 'review' && quote && (
            <>
              <div className="rounded-xl bg-muted/40 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">You send</span>
                  <span className="font-semibold">
                    {quote.fromAmount} {fromInfo.nativeSymbol}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">You receive</span>
                  <span className="font-semibold text-primary">
                    ≈ {quote.toAmount} {toInfo.nativeSymbol}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Route className="h-4 w-4 text-primary" aria-hidden="true" />
                  Routing Path
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {formatRoutePath(quote.route)}
                </p>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>~{quote.route.estimatedMinutes} min</span>
                  <span>{Math.round(quote.route.reliability * 100)}% reliability</span>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Zap className="h-4 w-4 text-amber-500" aria-hidden="true" />
                    Gas Estimates
                    {gasRefreshing && (
                      <Loader2
                        className="h-3 w-3 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground" aria-live="polite">
                    {gasRefreshing ? 'Updating…' : 'Live'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-muted/50">
                    <p className="text-muted-foreground">Source</p>
                    <p className="font-mono font-medium">{quote.gas.sourceGas}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-muted/50">
                    <p className="text-muted-foreground">Destination</p>
                    <p className="font-mono font-medium">{quote.gas.destGas}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Bridge fee: {quote.gas.bridgeFee} · Total ≈ ${quote.gas.totalUsd.toFixed(2)}
                </p>
              </div>
            </>
          )}

          {step === 'confirm' && quote && (
            <div className="space-y-4 text-center py-4">
              <p className="text-sm text-muted-foreground">Confirm atomic swap</p>
              <p className="text-2xl font-bold">
                {quote.fromAmount} {fromInfo.nativeSymbol}
                <ChevronRight
                  className="inline h-5 w-5 mx-2 text-muted-foreground"
                  aria-hidden="true"
                />
                {quote.toAmount} {toInfo.nativeSymbol}
              </p>
              <p className="text-xs text-muted-foreground">
                Slippage tolerance: {quote.slippageBps / 100}% · HTLC lock initiated on {fromInfo.name}
              </p>
            </div>
          )}

          {step === 'success' && (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center justify-center py-8 gap-3"
            >
              <CheckCircle className="h-12 w-12 text-green-500" aria-hidden="true" />
              <p className="text-lg font-semibold">Swap Initiated</p>
              <p className="text-sm text-muted-foreground text-center">
                Your cross-chain atomic swap is processing. Funds will arrive in ~
                {quote?.route.estimatedMinutes ?? 5} minutes.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          {step !== 'success' && step !== 'select' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(step === 'confirm' ? 'review' : 'select')}
              className="flex-1"
            >
              Back
            </Button>
          )}
          {step === 'success' ? (
            <Button type="button" onClick={onClose} className="flex-1">
              Done
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void handleContinue()}
              disabled={loading}
              aria-busy={loading}
              className="flex-1 gap-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {step === 'select'
                ? 'Continue'
                : step === 'review'
                  ? 'Review & Confirm'
                  : 'Execute Swap'}
            </Button>
          )}
        </div>

        <LiveRegion message={liveStatus} role="status" />
      </div>
    </div>
  );
}
