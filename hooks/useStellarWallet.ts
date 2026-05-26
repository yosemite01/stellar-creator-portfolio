'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * Wallet connection state and utilities for Stellar accounts.
 */

export interface StellarWallet {
  publicKey: string;
  isConnected: boolean;
}

interface UseStellarWalletReturn {
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const STORAGE_KEY = 'stellar_wallet_key';

/**
 * Hook for managing Stellar wallet connections.
 * 
 * Tracks wallet connection state, persists public key to localStorage,
 * and provides methods to connect/disconnect.
 * 
 * @example
 * ```tsx
 * const { publicKey, isConnected, connect, disconnect } = useStellarWallet();
 * 
 * return (
 *   <>
 *     {isConnected ? (
 *       <>
 *         <p>Connected: {publicKey}</p>
 *         <button onClick={disconnect}>Disconnect</button>
 *       </>
 *     ) : (
 *       <button onClick={connect}>Connect Wallet</button>
 *     )}
 *   </>
 * );
 * ```
 */
export function useStellarWallet(): UseStellarWalletReturn {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore wallet from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const { publicKey: key } = JSON.parse(stored);
        if (key && typeof key === 'string') {
          setPublicKey(key);
        }
      } catch (err) {
        // Clear invalid stored data
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Check if Stellar wallet extension is available (e.g., Freighter)
      if (typeof window === 'undefined' || !window.stellar) {
        throw new Error(
          'Stellar wallet extension not found. Please install Freighter or another Stellar wallet.',
        );
      }

      // Request public key from wallet
      const { publicKey: key } = await window.stellar.requestPublicKey();

      if (!key || typeof key !== 'string') {
        throw new Error('Failed to get public key from wallet');
      }

      // Validate that it looks like a Stellar address
      if (!key.startsWith('G') || key.length !== 56) {
        throw new Error('Invalid Stellar public key format');
      }

      setPublicKey(key);

      // Persist to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ publicKey: key }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
      setPublicKey(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    publicKey,
    isConnected: publicKey !== null,
    isLoading,
    error,
    connect,
    disconnect,
  };
}

/**
 * Augment the Window interface with Stellar wallet API.
 */
declare global {
  interface Window {
    stellar?: {
      requestPublicKey(): Promise<{ publicKey: string }>;
      signTransaction(tx: string): Promise<{ signedTransaction: string }>;
      signMessage(message: string): Promise<{ signedMessage: string }>;
    };
  }
}
