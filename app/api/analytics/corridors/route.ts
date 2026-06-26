import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type PeriodParam = '1d' | '7d' | '30d' | '90d';

interface CorridorData {
  from: string;
  to: string;
  volume: number;
  transactions: number;
}

/**
 * GET /api/analytics/corridors?period=30d
 *
 * Returns Stellar cross-border payment corridor analytics.
 * Aggregates PathPaymentStrictSend and PathPaymentStrictReceive operations
 * grouped by source and destination currencies.
 *
 * Query params:
 *   period – 1d | 7d | 30d | 90d (default: 30d)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const period = (searchParams.get('period') || '30d') as PeriodParam;

    // Validate period parameter
    const validPeriods = new Set(['1d', '7d', '30d', '90d']);
    if (!validPeriods.has(period)) {
      return NextResponse.json(
        { error: `Invalid period. Must be one of: ${[...validPeriods].join(', ')}` },
        { status: 400 }
      );
    }

    // Calculate date range based on period
    const now = new Date();
    const daysMap: Record<PeriodParam, number> = {
      '1d': 1,
      '7d': 7,
      '30d': 30,
      '90d': 90,
    };
    const days = daysMap[period];
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Query corridor payments for the period, grouped by currency pair
    const corridorData = await prisma.corridorPayment.groupBy({
      by: ['sourceCurrency', 'destCurrency'],
      where: {
        periodBucket: {
          gte: startDate,
          lte: now,
        },
      },
      _sum: {
        volume: true,
        transactionCount: true,
      },
      orderBy: {
        _sum: {
          volume: 'desc',
        },
      },
    });

    // Format response
    const corridors: CorridorData[] = corridorData.map((row) => ({
      from: row.sourceCurrency,
      to: row.destCurrency,
      volume: Number(row._sum.volume || 0),
      transactions: row._sum.transactionCount || 0,
    }));

    return NextResponse.json({
      period,
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      corridors,
    });
  } catch (error) {
    console.error('Error fetching corridor analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch corridor analytics' },
      { status: 500 }
    );
  }
}
