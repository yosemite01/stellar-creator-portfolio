'use client';

import { useState, useCallback, useEffect } from 'react';
import albedo from '@albedo-link/intent';

/**
 * Wallet connection state and utilities for Stellar accounts via Albedo.
 */

export interface StellarAuth {
  publicKey: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const STORAGE_KEY = 'stellar_auth_key';

/**
 * Hook for managing Stellar wallet connections via Albedo.
 * 
 * Tracks wallet connection state, persists public key to localStorage,
 * and provides methods to connect/disconnect using Albedo intents.
 */
export function useStellarAuth(): StellarAuth {
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
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Use Albedo to request public key
      const response = await albedo.publicKey({});
      
      const key = response.pubkey;

      if (!key || typeof key !== 'string') {
        throw new Error('Failed to get public key from Albedo');
      }

      // Validate Stellar address format
      if (!key.startsWith('G') || key.length !== 56) {
        throw new Error('Invalid Stellar public key format received from Albedo');
      }

      setPublicKey(key);

      // Persist to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ publicKey: key }));
    } catch (err: any) {
      // Handle user cancellation or other Albedo errors
      const message = err.message || 'Failed to connect with Albedo';
      
      // Albedo throws an object with a message if user closes the window
      if (err.code === -1) {
        setError('Connection cancelled by user');
      } else {
        setError(message);
      }
      
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
