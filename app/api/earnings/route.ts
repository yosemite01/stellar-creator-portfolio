import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import {
  getEarningsReport,
  getLedgerEarningsTransactions,
} from '@/server/services/earnings-service';
import { EarningCurrency } from '@/lib/earnings-data';

export const runtime = 'nodejs';

/**
 * GET /api/earnings
 * Fetches real earnings summary, monthly aggregates, and transactions
 * derived from the on-chain / database ledger for the authenticated user.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession().catch(() => null);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const currency = (searchParams.get('currency') || 'USD') as EarningCurrency;

  const [report, transactions] = await Promise.all([
    getEarningsReport(session.user.id, prisma, currency),
    getLedgerEarningsTransactions(session.user.id, prisma),
  ]);

  return NextResponse.json({
    report,
    summary: report.summary,
    transactions,
    monthly: report.monthly,
    displayCurrency: report.displayCurrency,
  });
}
