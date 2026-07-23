'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type WalletType = 'freighter' | 'albedo' | 'xbull' | 'walletconnect';
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

const STORAGE_KEY = 'stellar_wallet';

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

async function getFreighterAdapter(): Promise<WalletAdapter> {
  const { isConnected, getPublicKey, getNetwork } = await import('@stellar/freighter-api');
  const connected = await isConnected();
  if (!connected) throw new Error('Freighter extension not found');
  return {
    getPublicKey: async () => {
      const result = await getPublicKey();
      if (typeof result === 'string') return result;
      if (result && typeof (result as any).publicKey === 'string') return (result as any).publicKey;
      throw new Error('Failed to get public key from Freighter');
    },
    getNetwork: async () => {
      const net = await getNetwork();
      const n = typeof net === 'string' ? net : (net as any)?.network ?? '';
      if (n.toLowerCase().includes('main')) return 'mainnet';
      if (n.toLowerCase().includes('test')) return 'testnet';
      return 'unknown';
    },
  };
}

async function getAlbedoAdapter(): Promise<WalletAdapter> {
  const albedo = (await import('@albedo-link/intent')).default;
  return {
    getPublicKey: async () => {
      const res = await albedo.publicKey({ require_existing: true });
      return res.pubkey;
    },
    getNetwork: async () => 'unknown',
  };
}

async function getXBullAdapter(): Promise<WalletAdapter> {
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

async function getWalletAdapter(walletType: WalletType): Promise<WalletAdapter> {
  switch (walletType) {
    case 'freighter': return getFreighterAdapter();
    case 'albedo': return getAlbedoAdapter();
    case 'xbull': return getXBullAdapter();
    case 'walletconnect': throw new Error('WalletConnect not yet implemented');
  }
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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: PersistedWallet = JSON.parse(raw);
      if (saved.address && saved.publicKey && saved.walletType) {
        setState((s) => ({
          ...s,
          address: saved.address,
          publicKey: saved.publicKey,
          network: saved.network,
          walletType: saved.walletType,
          isConnected: true,
        }));
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const connect = useCallback(async (walletType: WalletType) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const adapter = await getWalletAdapter(walletType);
      const [publicKey, network] = await Promise.all([adapter.getPublicKey(), adapter.getNetwork()]);
      const persisted: PersistedWallet = { address: publicKey, publicKey, network, walletType };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
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
    localStorage.removeItem(STORAGE_KEY);
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
