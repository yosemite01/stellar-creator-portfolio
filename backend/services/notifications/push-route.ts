/**
 * POST /api/notifications/push
 * Send push notifications with validation and error handling
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushService, type PushPayload } from './push-service';
import { validateNotificationPayload, sanitizeContent } from './notification-validators';
import type { UserPreferences } from './notification-types';
import { rateLimit } from './rate-limiter';
import { logNotification, trackDelivery } from './notification-logger';
import { prisma } from '@/lib/prisma';
import { NotificationStatus } from '@prisma/client';

interface SendNotificationRequest {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  channels?: Array<'firebase' | 'onesignal' | 'browser'>;
  priority?: 'high' | 'normal' | 'low';
  type?: string;
  templateId?: string;
  variables?: Record<string, string>;
}

interface BatchNotificationRequest {
  notifications: SendNotificationRequest[];
  dryRun?: boolean;
}

// Validation middleware
async function validateRequest(req: NextRequest): Promise<void> {
  const contentType = req.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    throw new Error('Content-Type must be application/json');
  }

  // Verify API key or JWT
  const auth = req.headers.get('authorization');
  if (!auth) {
    throw new Error('Missing authorization header');
  }

  if (!auth.startsWith('Bearer ')) {
    throw new Error('Invalid authorization format');
  }

  // Verify token (implement with your auth provider)
  // const token = auth.substring(7);
  // await verifyToken(token);
}

// Single notification endpoint
export async function POST(req: NextRequest) {
  try {
    // Validate request format
    await validateRequest(req);

    // Check rate limiting
    const clientId = req.headers.get('x-client-id') || 'anonymous';
    const rateLimitResult = await rateLimit(clientId, {
      limit: 100,
      window: 3600, // 1 hour
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          retryAfter: rateLimitResult.resetIn,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.resetIn),
          },
        },
      );
    }

    const body: SendNotificationRequest = await req.json();

    // Validate payload structure
    const validation = validateNotificationPayload(body);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Invalid payload',
          details: validation.errors,
        },
        { status: 400 },
      );
    }

    // Sanitize content to prevent injection attacks
    const sanitized = {
      userId: body.userId.trim(),
      title: sanitizeContent(body.title),
      body: sanitizeContent(body.body),
      data: body.data ? Object.fromEntries(
        Object.entries(body.data).map(([k, v]) => [k, sanitizeContent(v)])
      ) : {},
      channels: body.channels || ['firebase', 'onesignal', 'browser'],
      priority: body.priority || 'normal',
    };

    // Get user preferences
    const preferences = await getUserPreferences(sanitized.userId);

    if (!preferences) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 },
      );
    }

    // Check if user has opted out of notifications
    if (!preferences.channels['firebase'] &&
        !preferences.channels['onesignal'] &&
        !preferences.channels['browser']) {
      return NextResponse.json(
        {
          success: false,
          messageId: '',
          reason: 'User has disabled all notification channels',
        },
        { status: 200 },
      );
    }

    // Create payload
    const payload: PushPayload = {
      userId: sanitized.userId,
      title: sanitized.title,
      body: sanitized.body,
      data: sanitized.data,
      channels: sanitized.channels,
      priority: sanitized.priority,
    };

    // Send notification
    const response = await pushService.sendNotification(payload, preferences);

    // Log notification for audit trail
    await logNotification({
      userId: sanitized.userId,
      messageId: response.messageId,
      channels: response.channels,
      timestamp: response.timestamp,
      status: response.success ? 'sent' : 'failed',
      title: sanitized.title,
      body: sanitized.body,
      type: body.type || 'info',
    });

    // Track delivery metrics
    await trackDelivery(response.messageId, response.success ? 'sent' : 'failed');

    return NextResponse.json(
      {
        success: response.success,
        messageId: response.messageId,
        channels: response.channels,
        timestamp: response.timestamp,
      },
      {
        status: response.success ? 200 : 207,
        headers: {
          'X-Message-ID': response.messageId,
          'X-Rate-Limit-Remaining': String(rateLimitResult.remaining),
        },
      },
    );
  } catch (error) {
    console.error('Push notification error:', error);

    const message = error instanceof Error ? error.message : 'Internal server error';

    return NextResponse.json(
      {
        error: message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

// Batch notification endpoint
export async function PUT(req: NextRequest) {
  try {
    await validateRequest(req);

    const clientId = req.headers.get('x-client-id') || 'anonymous';
    const rateLimitResult = await rateLimit(clientId, {
      limit: 1000,
      window: 3600,
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.resetIn),
          },
        },
      );
    }

    const body: BatchNotificationRequest = await req.json();

    if (!Array.isArray(body.notifications) || body.notifications.length === 0) {
      return NextResponse.json(
        { error: 'Notifications must be a non-empty array' },
        { status: 400 },
      );
    }

    if (body.notifications.length > 10000) {
      return NextResponse.json(
        { error: 'Maximum 10000 notifications per batch' },
        { status: 400 },
      );
    }

    // Prepare batch items
    const batchItems = await Promise.all(
      body.notifications.map(async (notif) => {
        const validation = validateNotificationPayload(notif);
        if (!validation.valid) {
          return { success: false, error: validation.errors[0] };
        }

        const preferences = await getUserPreferences(notif.userId);
        if (!preferences) {
          return { success: false, error: 'User not found' };
        }

        return {
          payload: {
            userId: notif.userId,
            title: sanitizeContent(notif.title),
            body: sanitizeContent(notif.body),
            data: notif.data || {},
            channels: notif.channels || ['firebase', 'onesignal', 'browser'],
            priority: notif.priority || 'normal',
          },
          preferences,
        };
      }),
    );

    // Check if dry-run
    if (body.dryRun) {
      return NextResponse.json(
        {
          dryRun: true,
          items: batchItems,
          count: batchItems.length,
        },
        { status: 200 },
      );
    }

    // Send batch
    const results = await pushService.sendBatch(
      batchItems.filter((item) => !('error' in item)) as any
    );

    // Log batch delivery
    await logNotification({
      userId: 'batch',
      messageId: `batch_${Date.now()}`,
      channels: {},
      timestamp: new Date(),
      status: 'batch',
      count: batchItems.length,
    });

    return NextResponse.json(
      {
        success: true,
        total: body.notifications.length,
        delivered: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('Batch notification error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 },
    );
  }
}

// Update notification status (e.g. mark as OPENED)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { status } = await req.json();

    if (!Object.values(NotificationStatus).includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: {
        status,
        openedAt: status === NotificationStatus.OPENED ? new Date() : undefined,
        readAt: status === NotificationStatus.READ ? new Date() : undefined,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating notification status:', error);
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
}

// Helper functions

async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  try {
    // Fetch from database
    // const user = await db.users.findById(userId);
    // if (!user) return null;
    //
    // return user.notificationPreferences;

    // Placeholder implementation
    return {
      userId,
      channels: {
        firebase: true,
        onesignal: true,
        browser: true,
        email: true,
      },
      doNotDisturb: false,
      blockedCategories: [],
      unsubscribedCategories: [],
      language: 'en',
      timezone: 'UTC',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return null;
  }
}

// Health check endpoint
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const action = searchParams.get('action');

  if (action === 'health') {
    return NextResponse.json(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        providers: {
          firebase: 'operational',
          onesignal: 'operational',
          browser: 'operational',
        },
      },
      { status: 200 },
    );
  }

  if (action === 'stats') {
    return NextResponse.json(
      {
        queueSize: 0,
        processedToday: 0,
        failedToday: 0,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    { error: 'Unknown action' },
    { status: 400 },
  );
}
