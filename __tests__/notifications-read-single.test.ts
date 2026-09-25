import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

// Mock prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    inAppNotification: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

import { PATCH } from '@/app/api/notifications/[id]/read/route';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/db';

const mockGetSession = getServerSession as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.inAppNotification.updateMany as ReturnType<typeof vi.fn>;
const mockFindUnique = prisma.inAppNotification.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.inAppNotification.findFirst as ReturnType<typeof vi.fn>;

describe('PATCH /api/notifications/[id]/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 if no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await PATCH(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'notif-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('should mark notification as read', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: 'notif-1',
      title: 'Test',
      body: 'Body',
      read: true,
      applicationId: null,
      bountyId: null,
      createdAt: new Date(),
    });

    const response = await PATCH(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'notif-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('notif-1');
    expect(body.status).toBe('read');
    expect(body.notification.read).toBe(true);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', userId: 'user-1', read: false },
      data: { read: true },
    });
  });

  it('should return 404 if notification not found', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindFirst.mockResolvedValue(null);

    const response = await PATCH(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'nonexistent' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Notification not found');
  });

  it('should handle already-read notification gracefully', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockUpdateMany.mockResolvedValue({ count: 0 });
    mockFindFirst.mockResolvedValue({ id: 'notif-1', read: true });

    const response = await PATCH(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'notif-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alreadyRead).toBe(true);
  });

  it('should scope update to the session user (IDOR protection)', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: 'notif-1',
      title: 'Test',
      body: 'Body',
      read: true,
      applicationId: null,
      bountyId: null,
      createdAt: new Date(),
    });

    await PATCH(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'notif-1' }),
    });

    // Verify userId is in the where clause
    const callArgs = mockUpdateMany.mock.calls[0][0];
    expect(callArgs.where.userId).toBe('user-1');
  });
});
