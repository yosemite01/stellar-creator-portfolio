'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LiveRegion } from '@/lib/accessibility';
import { useStellarWallet } from '@/hooks/useStellarWallet';
import { hasTokenBalance } from '@/lib/stellar/token-gate';

type GateState = 'idle' | 'checking' | 'locked' | 'unlocked';

interface TokenGateProps {
  /** Soroban token contract address (the Stellar asset) required to view. */
  tokenContractId: string;
  /** Unlock price the creator set. */
  price: number;
  /** Currency the price is denominated in. */
  priceAsset?: 'XLM' | 'USDC';
  /**
   * Mints/purchases the gating token via the escrow contract. Resolves once the
   * holder owns the token; the gate then re-checks and reveals the content.
   */
  onUnlock?: () => Promise<void>;
  /** Premium content shown only to token holders. */
  children: ReactNode;
}

/**
 * Gates premium portfolio content behind on-chain token ownership.
 *
 * Holders see the content; non-holders see a blurred preview with an accessible
 * lock overlay, status announcements, and error recovery.
 */
export function TokenGate({
  tokenContractId,
  price,
  priceAsset = 'XLM',
  onUnlock,
  children,
}: TokenGateProps) {
  const { publicKey, isConnected, connect } = useStellarWallet();
  const [gateState, setGateState] = useState<GateState>('idle');
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const checkAccess = useCallback(async () => {
    if (!publicKey) {
      setGateState('idle');
      return;
    }
    setGateState('checking');
    setAnnouncement('Checking token ownership for premium content.');
    try {
      const owns = await hasTokenBalance(tokenContractId, publicKey);
      setGateState(owns ? 'unlocked' : 'locked');
      setAnnouncement(owns ? 'Premium content unlocked.' : 'Token required to unlock premium content.');
    } catch {
      setGateState('locked');
      setError('Unable to verify token ownership. Please try again.');
    }
  }, [publicKey, tokenContractId]);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  const handleUnlock = useCallback(async () => {
    setError(null);
    if (!isConnected) {
      setAnnouncement('Connecting wallet to unlock content.');
      await connect();
      return;
    }
    setUnlocking(true);
    setAnnouncement(`Unlocking premium content for ${price} ${priceAsset}.`);
    try {
      await onUnlock?.();
      await checkAccess();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to unlock content. Check your wallet balance and try again.',
      );
    } finally {
      setUnlocking(false);
    }
  }, [isConnected, connect, onUnlock, checkAccess, price, priceAsset]);

  if (gateState === 'unlocked') {
    return (
      <>
        <LiveRegion message="Premium content unlocked." role="status" />
        {children}
      </>
    );
  }

  const busy = gateState === 'checking' || unlocking;

  return (
    <div
      role="region"
      aria-label="Locked premium content"
      className="relative overflow-hidden rounded-lg"
    >
      <div className="pointer-events-none select-none blur-md" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 p-6 text-center backdrop-blur-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock size={22} aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-foreground">Premium content</p>
        <Button
          type="button"
          onClick={() => void handleUnlock()}
          disabled={busy}
          aria-busy={busy}
        >
          {gateState === 'checking'
            ? 'Checking access…'
            : unlocking
              ? 'Unlocking…'
              : isConnected
                ? `Unlock for ${price} ${priceAsset}`
                : 'Connect wallet to unlock'}
        </Button>
        {error && (
          <p role="alert" aria-live="assertive" className="text-xs text-destructive max-w-xs">
            {error}
          </p>
        )}
      </div>
      <LiveRegion message={announcement} role="status" />
    </div>
  );
}
