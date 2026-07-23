import { useState, useEffect, useCallback } from "react";
import type { StellarAccount } from "../services/MultiAccountService";
import * as MultiAccountService from "../services/MultiAccountService";

export interface UseMultiAccountReturn {
  accounts: StellarAccount[];
  activeAccount: StellarAccount | null;
  isLoading: boolean;
  isSwitching: boolean;
  error: string | null;
  switchAccount: (publicKey: string) => Promise<void>;
  addAccount: (
    publicKey: string,
    encryptedSecret: string,
    label: string,
  ) => Promise<void>;
  removeAccount: (publicKey: string) => Promise<void>;
  signTransaction: (transactionXdr: string) => Promise<string>;
  clearError: () => void;
}

export function useMultiAccount(): UseMultiAccountReturn {
  const [accounts, setAccounts] = useState<StellarAccount[]>([]);
  const [activeAccount, setActiveAccount] =
    useState<StellarAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await MultiAccountService.initialize();
        if (mounted) {
          setAccounts(MultiAccountService.getAccounts());
          setActiveAccount(MultiAccountService.getActiveAccount());
        }
      } catch (e) {
        if (mounted) {
          setError(
            e instanceof Error ? e.message : "Failed to initialize accounts",
          );
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    init();

    const unsub = MultiAccountService.addEventListener((event) => {
      if (!mounted) return;
      setAccounts(MultiAccountService.getAccounts());
      setActiveAccount(MultiAccountService.getActiveAccount());
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const switchAccount = useCallback(async (publicKey: string) => {
    setIsSwitching(true);
    setError(null);
    try {
      const account = await MultiAccountService.switchAccount(publicKey);
      setActiveAccount(account);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to switch account";
      setError(msg);
      throw e;
    } finally {
      setIsSwitching(false);
    }
  }, []);

  const addAccount = useCallback(
    async (
      publicKey: string,
      encryptedSecret: string,
      label: string,
    ) => {
      setError(null);
      try {
        await MultiAccountService.addAccount(
          publicKey,
          encryptedSecret,
          label,
        );
        setAccounts(MultiAccountService.getAccounts());
        setActiveAccount(MultiAccountService.getActiveAccount());
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Failed to add account";
        setError(msg);
        throw e;
      }
    },
    [],
  );

  const removeAccount = useCallback(async (publicKey: string) => {
    setError(null);
    try {
      await MultiAccountService.removeAccount(publicKey);
      setAccounts(MultiAccountService.getAccounts());
      setActiveAccount(MultiAccountService.getActiveAccount());
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to remove account";
      setError(msg);
      throw e;
    }
  }, []);

  const signTransaction = useCallback(async (transactionXdr: string) => {
    setError(null);
    try {
      return await MultiAccountService.signTransaction(transactionXdr);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to sign transaction";
      setError(msg);
      throw e;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    accounts,
    activeAccount,
    isLoading,
    isSwitching,
    error,
    switchAccount,
    addAccount,
    removeAccount,
    signTransaction,
    clearError,
  };
}
