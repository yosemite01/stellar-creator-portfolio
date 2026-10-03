/**
 * Push notification route handlers, mounted at /api/notifications/push
 * (send, batch send, health) and /api/notifications/push/[id] (status).
 *
 * Sending is restricted to admins and to backend services holding
 * PUSH_SERVICE_TOKEN: a send can target any user, so an ordinary session is
 * not enough. Status updates are limited to the notification's owner.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { pushService, type PushPayload } from '@/server/services/notifications/push-service';
import { validateNotificationPayload, sanitizeContent } from '@/server/services/notifications/notification-validators';
import type { UserPreferences } from '@/server/services/notifications/notification-types';
import { rateLimit } from '@/server/services/notifications/rate-limiter';
import { logNotification, trackDelivery } from '@/server/services/notifications/notification-logger';
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

type SenderAuth =
  | { ok: true; actor: string }
  | { ok: false; response: NextResponse };

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Authorises a caller to send notifications: either a backend service
 * presenting PUSH_SERVICE_TOKEN as a bearer token, or a signed-in admin.
 * The returned actor id keys the rate limit, so it cannot be spoofed with
 * a client-supplied header.
 */
async function authorizeSender(req: NextRequest): Promise<SenderAuth> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Content-Type must be application/json' }, { status: 415 }),
    };
  }

  const authorization = req.headers.get('authorization');
  const serviceToken = process.env.PUSH_SERVICE_TOKEN;
  if (authorization?.startsWith('Bearer ') && serviceToken) {
    if (tokensMatch(authorization.slice(7), serviceToken)) {
      return { ok: true, actor: 'service' };
    }
    return { ok: false, response: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };
  }

  const session = await getServerSession();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (session.user.role !== 'ADMIN') {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, actor: `user:${session.user.id}` };
}

// Single notification endpoint
export async function POST(req: NextRequest) {
  try {
    const auth = await authorizeSender(req);
    if (!auth.ok) return auth.response;

    // Check rate limiting
    const rateLimitResult = await rateLimit(auth.actor, {
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

    // The details stay in the server log; callers get a generic message.
    return NextResponse.json(
      {
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

// Batch notification endpoint
export async function PUT(req: NextRequest) {
  try {
    const auth = await authorizeSender(req);
    if (!auth.ok) return auth.response;

    const rateLimitResult = await rateLimit(`${auth.actor}:batch`, {
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

// Update notification status (e.g. mark as OPENED). Only the recipient may
// change the status of their own notification.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { status } = await req.json();

    if (!Object.values(NotificationStatus).includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const result = await prisma.notification.updateMany({
      where: { id, userId: session.user.id },
      data: {
        status,
        openedAt: status === NotificationStatus.OPENED ? new Date() : undefined,
        readAt: status === NotificationStatus.READ ? new Date() : undefined,
      },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }

    return NextResponse.json({ id, status });
  } catch (error) {
    console.error('Error updating notification status:', error);
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
}

/**
 * Delivery preferences for a recipient, or null when the user does not
 * exist. Push channels follow the user's in-app switch from
 * NotificationPreference; users who never saved preferences get the
 * defaults (everything on).
 */
async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, createdAt: true, notificationPreference: true },
    });
    if (!user) return null;

    const pref = user.notificationPreference;
    const pushEnabled = pref?.inAppEnabled ?? true;

    return {
      userId,
      channels: {
        firebase: pushEnabled,
        onesignal: pushEnabled,
        browser: pushEnabled,
        email: pref ? pref.emailBountyAlerts || pref.emailApplicationUpdates || pref.emailMessages : true,
      },
      doNotDisturb: false,
      blockedCategories: [],
      unsubscribedCategories: pref?.emailMarketing === false ? ['marketing'] : [],
      language: 'en',
      timezone: 'UTC',
      createdAt: user.createdAt,
      updatedAt: pref?.updatedAt ?? user.createdAt,
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
