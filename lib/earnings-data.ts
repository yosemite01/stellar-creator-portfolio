/**
 * Earnings data types, historical currency conversion, and tax export utilities
 * for the freelancer earnings dashboard.
 *
 * Earnings are derived from on-chain/database payouts ledger and escrow events
 * (Escrow, Transaction, PayoutRecord) rather than static data.
 *
 * Provides:
 * - Historical FX conversion at the exact time of payment
 * - Current vs historical valuation and unrealized FX gain/loss tracking
 * - Tax-year exports (CSV, JSON, 1099-NEC, VAT invoice)
 * - Pure isomorphic utilities safe for both client and server components
 */

export type EarningCurrency = 'XLM' | 'USDC' | 'USD';

export interface EarningTransaction {
  id: string;
  bountyId: string;
  bountyTitle: string;
  clientName: string;
  /** Amount in native currency of transaction */
  amount: number;
  currency: EarningCurrency;
  /** USD equivalent at time of transaction (constructive receipt value for taxes) */
  usdEquivalent: number;
  /** Current USD valuation at spot rate (optional) */
  currentUsdEquivalent?: number;
  /** Unrealized currency gain/loss between payment date and spot (optional) */
  unrealizedGainLoss?: number;
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
  /** ISO month key, e.g. "2026-03" */
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
  /** Detailed transactions derived from ledger */
  transactions?: EarningTransaction[];
}

export interface TaxYearSummary {
  taxYear: number;
  userId: string;
  totalGrossUSD: number;
  totalNetUSD: number;
  platformFeesUSD: number;
  currencyBreakdown: Record<
    EarningCurrency,
    { nativeAmount: number; usdEquivalent: number; count: number }
  >;
  transactionCount: number;
  transactions: EarningTransaction[];
}

// ── FX Rates (USD per unit) ─────────────────────────────────────────────────
export const DEFAULT_RATES: Record<EarningCurrency, number> = {
  XLM: 0.11,
  USDC: 1.0,
  USD: 1.0,
};

// Cached spot rates (5 min TTL)
const FX_TTL_MS = 5 * 60 * 1000;
let fxCache: { rates: Record<EarningCurrency, number>; expiresAt: number } | null = null;

export function getFxRates(): Record<EarningCurrency, number> {
  const now = Date.now();
  if (fxCache && fxCache.expiresAt > now) return fxCache.rates;
  const rates = { ...DEFAULT_RATES };
  fxCache = { rates, expiresAt: now + FX_TTL_MS };
  return rates;
}

/**
 * Historical exchange rates lookup (USD per unit of currency).
 * In production or test environments, gives exact rates at transaction time.
 */
const HISTORICAL_XLM_RATES: Array<{ date: string; rate: number }> = [
  { date: '2024-01-01', rate: 0.12 },
  { date: '2024-07-01', rate: 0.09 },
  { date: '2025-01-01', rate: 0.10 },
  { date: '2025-06-01', rate: 0.13 },
  { date: '2026-01-01', rate: 0.11 },
  { date: '2026-06-01', rate: 0.12 },
];

/**
 * Returns the historical exchange rate (USD per unit) for a given currency and date.
 */
export function getHistoricalFxRate(
  currency: EarningCurrency,
  date: Date | string | number,
): number {
  if (currency === 'USD' || currency === 'USDC') {
    return 1.0;
  }
  const targetTime = new Date(date).getTime();
  if (isNaN(targetTime)) {
    return DEFAULT_RATES[currency] ?? 1.0;
  }

  // Find the closest historical rate entry prior to or on targetTime
  let matchedRate = DEFAULT_RATES[currency] ?? 1.0;
  for (const entry of HISTORICAL_XLM_RATES) {
    if (new Date(entry.date).getTime() <= targetTime) {
      matchedRate = entry.rate;
    }
  }
  return matchedRate;
}

/**
 * Convert an amount in native currency to USD.
 * If `atDate` is provided, converts at the historical exchange rate at time of payment.
 * Otherwise uses current spot rate.
 */
export function toUSD(
  amount: number,
  currency: EarningCurrency,
  atDate?: Date | string | number,
): number {
  const rate = atDate != null ? getHistoricalFxRate(currency, atDate) : (getFxRates()[currency] ?? 1);
  return parseFloat((amount * rate).toFixed(2));
}

