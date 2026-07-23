import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { toCSV } from '@/lib/export-utils';

/**
 * GET /api/admin/reports/bounties?startDate=...&endDate=...&format=csv
 *
 * Streams bounty report with columns:
 * title, budget, status, applicant_count, creator, created_at, updated_at
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
        action: 'export_bounties',
        status: 'SUCCESS',
        requestPath: req.nextUrl.pathname,
        httpMethod: 'GET',
      },
    });

    const bounties = await prisma.bounty.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        creator: {
          select: { name: true },
        },
        applications: {
          select: { id: true },
        },
      },
    });

    const reportData = bounties.map((bounty) => ({
      title: bounty.title,
      budget: bounty.budget,
      status: bounty.status,
      applicant_count: bounty.applications.length,
      creator: bounty.creator.name || 'Unknown',
      created_at: bounty.createdAt.toISOString().split('T')[0],
      updated_at: bounty.updatedAt.toISOString().split('T')[0],
    }));

    if (format === 'json') {
      return NextResponse.json({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        count: reportData.length,
        data: reportData,
      });
    }

    const headers = [
      'title',
      'budget',
      'status',
      'applicant_count',
      'creator',
      'created_at',
      'updated_at',
    ];
    const csv = toCSV(headers, reportData);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="bounties-report.csv"',
      },
    });
  } catch (error) {
    console.error('Bounties export error:', error);

    await prisma.auditLog.create({
      data: {
        resource: 'admin_export',
        action: 'export_bounties',
        status: 'FAILURE',
        errorMessage: String(error),
        requestPath: req.nextUrl.pathname,
        httpMethod: 'GET',
      },
    }).catch(() => {});

    return NextResponse.json(
      { error: 'Failed to export bounties report' },
      { status: 500 }
    );
  }
}
