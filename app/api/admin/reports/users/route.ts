import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { toCSV } from '@/lib/export-utils';

/**
 * GET /api/admin/reports/users?startDate=...&endDate=...&format=csv
 *
 * Streams user report with columns:
 * username, email, role, join_date, bounty_count, total_earned
 *
 * Requires admin role. Rate limited to 3 exports per hour.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();

    // Check auth and admin role
    if (!session?.user?.id || session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized: Admin role required' },
        { status: 403 }
      );
    }

    const userId = session.user.id;

    // Check rate limit
    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: 'Rate limited: Maximum 3 exports per hour' },
        { status: 429 }
      );
    }

    // Parse date range
    const { searchParams } = req.nextUrl;
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');
    const format = searchParams.get('format') || 'csv';

    const startDate = startDateStr ? new Date(startDateStr) : new Date('2000-01-01');
    const endDate = endDateStr ? new Date(endDateStr) : new Date();

    // Log export to audit
    await prisma.auditLog.create({
      data: {
        userId,
        resource: 'admin_export',
        action: 'export_users',
        status: 'SUCCESS',
        requestPath: req.nextUrl.pathname,
        httpMethod: 'GET',
      },
    });

    // Fetch users created in date range
    const users = await prisma.user.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        bounties: {
          select: { id: true, budget: true },
        },
      },
    });

    // Transform to report format
    const reportData = users.map((user) => ({
      username: user.name || 'Unknown',
      email: user.email || '',
      role: user.role,
      join_date: user.createdAt.toISOString().split('T')[0],
      bounty_count: user.bounties.length,
      total_earned: user.bounties.reduce((sum, b) => sum + b.budget, 0),
    }));

    // Format response
    if (format === 'json') {
      return NextResponse.json({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        count: reportData.length,
        data: reportData,
      });
    }

    // CSV format
    const headers = [
      'username',
      'email',
      'role',
      'join_date',
      'bounty_count',
      'total_earned',
    ];
    const csv = toCSV(headers, reportData);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="users-report.csv"',
      },
    });
  } catch (error) {
    console.error('Users export error:', error);

    await prisma.auditLog.create({
      data: {
        resource: 'admin_export',
        action: 'export_users',
        status: 'FAILURE',
        errorMessage: String(error),
        requestPath: req.nextUrl.pathname,
        httpMethod: 'GET',
      },
    }).catch(() => {}); // Ignore audit log errors

    return NextResponse.json(
      { error: 'Failed to export users report' },
      { status: 500 }
    );
  }
}
