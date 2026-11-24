'use client';

import React, { useCallback, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  LogOut,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LiveRegion, useFocusTrap } from '@/lib/accessibility';
import { formatAccount } from '@/components/wallet/connect-wallet-button';
import type { NetworkType, WalletType } from '@/components/wallet/wallet-context';

export interface WalletOption {
  id: WalletType;
  name: string;
  description: string;
  available?: boolean;
}

export const WALLET_OPTIONS: readonly WalletOption[] = [
  {
    id: 'freighter',
    name: 'Freighter',
    description: 'Official Stellar browser extension wallet',
    available: true,
  },
  {
    id: 'albedo',
    name: 'Albedo',
    description: 'Web-based Stellar signer with no extension required',
    available: true,
  },
  {
    id: 'xbull',
    name: 'xBull',
    description: 'Multi-platform Stellar & Soroban wallet',
    available: true,
  },
  {
    id: 'passkey',
    name: 'Passkey Smart Wallet',
    description: 'Biometric WebAuthn smart contract wallet',
    available: true,
  },
] as const;

export interface WalletConnectModalProps {
  open: boolean;
  onClose: () => void;
  address?: string | null;
  network?: NetworkType;
  expectedNetwork?: string;
  walletType?: WalletType | null;
  isConnected?: boolean;
  isLoading?: boolean;
  error?: string | null;
  onConnect: (wallet: WalletType) => Promise<void> | void;
  onDisconnect?: () => void;
}

/**
 * Keyboard- and screen-reader-accessible Stellar wallet connect dialog (#1773).
 *
 * Features:
 * - Focus trap (`Tab`/`Shift+Tab` wrap, `Escape` dismissal, focus restoration)
 * - Arrow-key navigation across wallet provider options
 * - Polite ARIA live region for connection state transitions and clipboard feedback
 * - Assertive `role="alert"` error container with actionable retry control
 */
export function WalletConnectModal({
  open,
  onClose,
  address = null,
  network = 'unknown',
  expectedNetwork = 'testnet',
  walletType = null,
  isConnected = false,
  isLoading = false,
  error = null,
  onConnect,
  onDisconnect,
}: WalletConnectModalProps) {
  const titleId = useId();
  const descId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<WalletType | null>(null);
  const [actionMessage, setActionMessage] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useFocusTrap(dialogRef, {
    enabled: open,
    onEscape: onClose,
    restoreFocus: true,
  });

  const statusMessage =
    actionMessage ||
    (isLoading && selectedAttempt
      ? `Connecting to ${selectedAttempt} wallet. Follow the prompt in your wallet.`
      : isConnected && address
        ? `Wallet connected: ${formatAccount(address)}${network !== 'unknown' ? ` on ${network}` : ''}.`
        : '');

  const handleSelectWallet = useCallback(
    async (wallet: WalletType) => {
      setSelectedAttempt(wallet);
      setActionMessage(`Connecting to ${wallet} wallet…`);
      await onConnect(wallet);
    },
    [onConnect],
  );

  const handleListKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    const count = WALLET_OPTIONS.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      optionRefs.current[(index + 1) % count]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      optionRefs.current[(index - 1 + count) % count]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      optionRefs.current[count - 1]?.focus();
    }
  }, []);

  const handleCopyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard?.writeText(address);
      setCopied(true);
      setActionMessage('Wallet address copied to clipboard.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setActionMessage('Could not copy wallet address to clipboard.');
    }
  }, [address]);

  const handleDisconnect = useCallback(() => {
    onDisconnect?.();
    setActionMessage('Wallet disconnected.');
  }, [onDisconnect]);

  if (!open) return null;

  const networkMismatch = isConnected && network !== 'unknown' && network !== expectedNetwork;

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
        aria-describedby={error ? `${descId} ${errorId}` : descId}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl overflow-hidden focus:outline-none"
      >
        {/* Dialog Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <h2 id={titleId} className="text-lg font-semibold text-foreground">
                {isConnected ? 'Wallet Account' : 'Connect a Stellar Wallet'}
              </h2>
              <p id={descId} className="text-xs text-muted-foreground">
                {isConnected
                  ? 'Manage your connected Stellar wallet session.'
                  : 'Choose a wallet provider to sign transactions and manage payments.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallet dialog"
            className="p-2 rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {networkMismatch && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-800 dark:text-yellow-300"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Network mismatch: connected to <strong>{network}</strong>, but this app expects{' '}
                <strong>{expectedNetwork}</strong>. Switch networks in your wallet before sending payments.
              </span>
            </div>
          )}

          {error && (
            <div
              id={errorId}
              role="alert"
              aria-live="assertive"
              className="flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
              {selectedAttempt && !isLoading && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSelectWallet(selectedAttempt)}
                  className="self-start gap-1.5 text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry {selectedAttempt}
                </Button>
              )}
            </div>
          )}

          {isConnected && address ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Connected via {walletType ?? 'Stellar wallet'}</span>
                  {network !== 'unknown' && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                      {network}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm text-foreground break-all">{address}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleCopyAddress()}
                    aria-label={copied ? 'Address copied' : 'Copy wallet address'}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDisconnect}
                  className="flex-1 gap-2"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Disconnect
                </Button>
                <Button type="button" onClick={onClose} className="flex-1">
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <div
              role="group"
              aria-label="Available Stellar wallets"
              className="space-y-2"
            >
              {WALLET_OPTIONS.map((option, idx) => {
                const isOptionLoading = isLoading && selectedAttempt === option.id;
                return (
                  <button
                    key={option.id}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    type="button"
                    disabled={isLoading}
                    aria-busy={isOptionLoading}
                    aria-describedby={`wallet-option-desc-${option.id}`}
                    onKeyDown={(e) => handleListKeyDown(e, idx)}
                    onClick={() => void handleSelectWallet(option.id)}
                    className="w-full flex items-center justify-between gap-3 rounded-xl border border-border p-3.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    <div>
                      <span className="block text-sm font-medium text-foreground">
                        {option.name}
                      </span>
                      <span
                        id={`wallet-option-desc-${option.id}`}
                        className="block text-xs text-muted-foreground"
                      >
                        {option.description}
                      </span>
                    </div>
                    {isOptionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" aria-hidden="true" />
                    ) : (
                      <Wallet className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <LiveRegion message={statusMessage} role="status" />
      </div>
    </div>
  );
}
