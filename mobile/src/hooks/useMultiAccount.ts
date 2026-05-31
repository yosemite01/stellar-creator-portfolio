/**
 * useMultiAccount
 *
 * Convenience hook that exposes multi-account switching with loading state.
 */

import { useState, useCallback } from 'react';
import { useMultiAccountStore, AccountCache } from '../services/MultiAccountService';

export function useMultiAccount() {
  const { accounts, activeAccountId, switchAccount, addAccount, removeAccount, getActiveAccount } =
    useMultiAccountStore();
  const [switching, setSwitching] = useState(false);

  const handleSwitch = useCallback(
    async (id: string) => {
      if (id === activeAccountId) return;
      setSwitching(true);
      try {
        await switchAccount(id);
      } finally {
        setSwitching(false);
      }
    },
    [activeAccountId, switchAccount],
  );

  const cacheForActive = useCallback(() => {
    const active = getActiveAccount();
    if (!active) throw new Error('No active account');
    return new AccountCache(active.id);
  }, [getActiveAccount]);

  return {
    accounts,
    activeAccountId,
    activeAccount: getActiveAccount(),
    switching,
    switchAccount: handleSwitch,
    addAccount,
    removeAccount,
    cacheForActive,
  };
}
