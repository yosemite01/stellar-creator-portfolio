import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { toCSV } from '@/lib/export-utils';

/**
 * GET /api/admin/reports/revenue?startDate=...&endDate=...&format=csv
 *
 * Streams revenue report grouped by month with columns:
 * month, platform_fees_collected
 *
 * Requires admin role. Rate limited to 3 exports per hour.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session?.user?.id || session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin role required' },
        { status: 403 }
      );
    }

    const userId = session.user.id;

    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: 'Rate limited: Maximum 3 exports per hour' },
        { status: 429 }
      );
    }

    const { searchParams } = req.nextUrl;
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');
    const format = searchParams.get('format') || 'csv';

    const startDate = startDateStr ? new Date(startDateStr) : new Date('2000-01-01');
    const endDate = endDateStr ? new Date(endDateStr) : new Date();

    await prisma.auditLog.create({
      data: {
        userId,
        resource: 'admin_export',
        action: 'export_revenue',
        status: 'SUCCESS',
        requestPath: req.nextUrl.pathname,
        httpMethod: 'GET',
      },
    });

    // Fetch transactions in date range
    const transactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        createdAt: true,
        amount: true,
      },
    });

    // Group by month and sum fees
    const monthlyRevenue = new Map<string, number>();

    for (const tx of transactions) {
      const date = tx.createdAt;
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      // Assuming 10% platform fee
      const fee = Math.floor(tx.amount * 0.1);
      monthlyRevenue.set(monthKey, (monthlyRevenue.get(monthKey) || 0) + fee);
    }

    const reportData = Array.from(monthlyRevenue.entries())
      .sort()
      .map(([month, fees]) => ({
        month,
        platform_fees_collected: fees,
      }));

    if (format === 'json') {
      return NextResponse.json({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        count: reportData.length,
        data: reportData,
      });
    }

    const headers = ['month', 'platform_fees_collected'];
    const csv = toCSV(headers, reportData);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="revenue-report.csv"',
      },
    });
  } catch (error) {
    console.error('Revenue export error:', error);

    await prisma.auditLog.create({
      data: {
        resource: 'admin_export',
        action: 'export_revenue',
        status: 'FAILURE',
        errorMessage: String(error),
        requestPath: req.nextUrl.pathname,
        httpMethod: 'GET',
      },
    }).catch(() => {});

    return NextResponse.json(
      { error: 'Failed to export revenue report' },
      { status: 500 }
    );
  }
}
