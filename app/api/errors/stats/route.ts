/**
 * Error statistics endpoint
 * Provides aggregated error metrics and analytics
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/errors/stats
 * Get error statistics and metrics
 */
export async function GET(request: NextRequest) {
  try {
    // TODO: Add authentication check for admin users
    const searchParams = request.nextUrl.searchParams;
    const hours = parseInt(searchParams.get('hours') || '24');
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get error counts by level
    const errorsByLevel = await prisma.errorLog.groupBy({
      by: ['level'],
      where: { timestamp: { gte: since } },
      _count: true,
    });

    // Get top errors
    const topErrors = await prisma.errorLog.groupBy({
      by: ['message'],
      where: { timestamp: { gte: since } },
      _count: true,
      orderBy: { _count: { message: 'desc' } },
      take: 10,
    });

    // Get errors by component
    const errorsByComponent = await prisma.errorLog.groupBy({
      by: ['component'],
      where: { timestamp: { gte: since }, component: { not: null } },
      _count: true,
      orderBy: { _count: { component: 'desc' } },
      take: 10,
    });

    // Get affected users
    const affectedUsers = await prisma.errorLog.groupBy({
      by: ['userId'],
      where: { timestamp: { gte: since }, userId: { not: null } },
      _count: true,
      orderBy: { _count: { userId: 'desc' } },
      take: 10,
    });

    // Get total error count
    const totalErrors = await prisma.errorLog.count({
      where: { timestamp: { gte: since } },
    });

    return NextResponse.json({
      success: true,
      timeRange: {
        since: since.toISOString(),
        until: new Date().toISOString(),
        hours,
      },
      summary: {
        totalErrors,
        errorsByLevel: Object.fromEntries(
          errorsByLevel.map((e) => [e.level, e._count]),
        ),
      },
      topErrors: topErrors.map((e) => ({
        message: e.message,
        count: e._count,
      })),
      errorsByComponent: errorsByComponent.map((e) => ({
        component: e.component,
        count: e._count,
      })),
      affectedUsers: affectedUsers.map((e) => ({
        userId: e.userId,
        errorCount: e._count,
      })),
    });
  } catch (error) {
    console.error('[ErrorStats] Failed to retrieve stats:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve error statistics' },
      { status: 500 },
    );
  }
}
