/**
 * Error logging endpoint
 * Receives error reports from frontend and stores them in database
 * Provides centralized error tracking and observability
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ErrorReport } from '@/lib/error-tracking';

/**
 * POST /api/errors/log
 * Log an error from the frontend
 */
export async function POST(request: NextRequest) {
  try {
    const errorReport: ErrorReport = await request.json();

    // Validate error report
    if (!errorReport.message || !errorReport.timestamp) {
      return NextResponse.json(
        { error: 'Invalid error report format' },
        { status: 400 },
      );
    }

    // Store error in database
    const storedError = await prisma.errorLog.create({
      data: {
        id: errorReport.id,
        level: errorReport.level,
        message: errorReport.message,
        stack: errorReport.stack,
        url: errorReport.url,
        userAgent: errorReport.userAgent,
        environment: errorReport.environment,
        userId: errorReport.context.userId,
        sessionId: errorReport.context.sessionId,
        component: errorReport.context.component,
        action: errorReport.context.action,
        metadata: errorReport.context.metadata as any,
        timestamp: new Date(errorReport.timestamp),
      },
    });

    // Log to console for immediate visibility in development
    if (process.env.NODE_ENV === 'development') {
      console.log('[ErrorLog] Stored error:', {
        id: storedError.id,
        level: storedError.level,
        message: storedError.message,
        component: storedError.component,
      });
    }

    // Alert on critical errors
    if (errorReport.level === 'error') {
      await alertCriticalError(storedError);
    }

    return NextResponse.json(
      {
        success: true,
        errorId: storedError.id,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[ErrorLog] Failed to log error:', error);
    return NextResponse.json(
      { error: 'Failed to log error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/errors/log
 * Retrieve error logs (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    // TODO: Add authentication check for admin users
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const level = searchParams.get('level');
    const userId = searchParams.get('userId');
    const component = searchParams.get('component');

    // Build filter
    const where: any = {};
    if (level) where.level = level;
    if (userId) where.userId = userId;
    if (component) where.component = component;

    const [errors, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.errorLog.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: errors,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('[ErrorLog] Failed to retrieve errors:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve errors' },
      { status: 500 },
    );
  }
}

/**
 * Alert on critical errors
 * Can be extended to send notifications, emails, etc.
 */
async function alertCriticalError(error: any): Promise<void> {
  try {
    // TODO: Implement alerting mechanism
    // - Send email to admin
    // - Send Slack notification
    // - Create incident in monitoring system
    console.warn('[ErrorAlert] Critical error detected:', {
      id: error.id,
      message: error.message,
      component: error.component,
      userId: error.userId,
    });
  } catch (error) {
    console.error('[ErrorAlert] Failed to alert critical error:', error);
  }
}
