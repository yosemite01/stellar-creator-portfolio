/**
 * Earnings data types and aggregation for the freelancer earnings dashboard.
 *
 * Earnings are computed from released escrow/payment records (Prisma) rather
 * than static data. Aggregations are grouped by month and currency, cached per
 * user for 5 minutes, and converted to a display currency using a cached FX
 * rate while still exposing the original currency totals.
 */

import { PrismaClient } from '@prisma/client';

export type EarningCurrency = 'XLM' | 'USDC' | 'USD';

export interface EarningTransaction {
  id: string;
  bountyId: string;
  bountyTitle: string;
  clientName: string;
  /** Amount in the native currency of the transaction */
  amount: number;
  currency: EarningCurrency;
  /** USD equivalent at time of transaction (from oracle price) */
  usdEquivalent: number;
  /** ISO date string */
  date: string;
  status: 'completed' | 'pending' | 'failed';
  txHash: string;
}

export interface EarningsSummary {
  totalThisYear: number;
  totalThisMonth: number;
  pendingEscrow: number;
  /** All in USD */
  currency: 'USD';
}

/** Per-currency totals for a single month, in the original currency. */
export interface MonthlyCurrencyTotal {
  /** ISO month key, e.g. "2024-06" */
  month: string;
  currency: EarningCurrency;
  /** Sum in the original currency */
  amount: number;
  /** Sum converted to the display currency */
  displayAmount: number;
}

export interface EarningsReport {
  summary: EarningsSummary;
  /** Display currency used for converted totals */
  displayCurrency: EarningCurrency;
  /** Monthly totals grouped by month and original currency */
  monthly: MonthlyCurrencyTotal[];
}

// ── FX rates (USD per unit) ─────────────────────────────────────────────────
// Cached for 5 minutes to avoid hammering the oracle on every request.
const FX_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RATES: Record<EarningCurrency, number> = {
  XLM: 0.11,
  USDC: 1.0,
  USD: 1.0,
};

let fxCache: { rates: Record<EarningCurrency, number>; expiresAt: number } | null = null;

export function getFxRates(): Record<EarningCurrency, number> {
  const now = Date.now();
  if (fxCache && fxCache.expiresAt > now) return fxCache.rates;
  // In production this would fetch from a price oracle; fall back to defaults.
  const rates = { ...DEFAULT_RATES };
  fxCache = { rates, expiresAt: now + FX_TTL_MS };
  return rates;
}

export function toUSD(amount: number, currency: EarningCurrency): number {
  const rate = getFxRates()[currency] ?? 1;
  return parseFloat((amount * rate).toFixed(2));
}

// ── Per-user aggregation cache (5 min) ──────────────────────────────────────
const EARNINGS_TTL_MS = 5 * 60 * 1000;
const earningsCache = new Map<string, { report: EarningsReport; expiresAt: number }>();

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Aggregate released payments for a user, grouped by month and currency.
 * Returns totals converted to the display currency while preserving the
 * original currency breakdown.
 */
export async function getEarningsReport(
  userId: string,
  prisma: PrismaClient,
  displayCurrency: EarningCurrency = 'USD',
): Promise<EarningsReport> {
  const now = Date.now();
  const cached = earningsCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.report;

  const rates = getFxRates();
  const displayRate = rates[displayCurrency] ?? 1;

  // Released escrows paid to this creator. Escrow amounts are USDC.
  const released = await prisma.escrow.aggregate({
    where: { creatorId: userId, status: 'released' },
    _sum: { amount: true },
  });
  const grouped = [{ currency: 'USDC', _sum: { amount: released._sum.amount } }];

  const monthlyMap = new Map<string, MonthlyCurrencyTotal>();
  let totalThisYear = 0;
  let totalThisMonth = 0;

  const nowDate = new Date();
  const startOfYear = Date.UTC(nowDate.getUTCFullYear(), 0, 1);
  const startOfMonth = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1);

  for (const row of grouped) {
    const currency = row.currency as EarningCurrency;
    const amount = Number(row._sum.amount ?? 0);
    const usd = toUSD(amount, currency);
    const displayAmount = parseFloat((usd / displayRate).toFixed(2));

    const key = `${monthKey(nowDate)}:${currency}`;
    const existing = monthlyMap.get(key);
    if (existing) {
      existing.amount = parseFloat((existing.amount + amount).toFixed(2));
      existing.displayAmount = parseFloat((existing.displayAmount + displayAmount).toFixed(2));
    } else {
      monthlyMap.set(key, {
        month: monthKey(nowDate),
        currency,
        amount: parseFloat(amount.toFixed(2)),
        displayAmount,
      });
    }

    totalThisYear += usd;
    if (startOfMonth >= startOfYear) totalThisMonth += usd;
  }

  // Pending escrow (not yet released) in USD.
  const pending = await prisma.escrow.aggregate({
    where: { creatorId: userId, status: 'active' },
    _sum: { amount: true },
  });
  const pendingEscrow = parseFloat(Number(pending._sum.amount ?? 0).toFixed(2));

  const report: EarningsReport = {
    summary: {
      totalThisYear: parseFloat(totalThisYear.toFixed(2)),
      totalThisMonth: parseFloat(totalThisMonth.toFixed(2)),
      pendingEscrow,
      currency: 'USD',
    },
    displayCurrency,
    monthly: Array.from(monthlyMap.values()),
  };

  earningsCache.set(userId, { report, expiresAt: now + EARNINGS_TTL_MS });
  return report;
}

export function computeSummary(txs: EarningTransaction[]): EarningsSummary {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let totalThisYear = 0;
  let totalThisMonth = 0;
  let pendingEscrow = 0;

  for (const tx of txs) {
    const t = new Date(tx.date).getTime();
    if (tx.status === 'pending') {
      pendingEscrow += tx.usdEquivalent;
    } else if (tx.status === 'completed') {
      if (t >= startOfYear) totalThisYear += tx.usdEquivalent;
      if (t >= startOfMonth) totalThisMonth += tx.usdEquivalent;
    }
  }

  return {
    totalThisYear: parseFloat(totalThisYear.toFixed(2)),
    totalThisMonth: parseFloat(totalThisMonth.toFixed(2)),
    pendingEscrow: parseFloat(pendingEscrow.toFixed(2)),
    currency: 'USD',
  };
}

/**
 * A creator's escrows as dashboard transactions: released escrows count as
 * completed earnings, active ones as pending, refunded ones as failed.
 */
export async function getEarningTransactions(
  userId: string,
  prisma: PrismaClient,
): Promise<EarningTransaction[]> {
  const escrows = await prisma.escrow.findMany({
    where: { creatorId: userId },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return escrows.map((e) => {
    const status: EarningTransaction['status'] =
      e.status === 'released' ? 'completed' : e.status === 'refunded' ? 'failed' : 'pending';
    return {
      id: e.id,
      bountyId: e.id,
      bountyTitle: `Escrow ${e.id.slice(0, 8)}`,
      clientName: e.clientId,
      amount: e.amount,
      currency: 'USDC',
      usdEquivalent: toUSD(e.amount, 'USDC'),
      date: (e.releasedAt ?? e.createdAt).toISOString(),
      status,
      txHash: '',
    };
  });
}
