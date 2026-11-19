import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  toUSD,
  getHistoricalFxRate,
  getFxRates,
  convertAtPaymentTime,
  computeSummary,
  computeTaxYearSummary,
  exportTaxYearCSV,
  generate1099,
  generateVAT,
  toCSV,
  mockTransactions,
  type EarningTransaction,
} from '@/lib/earnings-data';
import {
  getLedgerEarningsTransactions,
  getEarningsReport,
  getTaxYearExport,
  clearEarningsCache,
} from '@/server/services/earnings-service';

// Mock in-memory payouts store to isolate tests
vi.mock('@/lib/payouts/payout-service', () => ({
  listPayoutsForFreelancer: vi.fn().mockReturnValue([]),
}));

import { listPayoutsForFreelancer } from '@/lib/payouts/payout-service';

describe('Earnings Ledger & Historical Currency Conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listPayoutsForFreelancer as any).mockReturnValue([]);
    clearEarningsCache();
  });

  describe('Currency conversion at time of payment', () => {
    it('returns 1.0 for pegged USD and USDC at any date', () => {
      expect(getHistoricalFxRate('USD', '2024-05-10')).toBe(1.0);
      expect(getHistoricalFxRate('USDC', '2025-08-20')).toBe(1.0);
      expect(getHistoricalFxRate('USD', new Date())).toBe(1.0);
    });

    it('returns historical exchange rate for XLM based on payment date', () => {
      const rate2024 = getHistoricalFxRate('XLM', '2024-03-01');
      const rate2025 = getHistoricalFxRate('XLM', '2025-07-01');
      const rate2026 = getHistoricalFxRate('XLM', '2026-03-01');

      expect(rate2024).toBe(0.12);
      expect(rate2025).toBe(0.13);
      expect(rate2026).toBe(0.11);
    });

    it('calculates toUSD using historical rate when payment date is provided', () => {
      // 10,000 XLM on 2024-03-01 at rate 0.12 = $1,200.00
      const usd2024 = toUSD(10000, 'XLM', '2024-03-01');
      expect(usd2024).toBe(1200);

      // 10,000 XLM on 2025-07-01 at rate 0.13 = $1,300.00
      const usd2025 = toUSD(10000, 'XLM', '2025-07-01');
      expect(usd2025).toBe(1300);
    });

    it('computes historical valuation vs current spot and unrealized gain/loss', () => {
      // 10,000 XLM received on 2024-03-01 (rate 0.12 = $1,200.00)
      // Spot rate is 0.11 ($1,100.00)
      const conversion = convertAtPaymentTime(10000, 'XLM', 'USD', '2024-03-01');

      expect(conversion.historicalRate).toBe(0.12);
      expect(conversion.spotRate).toBe(0.11);
      expect(conversion.historicalValueUSD).toBe(1200);
      expect(conversion.spotValueUSD).toBe(1100);
      expect(conversion.unrealizedGainLoss).toBe(-100); // 1100 - 1200
    });
  });

  describe('Tax-Year Aggregations & Exports', () => {
    const testTransactions: EarningTransaction[] = [
      {
        id: 'tx-2025-1',
        bountyId: 'b-1',
        bountyTitle: 'Bounty 2025 A',
        clientName: 'Client Alpha',
        amount: 1000,
        currency: 'USDC',
        usdEquivalent: 1000,
        date: '2025-04-15T12:00:00Z',
        status: 'completed',
        txHash: 'hash-1',
      },
      {
        id: 'tx-2025-2',
        bountyId: 'b-2',
        bountyTitle: 'Bounty 2025 B',
        clientName: 'Client Beta',
        amount: 20000,
        currency: 'XLM',
        usdEquivalent: 2600, // 20000 * 0.13
        date: '2025-08-20T10:00:00Z',
        status: 'completed',
        txHash: 'hash-2',
      },
      {
        id: 'tx-2025-pending',
        bountyId: 'b-3',
        bountyTitle: 'Pending 2025',
        clientName: 'Client Gamma',
        amount: 500,
        currency: 'USDC',
        usdEquivalent: 500,
        date: '2025-09-01T10:00:00Z',
        status: 'pending',
        txHash: 'hash-pending',
      },
      {
        id: 'tx-2026-1',
        bountyId: 'b-4',
        bountyTitle: 'Bounty 2026 A',
        clientName: 'Client Delta',
        amount: 3000,
        currency: 'USD',
        usdEquivalent: 3000,
        date: '2026-02-10T14:00:00Z',
        status: 'completed',
        txHash: 'hash-4',
      },
    ];

    it('filters completed transactions strictly for the specified calendar tax year', () => {
      const summary2025 = computeTaxYearSummary(2025, 'user-1', testTransactions);
      expect(summary2025.taxYear).toBe(2025);
      expect(summary2025.transactionCount).toBe(2);
      expect(summary2025.totalGrossUSD).toBe(3600); // 1000 + 2600
      expect(summary2025.platformFeesUSD).toBe(360); // 10%
      expect(summary2025.totalNetUSD).toBe(3240);

      // Pending transaction is excluded from completed tax export
      expect(summary2025.transactions.some((t) => t.status === 'pending')).toBe(false);

      // Year 2026 check
      const summary2026 = computeTaxYearSummary(2026, 'user-1', testTransactions);
      expect(summary2026.transactionCount).toBe(1);
      expect(summary2026.totalGrossUSD).toBe(3000);
      expect(summary2026.totalNetUSD).toBe(2700);
    });

    it('generates a well-formatted CSV with totals row', () => {
      const summary = computeTaxYearSummary(2025, 'user-1', testTransactions);
      const csv = exportTaxYearCSV(summary);

      expect(csv).toContain('Tax Year,Date (UTC),Transaction ID');
      expect(csv).toContain('2025,2025-04-15,tx-2025-1,b-1,"Bounty 2025 A","Client Alpha",USDC,1000,1000,100,900,completed,hash-1');
      expect(csv).toContain('TOTAL 2025');
      expect(csv).toContain('3600,360,3240');
    });

    it('generates a 1099-NEC summary with nonemployee compensation box', () => {
      const summary = computeTaxYearSummary(2025, 'user-1', testTransactions);
      const doc = generate1099(summary, undefined, 'Alex Rivera');

      expect(doc).toContain('FORM 1099-NEC REPORT - TAX YEAR 2025');
      expect(doc).toContain('Recipient: Alex Rivera');
      expect(doc).toContain('Box 1: Nonemployee Compensation: $3600.00 USD');
      expect(doc).toContain('Bounty 2025 A');
      expect(doc).toContain('TOTAL NONEMPLOYEE COMPENSATION: $3600.00 USD');
    });

    it('generates a VAT invoice with 20% standard rate calculation', () => {
      const summary = computeTaxYearSummary(2025, 'user-1', testTransactions);
      const vat = generateVAT(summary, undefined, 'Alex Rivera');

      expect(vat).toContain('VAT SUMMARY INVOICE - TAX YEAR 2025');
      expect(vat).toContain('Gross Total (incl. VAT): $3600.00 USD');
      expect(vat).toContain('VAT Amount (20%):');
    });
  });

  describe('Deriving earnings from payouts ledger & escrow events', () => {
    it('derives earnings accurately from Prisma escrows and transactions', async () => {
      const mockPrisma = {
        escrow: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'escrow-101',
              creatorId: 'user-1',
              clientId: 'client-99',
              amount: 2500,
              status: 'released',
              createdAt: new Date('2026-01-10T10:00:00Z'),
              releasedAt: new Date('2026-01-15T15:00:00Z'),
            },
            {
              id: 'escrow-102',
              creatorId: 'user-1',
              clientId: 'client-88',
              amount: 1500,
              status: 'active',
              createdAt: new Date('2026-02-01T12:00:00Z'),
              releasedAt: null,
            },
          ]),
        },
        transaction: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'tx-201',
              userId: 'user-1',
              escrowId: 'escrow-101', // Should deduplicate with escrow-101
              type: 'escrow_release',
              amount: 2500,
              status: 'completed',
              createdAt: new Date('2026-01-15T15:00:00Z'),
            },
            {
              id: 'tx-202',
              userId: 'user-1',
              escrowId: null, // Direct payout
              type: 'payment',
              amount: 800,
              status: 'completed',
              createdAt: new Date('2026-02-10T11:00:00Z'),
            },
          ]),
        },
      } as any;

      const transactions = await getLedgerEarningsTransactions('user-1', mockPrisma);

      // Expect 3 unique transactions:
      // 1. released escrow (completed, $2500)
      // 2. active escrow (pending, $1500)
      // 3. direct transaction (completed, $800)
      expect(transactions.length).toBe(3);

      const completed = transactions.filter((t) => t.status === 'completed');
      const pending = transactions.filter((t) => t.status === 'pending');

      expect(completed.length).toBe(2);
      expect(pending.length).toBe(1);

      const totalCompletedUSD = completed.reduce((sum, t) => sum + t.usdEquivalent, 0);
      expect(totalCompletedUSD).toBe(3300); // 2500 + 800

      const pendingUSD = pending.reduce((sum, t) => sum + t.usdEquivalent, 0);
      expect(pendingUSD).toBe(1500);
    });

    it('aggregates earnings report with monthly breakdown and caching', async () => {
      const mockPrisma = {
        escrow: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'escrow-jan',
              creatorId: 'user-1',
              clientId: 'client-1',
              amount: 2000,
              status: 'released',
              createdAt: new Date('2026-01-10T00:00:00Z'),
              releasedAt: new Date('2026-01-12T00:00:00Z'),
            },
            {
              id: 'escrow-feb',
              creatorId: 'user-1',
              clientId: 'client-2',
              amount: 1500,
              status: 'released',
              createdAt: new Date('2026-02-10T00:00:00Z'),
              releasedAt: new Date('2026-02-12T00:00:00Z'),
            },
          ]),
        },
        transaction: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as any;

      const report = await getEarningsReport('user-1', mockPrisma, 'USD');

      expect(report.displayCurrency).toBe('USD');
      expect(report.summary.totalThisYear).toBeGreaterThanOrEqual(3500);
      expect(report.monthly.length).toBe(2);

      const months = report.monthly.map((m) => m.month);
      expect(months).toContain('2026-01');
      expect(months).toContain('2026-02');

      // Second call uses cache without re-querying Prisma
      const cachedReport = await getEarningsReport('user-1', mockPrisma, 'USD');
      expect(cachedReport).toBe(report);
      expect(mockPrisma.escrow.findMany).toHaveBeenCalledTimes(1);
    });

    it('integrates payout records from payout-service if present', async () => {
      (listPayoutsForFreelancer as any).mockReturnValue([
        {
          id: 'po-reg-1',
          freelancerUserId: 'user-2',
          bountyId: 'b-reg-1',
          bountyTitle: 'Registered Payout Bounty',
          clientName: 'Enterprise Client',
          grossAmount: 4000,
          currency: 'USDC',
          status: 'completed',
          createdAt: '2026-03-01T10:00:00Z',
          completedAt: '2026-03-01T10:00:00Z',
        },
      ]);

      const emptyPrisma = {
        escrow: { findMany: vi.fn().mockResolvedValue([]) },
        transaction: { findMany: vi.fn().mockResolvedValue([]) },
      } as any;

      const transactions = await getLedgerEarningsTransactions('user-2', emptyPrisma);
      expect(transactions.length).toBe(1);
      expect(transactions[0].id).toBe('po-reg-1');
      expect(transactions[0].amount).toBe(4000);
      expect(transactions[0].usdEquivalent).toBe(4000);
    });

    it('returns empty array when user has no escrows or transactions in ledger', async () => {
      const emptyPrisma = {
        escrow: { findMany: vi.fn().mockResolvedValue([]) },
        transaction: { findMany: vi.fn().mockResolvedValue([]) },
      } as any;

      const txs = await getLedgerEarningsTransactions('non-existent-user', emptyPrisma);
      expect(txs).toEqual([]);

      const report = await getEarningsReport('non-existent-user', emptyPrisma);
      expect(report.summary.totalThisYear).toBe(0);
      expect(report.summary.totalThisMonth).toBe(0);
      expect(report.summary.pendingEscrow).toBe(0);
      expect(report.monthly).toEqual([]);
    });
  });
});
