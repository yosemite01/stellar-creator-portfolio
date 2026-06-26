'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
 * Holders see the content; non-holders see a blurred preview with a lock
 * overlay and an "Unlock" button. The ownership check runs entirely
 * client-side against the public Soroban RPC — no server secret required.
 */
export function TokenGate({
  tokenContractId,
  price,
  priceAsset = 'XLM',
  onUnlock,
  children,
}: TokenGateProps) {
  const { publicKey, isConnected, connect } = useStellarWallet();
  const [state, setState] = useState<GateState>('idle');
  const [unlocking, setUnlocking] = useState(false);

  const check = useCallback(async () => {
    if (!publicKey) {
      setState('idle');
      return;
    }
    setState('checking');
    try {
      const owns = await hasTokenBalance(tokenContractId, publicKey);
      setState(owns ? 'unlocked' : 'locked');
    } catch {
      setState('locked');
    }
  }, [publicKey, tokenContractId]);

  useEffect(() => {
    void check();
  }, [check]);

  const handleUnlock = useCallback(async () => {
    if (!isConnected) {
      await connect();
      return;
    }
    setUnlocking(true);
    try {
      await onUnlock?.();
      await check();
    } finally {
      setUnlocking(false);
    }
  }, [isConnected, connect, onUnlock, check]);

  if (state === 'unlocked') {
    return <>{children}</>;
  }

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="pointer-events-none select-none blur-md" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 p-6 text-center backdrop-blur-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock size={22} />
        </div>
        <p className="text-sm font-medium text-foreground">Premium content</p>
        <Button onClick={handleUnlock} disabled={state === 'checking' || unlocking}>
          {state === 'checking'
            ? 'Checking access…'
            : unlocking
              ? 'Unlocking…'
              : isConnected
                ? `Unlock for ${price} ${priceAsset}`
                : 'Connect wallet to unlock'}
        </Button>
      </div>
    </div>
  );
}
