'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type WalletType = 'freighter' | 'albedo' | 'xbull' | 'passkey' | 'walletconnect';
export type NetworkType = 'mainnet' | 'testnet' | 'unknown';

interface WalletState {
  address: string | null;
  publicKey: string | null;
  network: NetworkType;
  walletType: WalletType | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: (wallet: WalletType) => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

// Single source of truth for the persisted wallet session. `useStellarWallet`
// and `useStellarAuth` both read from this key via the wallet context, so the
// session can never diverge between hooks.
export const WALLET_STORAGE_KEY = 'stellar_wallet';

interface PersistedWallet {
  address: string;
  publicKey: string;
  network: NetworkType;
  walletType: WalletType;
}

interface WalletAdapter {
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<NetworkType>;
}

export class StellarWalletsKit {
  constructor(private wallet: WalletType) {}

  async getAdapter(): Promise<WalletAdapter> {
    switch (this.wallet) {
      case 'freighter': {
        const { isConnected, requestAccess, getNetwork } = await import('@stellar/freighter-api');
        const connection = await isConnected();
        if (connection.error || !connection.isConnected) throw new Error('Freighter extension not found');
        return {
          getPublicKey: async () => {
            const result = await requestAccess();
            if (result.error || !result.address) throw new Error('Failed to get public key from Freighter');
            return result.address;
          },
          getNetwork: async () => {
            const result = await getNetwork();
            const n = result.error ? '' : result.network.toLowerCase();
            if (n.includes('main') || n === 'public') return 'mainnet';
            if (n.includes('test')) return 'testnet';
            return 'unknown';
          },
        };
      }
      case 'albedo': {
        const albedo = (await import('@albedo-link/intent')).default;
        return {
          getPublicKey: async () => (await albedo.publicKey({ require_existing: true })).pubkey,
          getNetwork: async () => 'unknown',
        };
      }
      case 'xbull': {
        const xbull = (window as any).xBullSDK;
        if (!xbull) throw new Error('xBull extension not found');
        return {
          getPublicKey: async () => {
            const res = await xbull.connect();
            return res.publicKey ?? res;
          },
          getNetwork: async () => 'unknown',
        };
      }
      case 'passkey': {
        const passkey = (window as any).passkeyKit;
        if (!passkey) throw new Error('Passkey wallet provider not found');
        return {
          getPublicKey: async () => (await passkey.connect()).address,
          getNetwork: async () => 'unknown',
        };
      }
      case 'walletconnect':
        throw new Error('WalletConnect not yet implemented');
    }
  }
}

async function getWalletAdapter(walletType: WalletType): Promise<WalletAdapter> {
  const kit = new StellarWalletsKit(walletType);
  return kit.getAdapter();
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    publicKey: null,
    network: 'unknown',
    walletType: null,
    isConnected: false,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function restoreAndVerify() {
      try {
        const raw = localStorage.getItem(WALLET_STORAGE_KEY);
        if (!raw) return;
        const saved: PersistedWallet = JSON.parse(raw);
        if (!saved.address || !saved.publicKey || !saved.walletType) return;

        // Verify the wallet is actually still connected
        try {
          const adapter = await getWalletAdapter(saved.walletType);
          const [publicKey, network] = await Promise.all([
            adapter.getPublicKey(),
            adapter.getNetwork(),
          ]);

          if (!cancelled) {
            setState((s) => ({
              ...s,
              address: publicKey,
              publicKey,
              network,
              walletType: saved.walletType,
              isConnected: true,
            }));
          }
        } catch {
          // Wallet not actually connected; clear saved state
          if (!cancelled) {
            localStorage.removeItem(WALLET_STORAGE_KEY);
            setState((s) => ({
              ...s,
              isConnected: false,
              address: null,
              publicKey: null,
              walletType: null,
            }));
          }
        }
      } catch {
        if (!cancelled) {
          localStorage.removeItem(WALLET_STORAGE_KEY);
        }
      }
    }

    restoreAndVerify();

    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (walletType: WalletType) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const adapter = await getWalletAdapter(walletType);
      const [publicKey, network] = await Promise.all([adapter.getPublicKey(), adapter.getNetwork()]);
      const persisted: PersistedWallet = { address: publicKey, publicKey, network, walletType };
      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(persisted));
      setState({
        address: publicKey,
        publicKey,
        network,
        walletType,
        isConnected: true,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to connect wallet';
      setState((s) => ({ ...s, isLoading: false, error, isConnected: false }));
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(WALLET_STORAGE_KEY);
    setState({
      address: null,
      publicKey: null,
      network: 'unknown',
      walletType: null,
      isConnected: false,
      isLoading: false,
      error: null,
    });
  }, []);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider');
  return ctx;
}