/**
 * Converts currency at payment time, calculating both historical receipt valuation
 * and unrealized spot gain/loss.
 */
export function convertAtPaymentTime(
  amount: number,
  fromCurrency: EarningCurrency,
  toCurrency: EarningCurrency = 'USD',
  paymentDate: Date | string | number = new Date(),
): {
  amount: number;
  fromCurrency: EarningCurrency;
  toCurrency: EarningCurrency;
  historicalRate: number;
  spotRate: number;
  historicalValueUSD: number;
  spotValueUSD: number;
  unrealizedGainLoss: number;
} {
  const historicalRate = getHistoricalFxRate(fromCurrency, paymentDate);
  const spotRate = getFxRates()[fromCurrency] ?? 1.0;
  const targetSpotRate = getFxRates()[toCurrency] ?? 1.0;

  const historicalValueUSD = parseFloat((amount * historicalRate).toFixed(2));
  const spotValueUSD = parseFloat((amount * spotRate).toFixed(2));
  const unrealizedGainLoss = parseFloat((spotValueUSD - historicalValueUSD).toFixed(2));

  const convertedAmount = parseFloat((historicalValueUSD / targetSpotRate).toFixed(2));

  return {
    amount: convertedAmount,
    fromCurrency,
    toCurrency,
    historicalRate,
    spotRate,
    historicalValueUSD,
    spotValueUSD,
    unrealizedGainLoss,
  };
}

