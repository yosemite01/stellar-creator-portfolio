import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH, DELETE } from '../route';

// Mock the auth module
vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock the prisma module
vi.mock('@/lib/prisma', () => ({
  prisma: {
    inAppNotification: {
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

const mockSession = {
  user: { id: 'user-123', email: 'test@test.com', name: 'Test User' },
};

const mockNotifications = [
  {
    id: 'notif-1',
    title: 'New application',
    body: 'You have a new application',
    read: false,
    applicationId: 'app-1',
    bountyId: 'bounty-1',
    createdAt: new Date('2026-09-24T10:00:00Z'),
  },
  {
    id: 'notif-2',
    title: 'Bounty completed',
    body: 'Your bounty has been completed',
    read: true,
    applicationId: null,
    bountyId: 'bounty-2',
    createdAt: new Date('2026-09-23T10:00:00Z'),
  },
];

describe('GET /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(prisma.inAppNotification.findMany).mockResolvedValue(mockNotifications);
    vi.mocked(prisma.inAppNotification.count).mockResolvedValue(2);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as any);
    const request = new Request('http://localhost/api/notifications');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('returns notifications for authenticated user', async () => {
    const request = new Request('http://localhost/api/notifications');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.notifications).toHaveLength(2);
    expect(data.total).toBe(2);
    expect(data.notifications[0].id).toBe('notif-1');
    expect(data.notifications[0].createdAt).toBe('2026-09-24T10:00:00.000Z');
  });

  it('passes limit and offset to prisma query', async () => {
    const request = new Request('http://localhost/api/notifications?limit=10&offset=20');
    await GET(request);

    expect(prisma.inAppNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 }),
    );
  });

  it('caps limit at 100', async () => {
    const request = new Request('http://localhost/api/notifications?limit=500');
    await GET(request);

    expect(prisma.inAppNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it('filters unread notifications', async () => {
    const request = new Request('http://localhost/api/notifications?filter=unread');
    await GET(request);

    expect(prisma.inAppNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-123', read: false } }),
    );
  });

  it('filters read notifications', async () => {
    const request = new Request('http://localhost/api/notifications?filter=read');
    await GET(request);

    expect(prisma.inAppNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-123', read: true } }),
    );
  });

  it('returns unread count', async () => {
    vi.mocked(prisma.inAppNotification.count)
      .mockResolvedValueOnce(2)  // total
      .mockResolvedValueOnce(1); // unread

    const request = new Request('http://localhost/api/notifications');
    const response = await GET(request);
    const data = await response.json();

    expect(data.unreadCount).toBe(1);
  });

  it('returns hasMore flag', async () => {
    vi.mocked(prisma.inAppNotification.findMany).mockResolvedValue([mockNotifications[0]]);
    vi.mocked(prisma.inAppNotification.count).mockResolvedValue(10);

    const request = new Request('http://localhost/api/notifications?limit=1&offset=0');
    const response = await GET(request);
    const data = await response.json();

    expect(data.hasMore).toBe(true);
  });
});

describe('PATCH /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
    vi.mocked(prisma.inAppNotification.updateMany).mockResolvedValue({ count: 5 } as any);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as any);
    const request = new Request('http://localhost/api/notifications', { method: 'PATCH' });
    const response = await PATCH(request);
    expect(response.status).toBe(401);
  });

  it('marks all notifications as read', async () => {
    const request = new Request('http://localhost/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ markAll: true }),
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.updated).toBe(5);
    expect(prisma.inAppNotification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-123', read: false },
        data: { read: true },
      }),
    );
  });

  it('marks specific notifications as read', async () => {
    const request = new Request('http://localhost/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ notificationIds: ['notif-1', 'notif-2'] }),
    });
    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.updated).toBe(5);
    expect(prisma.inAppNotification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['notif-1', 'notif-2'] }, userId: 'user-123' },
      }),
    );
  });

  it('returns 400 when no valid body provided', async () => {
    const request = new Request('http://localhost/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 for empty notificationIds array', async () => {
    const request = new Request('http://localhost/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ notificationIds: [] }),
    });
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(mockSession as any);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as any);
    const request = new Request('http://localhost/api/notifications', { method: 'DELETE' });
    const response = await DELETE(request);
    expect(response.status).toBe(401);
  });

  it('deletes a notification', async () => {
    vi.mocked(prisma.inAppNotification.deleteMany).mockResolvedValue({ count: 1 } as any);

    const request = new Request('http://localhost/api/notifications', {
      method: 'DELETE',
      body: JSON.stringify({ notificationId: 'notif-1' }),
    });
    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.deleted).toBe(1);
    expect(prisma.inAppNotification.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notif-1', userId: 'user-123' },
      }),
    );
  });

  it('returns 404 when notification not found', async () => {
    vi.mocked(prisma.inAppNotification.deleteMany).mockResolvedValue({ count: 0 } as any);

    const request = new Request('http://localhost/api/notifications', {
      method: 'DELETE',
      body: JSON.stringify({ notificationId: 'nonexistent' }),
    });
    const response = await DELETE(request);
    expect(response.status).toBe(404);
  });

  it('returns 400 when notificationId is missing', async () => {
    const request = new Request('http://localhost/api/notifications', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const response = await DELETE(request);
    expect(response.status).toBe(400);
  });
});
