import { authenticateBiometric } from "./BiometricAuthService";

export interface StellarAccount {
  publicKey: string;
  label: string;
  createdAt: number;
}

interface EncryptedKeyEntry {
  publicKey: string;
  encryptedSecret: string;
}

type AccountEventType = "switched" | "added" | "removed";
type AccountEventListener = (event: {
  type: AccountEventType;
  account: StellarAccount;
}) => void;

const ACCOUNTS_STORAGE_KEY = "stellar_accounts";
const ACTIVE_ACCOUNT_KEY = "stellar_active_account";

let accounts: StellarAccount[] = [];
let activePublicKey: string | null = null;
let decryptedActiveSecret: string | null = null;
let signingLock = false;
const listeners: AccountEventListener[] = [];

function notifyListeners(type: AccountEventType, account: StellarAccount) {
  listeners.forEach((fn) => fn({ type, account }));
}

async function loadFromStorage(): Promise<void> {
  try {
    const AsyncStorage = await importAsyncStorage();
    if (!AsyncStorage) return;

    const raw = await AsyncStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw) {
      accounts = JSON.parse(raw);
    }
    activePublicKey = await AsyncStorage.getItem(ACTIVE_ACCOUNT_KEY);
  } catch {
    accounts = [];
    activePublicKey = null;
  }
}

async function persistAccounts(): Promise<void> {
  try {
    const AsyncStorage = await importAsyncStorage();
    if (!AsyncStorage) return;

    await AsyncStorage.setItem(
      ACCOUNTS_STORAGE_KEY,
      JSON.stringify(accounts),
    );
    if (activePublicKey) {
      await AsyncStorage.setItem(ACTIVE_ACCOUNT_KEY, activePublicKey);
    } else {
      await AsyncStorage.removeItem(ACTIVE_ACCOUNT_KEY);
    }
  } catch {
    // Storage unavailable
  }
}

async function importAsyncStorage() {
  try {
    const mod = await import("@react-native-async-storage/async-storage");
    return mod.default;
  } catch {
    return null;
  }
}

async function loadEncryptedKey(
  publicKey: string,
): Promise<string | null> {
  try {
    const AsyncStorage = await importAsyncStorage();
    if (!AsyncStorage) return null;
    const raw = await AsyncStorage.getItem(`keystore_${publicKey}`);
    if (!raw) return null;
    const entry: EncryptedKeyEntry = JSON.parse(raw);
    return entry.encryptedSecret;
  } catch {
    return null;
  }
}

async function storeEncryptedKey(
  publicKey: string,
  encryptedSecret: string,
): Promise<void> {
  try {
    const AsyncStorage = await importAsyncStorage();
    if (!AsyncStorage) return;
    const entry: EncryptedKeyEntry = { publicKey, encryptedSecret };
    await AsyncStorage.setItem(
      `keystore_${publicKey}`,
      JSON.stringify(entry),
    );
  } catch {
    // Storage unavailable
  }
}

async function removeEncryptedKey(publicKey: string): Promise<void> {
  try {
    const AsyncStorage = await importAsyncStorage();
    if (!AsyncStorage) return;
    await AsyncStorage.removeItem(`keystore_${publicKey}`);
  } catch {
    // Storage unavailable
  }
}

function wipeActiveKeyFromMemory(): void {
  if (decryptedActiveSecret) {
    decryptedActiveSecret = null;
  }
}

export function getAccounts(): StellarAccount[] {
  return [...accounts];
}

export function getActiveAccount(): StellarAccount | null {
  if (!activePublicKey) return null;
  return accounts.find((a) => a.publicKey === activePublicKey) ?? null;
}

export function getActivePublicKey(): string | null {
  return activePublicKey;
}

export function isSigningLocked(): boolean {
  return signingLock;
}

export function addEventListener(fn: AccountEventListener): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

export async function initialize(): Promise<void> {
  await loadFromStorage();
}

export async function addAccount(
  publicKey: string,
  encryptedSecret: string,
  label: string,
): Promise<StellarAccount> {
  const biometricResult = await authenticateBiometric();
  if (!biometricResult.success) {
    throw new Error(
      biometricResult.error ?? "Biometric authentication required to add account",
    );
  }

  const existing = accounts.find((a) => a.publicKey === publicKey);
  if (existing) {
    throw new Error("Account already exists");
  }

  const account: StellarAccount = {
    publicKey,
    label,
    createdAt: Date.now(),
  };

  await storeEncryptedKey(publicKey, encryptedSecret);
  accounts.push(account);

  if (accounts.length === 1) {
    activePublicKey = publicKey;
  }

  await persistAccounts();
  notifyListeners("added", account);
  return account;
}

export async function switchAccount(
  publicKey: string,
): Promise<StellarAccount> {
  const target = accounts.find((a) => a.publicKey === publicKey);
  if (!target) {
    throw new Error("Account not found");
  }

  if (activePublicKey === publicKey && decryptedActiveSecret) {
    return target;
  }

  if (signingLock) {
    throw new Error(
      "Cannot switch accounts while a transaction is being signed",
    );
  }

  const biometricResult = await authenticateBiometric();
  if (!biometricResult.success) {
    throw new Error(
      biometricResult.error ?? "Biometric authentication required to switch accounts",
    );
  }

  wipeActiveKeyFromMemory();

  const encryptedSecret = await loadEncryptedKey(publicKey);
  if (!encryptedSecret) {
    throw new Error("Key material not found for account");
  }

  activePublicKey = publicKey;
  decryptedActiveSecret = encryptedSecret;

  await persistAccounts();
  notifyListeners("switched", target);
  return target;
}

export async function removeAccount(publicKey: string): Promise<void> {
  const target = accounts.find((a) => a.publicKey === publicKey);
  if (!target) {
    throw new Error("Account not found");
  }

  const biometricResult = await authenticateBiometric();
  if (!biometricResult.success) {
    throw new Error(
      biometricResult.error ?? "Biometric authentication required to remove account",
    );
  }

  if (activePublicKey === publicKey) {
    wipeActiveKeyFromMemory();
    activePublicKey = null;
  }

  accounts = accounts.filter((a) => a.publicKey !== publicKey);
  await removeEncryptedKey(publicKey);

  if (accounts.length > 0 && !activePublicKey) {
    activePublicKey = accounts[0].publicKey;
  }

  await persistAccounts();
  notifyListeners("removed", target);
}

export async function signTransaction(
  transactionXdr: string,
): Promise<string> {
  if (!activePublicKey || !decryptedActiveSecret) {
    throw new Error("No active account — switch to an account first");
  }

  if (signingLock) {
    throw new Error("Another signing operation is already in progress");
  }

  signingLock = true;
  try {
    const biometricResult = await authenticateBiometric();
    if (!biometricResult.success) {
      throw new Error(
        biometricResult.error ?? "Biometric authentication required to sign",
      );
    }

    // The actual signing would use the Stellar SDK:
    // const keypair = StellarSdk.Keypair.fromSecret(decryptedActiveSecret);
    // const tx = new StellarSdk.Transaction(transactionXdr, networkPassphrase);
    // tx.sign(keypair);
    // return tx.toXDR();
    return `signed:${activePublicKey}:${transactionXdr}`;
  } finally {
    signingLock = false;
  }
}

export function getActiveSecret(): string | null {
  return decryptedActiveSecret;
}
