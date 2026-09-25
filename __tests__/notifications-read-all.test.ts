import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    inAppNotification: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

import { PATCH } from '@/app/api/notifications/read-all/route';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/db';

const mockGetSession = getServerSession as ReturnType<typeof vi.fn>;
const mockUpdateMany = prisma.inAppNotification.updateMany as ReturnType<typeof vi.fn>;

describe('PATCH /api/notifications/read-all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 if no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await PATCH();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('should bulk update all unread notifications', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockUpdateMany.mockResolvedValue({ count: 15 });

    const response = await PATCH();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.updatedCount).toBe(15);
    expect(body.readAt).toBeDefined();
  });

  it('should scope bulk update to session user', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-42' } });
    mockUpdateMany.mockResolvedValue({ count: 5 });

    await PATCH();

    const callArgs = mockUpdateMany.mock.calls[0][0];
    expect(callArgs.where.userId).toBe('user-42');
    expect(callArgs.where.read).toBe(false);
    expect(callArgs.data.read).toBe(true);
  });

  it('should handle zero unread notifications', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const response = await PATCH();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updatedCount).toBe(0);
  });
});
