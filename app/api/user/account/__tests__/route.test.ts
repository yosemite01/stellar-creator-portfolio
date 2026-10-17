import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { DELETE } from '../route';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => {
      const mockTx = {
        session: { deleteMany: vi.fn() },
        account: { deleteMany: vi.fn() },
        creatorProfile: { update: vi.fn() },
        clientProfile: { update: vi.fn() },
        user: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      };
      return cb(mockTx);
    }),
  },
}));

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

describe('DELETE /api/user/account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401s when there is no authenticated session', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/user/account', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it('404s when user record does not exist', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { email: 'nonexistent@example.com' },
    });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/user/account', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  it('anonymizes user data and executes GDPR erasure transaction', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { email: 'user@example.com' },
    });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'user-to-delete',
      email: 'user@example.com',
      creatorProfile: { id: 'cp-1' },
      clientProfile: null,
    });

    const req = new NextRequest('http://localhost:3000/api/user/account', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain('Account deleted');
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
