import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getEarnings } from '../route';
import { GET as getTaxExport } from '../tax-export/route';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    escrow: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'escrow-api-1',
          creatorId: 'test-user-1',
          clientId: 'client-api',
          amount: 5000,
          status: 'released',
          createdAt: new Date('2026-03-01T10:00:00Z'),
          releasedAt: new Date('2026-03-05T12:00:00Z'),
        },
      ]),
    },
    transaction: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('@/lib/payouts/payout-service', () => ({
  listPayoutsForFreelancer: vi.fn().mockReturnValue([]),
}));

import { getServerSession } from '@/lib/auth/auth';

describe('Earnings API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'test-user-1', name: 'Test Freelancer' },
    });
  });

  describe('GET /api/earnings', () => {
    it('returns 401 when user is not authenticated', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const req = new NextRequest('http://localhost:3000/api/earnings');
      const res = await getEarnings(req);
      expect(res.status).toBe(401);
    });

    it('returns earnings report and ledger transactions for authenticated user', async () => {
      const req = new NextRequest('http://localhost:3000/api/earnings');
      const res = await getEarnings(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty('summary');
      expect(data).toHaveProperty('report');
      expect(data).toHaveProperty('transactions');
      expect(Array.isArray(data.transactions)).toBe(true);
      expect(data.transactions.length).toBeGreaterThan(0);
      expect(data.transactions[0].id).toBe('escrow-escrow-api-1');
      expect(data.transactions[0].amount).toBe(5000);
    });
  });

  describe('GET /api/earnings/tax-export', () => {
    it('returns 401 when unauthenticated', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const req = new NextRequest('http://localhost:3000/api/earnings/tax-export?year=2026&format=csv');
      const res = await getTaxExport(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 when year is invalid', async () => {
      const req = new NextRequest('http://localhost:3000/api/earnings/tax-export?year=1980&format=csv');
      const res = await getTaxExport(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid parameters');
    });

    it('exports CSV with correct content headers', async () => {
      const req = new NextRequest('http://localhost:3000/api/earnings/tax-export?year=2026&format=csv');
      const res = await getTaxExport(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      expect(res.headers.get('content-disposition')).toContain('tax-year-2026-earnings.csv');

      const text = await res.text();
      expect(text).toContain('Tax Year,Date (UTC),Transaction ID');
      expect(text).toContain('TOTAL 2026');
    });

    it('exports JSON tax year breakdown', async () => {
      const req = new NextRequest('http://localhost:3000/api/earnings/tax-export?year=2026&format=json');
      const res = await getTaxExport(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.taxYear).toBe(2026);
      expect(data.totalGrossUSD).toBe(5000);
      expect(data.platformFeesUSD).toBe(500);
      expect(data.totalNetUSD).toBe(4500);
      expect(data.transactionCount).toBe(1);
    });

    it('exports Form 1099-NEC text representation', async () => {
      const req = new NextRequest('http://localhost:3000/api/earnings/tax-export?year=2026&format=1099');
      const res = await getTaxExport(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const text = await res.text();
      expect(text).toContain('FORM 1099-NEC REPORT - TAX YEAR 2026');
      expect(text).toContain('Box 1: Nonemployee Compensation: $5000.00 USD');
    });

    it('exports VAT invoice text representation', async () => {
      const req = new NextRequest('http://localhost:3000/api/earnings/tax-export?year=2026&format=vat');
      const res = await getTaxExport(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const text = await res.text();
      expect(text).toContain('VAT SUMMARY INVOICE - TAX YEAR 2026');
    });
  });
});
