/**
 * MultiAccountService
 *
 * Manages multiple creator/agency accounts with:
 *  - Completely isolated AsyncStorage namespaces per account.
 *  - Encryption-key rotation on every account swap (simulated via a
 *    per-account key stored in SecureStore / AsyncStorage).
 *  - Independent cache buckets so switching accounts never leaks data.
 *
 * In production, replace the `_deriveKey` stub with a real KDF backed by
 * expo-secure-store or react-native-keychain.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccountProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  /** Opaque per-account encryption key handle. */
  encKeyHandle: string;
}

interface MultiAccountState {
  accounts: AccountProfile[];
  activeAccountId: string | null;
  addAccount: (profile: Omit<AccountProfile, 'encKeyHandle'>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
  getActiveAccount: () => AccountProfile | null;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const REGISTRY_KEY = '@stellar/accounts_registry';

/** Returns the namespaced AsyncStorage key for a given account + data key. */
export function accountStorageKey(accountId: string, dataKey: string): string {
  return `@stellar/account_${accountId}/${dataKey}`;
}

/** Derive (or retrieve) a per-account encryption key handle. */
async function _deriveKey(accountId: string): Promise<string> {
  const handleKey = `@stellar/enc_key_${accountId}`;
  const existing = await AsyncStorage.getItem(handleKey);
  if (existing) return existing;

  // In production: use expo-crypto or react-native-keychain to generate a
  // real 256-bit key and store it in the secure enclave.
  const handle = `key_${accountId}_${Date.now().toString(36)}`;
  await AsyncStorage.setItem(handleKey, handle);
  return handle;
}

/** Rotate the encryption key for an account (called on every account swap). */
async function _rotateKey(accountId: string): Promise<string> {
  const handleKey = `@stellar/enc_key_${accountId}`;
  const newHandle = `key_${accountId}_${Date.now().toString(36)}_rotated`;
  await AsyncStorage.setItem(handleKey, newHandle);
  return newHandle;
}

// ─── Zustand store ────────────────────────────────────────────────────────────

export const useMultiAccountStore = create<MultiAccountState>()(
  persist(
    (set, get) => ({
      accounts: [],
      activeAccountId: null,

      addAccount: async (profile) => {
        const encKeyHandle = await _deriveKey(profile.id);
        const account: AccountProfile = { ...profile, encKeyHandle };
        set((s) => ({ accounts: [...s.accounts, account] }));
      },

      removeAccount: async (id) => {
        // Wipe all namespaced keys for this account.
        const allKeys = await AsyncStorage.getAllKeys();
        const accountKeys = allKeys.filter((k) =>
          k.startsWith(`@stellar/account_${id}/`),
        );
        if (accountKeys.length) await AsyncStorage.multiRemove(accountKeys);
        await AsyncStorage.removeItem(`@stellar/enc_key_${id}`);

        set((s) => ({
          accounts: s.accounts.filter((a) => a.id !== id),
          activeAccountId:
            s.activeAccountId === id ? null : s.activeAccountId,
        }));
      },

      switchAccount: async (id) => {
        const { accounts } = get();
        const target = accounts.find((a) => a.id === id);
        if (!target) throw new Error(`Account ${id} not found`);

        // Rotate the encryption key on every switch.
        const newHandle = await _rotateKey(id);
        set((s) => ({
          activeAccountId: id,
          accounts: s.accounts.map((a) =>
            a.id === id ? { ...a, encKeyHandle: newHandle } : a,
          ),
        }));
      },

      getActiveAccount: () => {
        const { accounts, activeAccountId } = get();
        return accounts.find((a) => a.id === activeAccountId) ?? null;
      },
    }),
    {
      name: REGISTRY_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

// ─── Per-account cache ────────────────────────────────────────────────────────

/**
 * Lightweight per-account cache bucket.
 * Each account gets its own isolated namespace so caches never bleed across
 * account boundaries.
 */
export class AccountCache {
  constructor(private readonly accountId: string) {}

  private key(k: string) {
    return accountStorageKey(this.accountId, `cache/${k}`);
  }

  async get<T>(k: string): Promise<T | null> {
    const raw = await AsyncStorage.getItem(this.key(k));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(k: string, value: T): Promise<void> {
    await AsyncStorage.setItem(this.key(k), JSON.stringify(value));
  }

  async invalidate(k: string): Promise<void> {
    await AsyncStorage.removeItem(this.key(k));
  }

  async flush(): Promise<void> {
    const allKeys = await AsyncStorage.getAllKeys();
    const mine = allKeys.filter((k) =>
      k.startsWith(accountStorageKey(this.accountId, 'cache/')),
    );
    if (mine.length) await AsyncStorage.multiRemove(mine);
  }
}
