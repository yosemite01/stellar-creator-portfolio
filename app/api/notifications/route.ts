import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

// Force dynamic rendering — this route always depends on the user session
export const dynamic = 'force-dynamic';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  read: boolean;
  applicationId: string | null;
  bountyId: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  total: number;
  unreadCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * GET /api/notifications
 *
 * Fetches in-app notifications for the authenticated user.
 *
 * Query params:
 *   - limit:  number of results per page (default 20, max 100)
 *   - offset: pagination offset (default 0)
 *   - filter: 'all' | 'unread' | 'read' (default 'all')
 */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);
  const filter = searchParams.get('filter') ?? 'all';

  // Build the where clause based on filter
  const where: { userId: string; read?: boolean } = {
    userId: session.user.id,
  };

  if (filter === 'unread') {
    where.read = false;
  } else if (filter === 'read') {
    where.read = true;
  }

  // Query notifications and total count in parallel
  const [notifications, total, unreadCount] = await Promise.all([
    prisma.inAppNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        title: true,
        body: true,
        read: true,
        applicationId: true,
        bountyId: true,
        createdAt: true,
      },
    }),
    prisma.inAppNotification.count({ where }),
    prisma.inAppNotification.count({
      where: { userId: session.user.id, read: false },
    }),
  ]);

  const response: NotificationsResponse = {
    notifications: notifications.map((n) => ({
      ...n,
      createdAt: n.createdAt.toISOString(),
    })),
    total,
    unreadCount,
    limit,
    offset,
    hasMore: offset + notifications.length < total,
  };

  return NextResponse.json(response);
}

/**
 * PATCH /api/notifications
 *
 * Mark notifications as read.
 *
 * Body:
 *   - notificationIds: string[] (specific IDs to mark as read)
 *   - markAll: boolean (mark all unread as read)
 */
export async function PATCH(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { notificationIds?: string[]; markAll?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.markAll) {
    // Mark all unread notifications as read
    const result = await prisma.inAppNotification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    });
    return NextResponse.json({ updated: result.count });
  }

  if (body.notificationIds && Array.isArray(body.notificationIds)) {
    if (body.notificationIds.length === 0) {
      return NextResponse.json({ error: 'notificationIds cannot be empty' }, { status: 400 });
    }

    // Mark specific notifications as read (scoped to the user)
    const result = await prisma.inAppNotification.updateMany({
      where: {
        id: { in: body.notificationIds },
        userId: session.user.id,
      },
      data: { read: true },
    });
    return NextResponse.json({ updated: result.count });
  }

  return NextResponse.json(
    { error: 'Either notificationIds or markAll must be provided' },
    { status: 400 },
  );
}

/**
 * DELETE /api/notifications
 *
 * Delete a notification (scoped to the authenticated user).
 *
 * Body:
 *   - notificationId: string (single notification to delete)
 */
export async function DELETE(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { notificationId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.notificationId) {
    return NextResponse.json({ error: 'notificationId is required' }, { status: 400 });
  }

  // Delete scoped to the user — prevents IDOR
  const result = await prisma.inAppNotification.deleteMany({
    where: {
      id: body.notificationId,
      userId: session.user.id,
    },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
  }

  return NextResponse.json({ deleted: result.count });
}
