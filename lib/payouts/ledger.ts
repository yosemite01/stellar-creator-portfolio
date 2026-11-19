/**
 * Double-entry ledger for platform balances (#1737).
 *
 * Every financial movement is recorded as a pair of entries: a debit on one
 * account and a matching credit on another.  The invariant "sum of all debit
 * amounts equals sum of all credit amounts across any closed period" can be
 * verified at any time with `assertLedgerBalanced`.
 *
 * Account names follow a simple chart of accounts:
 *   CLIENT_ESCROW   – funds held in escrow on behalf of a client
 *   FREELANCER_PAYABLE – net earnings owed to a freelancer
 *   PLATFORM_FEE    – platform revenue collected
 *   REFUNDS_PAYABLE – amounts owed back to clients
 *
 * This module is intentionally in-process (no DB) to match the existing
 * in-memory payout store; the same interface can be backed by a real ledger
 * table by swapping `getStore()`.
 */

export type LedgerAccount =
  | 'CLIENT_ESCROW'
  | 'FREELANCER_PAYABLE'
  | 'PLATFORM_FEE'
  | 'REFUNDS_PAYABLE';

export type LedgerEntryType = 'DEBIT' | 'CREDIT';

export interface LedgerEntry {
  id: string;
  /** ISO-8601 timestamp */
  createdAt: string;
  account: LedgerAccount;
  type: LedgerEntryType;
  /** Positive amount in the smallest currency unit (e.g. cents / stroops). */
  amount: number;
  currency: string;
  /** Free-text description of the movement. */
  description: string;
  /** Links back to the payout, refund, or fee record that caused this entry. */
  referenceId: string;
}

interface LedgerStore {
  entries: LedgerEntry[];
}

function getStore(): LedgerStore {
  const g = globalThis as unknown as { __ledgerStore?: LedgerStore };
  if (!g.__ledgerStore) g.__ledgerStore = { entries: [] };
  return g.__ledgerStore;
}

function newId(): string {
  return `led-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Record a balanced double-entry movement.  Both legs are written atomically
 * (in-process) so the store is never left with a dangling single entry.
 *
 * @param debitAccount  Account that is debited (funds flow out).
 * @param creditAccount Account that is credited (funds flow in).
 * @param amount        Positive amount in the smallest unit.
 * @param currency      ISO currency code or token symbol (e.g. 'USDC').
 * @param description   Human-readable description shared by both legs.
 * @param referenceId   Payout / fee / refund record ID that triggered this.
 */
export function recordMovement(
  debitAccount: LedgerAccount,
  creditAccount: LedgerAccount,
  amount: number,
  currency: string,
  description: string,
  referenceId: string,
): void {
  if (amount <= 0) throw new Error(`Ledger amount must be positive, got ${amount}`);
  const now = new Date().toISOString();
  const store = getStore();

  store.entries.push({
    id: newId(),
    createdAt: now,
    account: debitAccount,
    type: 'DEBIT',
    amount,
    currency,
    description,
    referenceId,
  });

  store.entries.push({
    id: newId(),
    createdAt: now,
    account: creditAccount,
    type: 'CREDIT',
    amount,
    currency,
    description,
    referenceId,
  });
}

/** Return all ledger entries, optionally filtered by reference ID. */
export function getLedgerEntries(referenceId?: string): LedgerEntry[] {
  const { entries } = getStore();
  return referenceId ? entries.filter((e) => e.referenceId === referenceId) : [...entries];
}

/**
 * Verify the fundamental double-entry invariant: for every currency, total
 * debits must equal total credits.  Throws if the ledger is unbalanced.
 * Useful in test suites and health checks.
 */
export function assertLedgerBalanced(): void {
  const totals: Record<string, { debit: number; credit: number }> = {};

  for (const entry of getStore().entries) {
    const key = entry.currency;
    if (!totals[key]) totals[key] = { debit: 0, credit: 0 };
    if (entry.type === 'DEBIT') totals[key].debit += entry.amount;
    else totals[key].credit += entry.amount;
  }

  for (const [currency, { debit, credit }] of Object.entries(totals)) {
    // Use integer comparison with rounding to avoid floating-point drift.
    if (Math.round(debit * 1e7) !== Math.round(credit * 1e7)) {
      throw new Error(
        `Ledger imbalance for ${currency}: debits=${debit} credits=${credit}`,
      );
    }
  }
}

/** Test helper: wipe all ledger entries. */
export function resetLedger(): void {
  const g = globalThis as unknown as { __ledgerStore?: LedgerStore };
  g.__ledgerStore = { entries: [] };
}