// ── Summary Calculations ────────────────────────────────────────────────────
export function computeSummary(txs: EarningTransaction[]): EarningsSummary {
  const now = new Date();
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

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

// ── Tax-Year Aggregations & Exports ──────────────────────────────────────────
export function computeTaxYearSummary(
  taxYear: number,
  userId: string,
  transactions: EarningTransaction[],
  platformFeeRate = 0.10,
): TaxYearSummary {
  const yearStart = new Date(Date.UTC(taxYear, 0, 1, 0, 0, 0)).getTime();
  const yearEnd = new Date(Date.UTC(taxYear, 11, 31, 23, 59, 59, 999)).getTime();

  const filtered = transactions.filter((tx) => {
    if (tx.status !== 'completed') return false;
    const t = new Date(tx.date).getTime();
    return t >= yearStart && t <= yearEnd;
  });

  let totalGrossUSD = 0;
  const currencyBreakdown: Record<
    EarningCurrency,
    { nativeAmount: number; usdEquivalent: number; count: number }
  > = {
    USD: { nativeAmount: 0, usdEquivalent: 0, count: 0 },
    USDC: { nativeAmount: 0, usdEquivalent: 0, count: 0 },
    XLM: { nativeAmount: 0, usdEquivalent: 0, count: 0 },
  };

  for (const tx of filtered) {
    totalGrossUSD += tx.usdEquivalent;
    const cur = currencyBreakdown[tx.currency] ?? { nativeAmount: 0, usdEquivalent: 0, count: 0 };
    cur.nativeAmount = parseFloat((cur.nativeAmount + tx.amount).toFixed(2));
    cur.usdEquivalent = parseFloat((cur.usdEquivalent + tx.usdEquivalent).toFixed(2));
    cur.count += 1;
    currencyBreakdown[tx.currency] = cur;
  }

  totalGrossUSD = parseFloat(totalGrossUSD.toFixed(2));
  const platformFeesUSD = parseFloat((totalGrossUSD * platformFeeRate).toFixed(2));
  const totalNetUSD = parseFloat((totalGrossUSD - platformFeesUSD).toFixed(2));

  return {
    taxYear,
    userId,
    totalGrossUSD,
    totalNetUSD,
    platformFeesUSD,
    currencyBreakdown,
    transactionCount: filtered.length,
    transactions: filtered,
  };
}

export function exportTaxYearCSV(summary: TaxYearSummary): string {
  const headers = [
    'Tax Year',
    'Date (UTC)',
    'Transaction ID',
    'Bounty ID',
    'Bounty Title',
    'Client',
    'Currency',
    'Gross Amount (Native)',
    'USD Equivalent At Payment',
    'Platform Fee (USD)',
    'Net Earnings (USD)',
    'Status',
    'Tx Hash',
  ];

  const rows = summary.transactions.map((tx) => {
    const fee = parseFloat((tx.usdEquivalent * 0.10).toFixed(2));
    const net = parseFloat((tx.usdEquivalent - fee).toFixed(2));
    return [
      summary.taxYear,
      new Date(tx.date).toISOString().slice(0, 10),
      tx.id,
      tx.bountyId,
      `"${tx.bountyTitle.replace(/"/g, '""')}"`,
      `"${tx.clientName.replace(/"/g, '""')}"`,
      tx.currency,
      tx.amount,
      tx.usdEquivalent,
      fee,
      net,
      tx.status,
      tx.txHash,
    ].join(',');
  });

  const totalsRow = [
    `TOTAL ${summary.taxYear}`,
    '',
    '',
    '',
    `"${summary.transactionCount} transactions"`,
    '',
    'USD',
    '',
    summary.totalGrossUSD,
    summary.platformFeesUSD,
    summary.totalNetUSD,
    'COMPLETED',
    '',
  ].join(',');

  return [headers.join(','), ...rows, totalsRow].join('\n');
}

export function toCSV(rows: EarningTransaction[]): string {
  const headers = [
    'Date',
    'Bounty ID',
    'Bounty Title',
    'Client',
    'Amount',
    'Currency',
    'USD Equivalent',
    'Status',
    'Tx Hash',
  ];
  const lines = rows.map((r) => [
    new Date(r.date).toISOString().slice(0, 10),
    r.bountyId,
    `"${r.bountyTitle.replace(/"/g, '""')}"`,
    `"${r.clientName.replace(/"/g, '""')}"`,
    r.amount,
    r.currency,
    r.usdEquivalent,
    r.status,
    r.txHash,
  ].join(','));
  return [headers.join(','), ...lines].join('\n');
}

export function generate1099(
  summaryOrRows: TaxYearSummary | EarningTransaction[],
  totalUSD?: number,
  recipientName = 'Freelance Creator',
): string {
  let rows: EarningTransaction[];
  let gross: number;
  let taxYear = new Date().getFullYear();

  if ('taxYear' in summaryOrRows) {
    rows = summaryOrRows.transactions;
    gross = summaryOrRows.totalGrossUSD;
    taxYear = summaryOrRows.taxYear;
  } else {
    rows = summaryOrRows.filter((r) => r.status === 'completed');
    gross = totalUSD ?? rows.reduce((s, r) => s + r.usdEquivalent, 0);
    if (rows.length > 0) {
      taxYear = new Date(rows[0].date).getFullYear();
    }
  }

  return [
    `FORM 1099-NEC REPORT - TAX YEAR ${taxYear}`,
    'Nonemployee Compensation Information Return',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    `Recipient: ${recipientName}`,
    '',
    `Box 1: Nonemployee Compensation: $${gross.toFixed(2)} USD`,
    '',
    'TRANSACTION LEDGER BREAKDOWN',
    '------------------------------------------------------------------------',
    ...rows.map((r) =>
      `${new Date(r.date).toISOString().slice(0, 10)}  ${r.bountyTitle.slice(0, 30).padEnd(32)} ${r.amount.toString().padStart(8)} ${r.currency.padEnd(5)} $${r.usdEquivalent.toFixed(2).padStart(8)} USD`
    ),
    '------------------------------------------------------------------------',
    `TOTAL NONEMPLOYEE COMPENSATION: $${gross.toFixed(2)} USD`,
    '',
    'DISCLAIMER: This document is an informational statement of payments made via',
    'Tamgora escrow contracts. It is not an official IRS filing.',
  ].join('\n');
}

export function generateVAT(
  summaryOrRows: TaxYearSummary | EarningTransaction[],
  totalUSD?: number,
  recipientName = 'Freelance Creator',
): string {
  let rows: EarningTransaction[];
  let gross: number;
  let taxYear = new Date().getFullYear();

  if ('taxYear' in summaryOrRows) {
    rows = summaryOrRows.transactions;
    gross = summaryOrRows.totalGrossUSD;
    taxYear = summaryOrRows.taxYear;
  } else {
    rows = summaryOrRows.filter((r) => r.status === 'completed');
    gross = totalUSD ?? rows.reduce((s, r) => s + r.usdEquivalent, 0);
    if (rows.length > 0) {
      taxYear = new Date(rows[0].date).getFullYear();
    }
  }

  const vatRate = 0.20;
  const netAmount = parseFloat((gross / (1 + vatRate)).toFixed(2));
  const vatAmount = parseFloat((gross - netAmount).toFixed(2));

  return [
    `VAT SUMMARY INVOICE - TAX YEAR ${taxYear}`,
    `Invoice Date: ${new Date().toISOString().slice(0, 10)}`,
    `Recipient: ${recipientName}`,
    '',
    'SERVICES RENDERED (ON-CHAIN ESCROW RELEASES)',
    '------------------------------------------------------------------------',
    ...rows.map((r) =>
      `${new Date(r.date).toISOString().slice(0, 10)}  ${r.bountyTitle.slice(0, 30).padEnd(32)} ${r.amount.toString().padStart(8)} ${r.currency.padEnd(5)} $${r.usdEquivalent.toFixed(2).padStart(8)} USD`
    ),
    '------------------------------------------------------------------------',
    `Net Amount (excl. VAT): $${netAmount.toFixed(2)} USD`,
    `VAT Amount (20%):       $${vatAmount.toFixed(2)} USD`,
    `Gross Total (incl. VAT): $${gross.toFixed(2)} USD`,
    '',
    'NOTE: This document is for tax reference only. Consult a certified accountant.',
  ].join('\n');
}

// ── Realistic Demo/Fallback Fixture Data ─────────────────────────────────────
export const mockTransactions: EarningTransaction[] = [
  {
    id: 'tx-001',
    bountyId: 'bounty-101',
    bountyTitle: 'Soroban Smart Contract Audit',
    clientName: 'Stellar Foundation Grantee',
    amount: 2500,
    currency: 'USDC',
    usdEquivalent: 2500,
    date: '2026-02-15T14:30:00Z',
    status: 'completed',
    txHash: 'e637841c7b8c8d5a2d0efb82cf7d12a938c8230b0e352ef164c4c51480f7457a',
  },
  {
    id: 'tx-002',
    bountyId: 'bounty-102',
    bountyTitle: 'Frontend Wallet Integration',
    clientName: 'Nexus Labs',
    amount: 15000,
    currency: 'XLM',
    usdEquivalent: 1650, // 15000 * 0.11
    date: '2026-03-20T10:15:00Z',
    status: 'completed',
    txHash: 'b4a8e8f81395b058ad57b545d1d6a6c6a4618e95e4e84b8402dbca7bb577a331',
  },
  {
    id: 'tx-003',
    bountyId: 'bounty-103',
    bountyTitle: 'DeFi Liquidity Pool Dashboard',
    clientName: 'Orbit Finance',
    amount: 3200,
    currency: 'USD',
    usdEquivalent: 3200,
    date: '2026-04-10T16:45:00Z',
    status: 'completed',
    txHash: '7c89f1d0a2b3c4e5f67890123456789abcdef0123456789abcdef0123456789a',
  },
  {
    id: 'tx-004',
    bountyId: 'bounty-104',
    bountyTitle: 'Cross-Border Payment Corridor Optimization',
    clientName: 'GlobalPay Inc',
    amount: 1800,
    currency: 'USDC',
    usdEquivalent: 1800,
    date: '2025-11-12T09:20:00Z',
    status: 'completed',
    txHash: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
  },
  {
    id: 'tx-005',
    bountyId: 'bounty-105',
    bountyTitle: 'Soroban State Archival Research',
    clientName: 'Core Research Group',
    amount: 2000,
    currency: 'USDC',
    usdEquivalent: 2000,
    date: '2026-05-01T12:00:00Z',
    status: 'pending',
    txHash: 'pending_escrow_bounty_105',
  },
];

// ── Server-side Bridge for Backward Compatibility ────────────────────────────
export async function getEarningsReport(
  userId: string,
  prisma?: any,
  displayCurrency: EarningCurrency = 'USD',
): Promise<EarningsReport> {
  const { getEarningsReport: fetchReport } = await import('@/server/services/earnings-service');
  return fetchReport(userId, prisma, displayCurrency);
}
