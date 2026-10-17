import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dispute: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('GET /api/admin/disputes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403s when unauthenticated or non-admin', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/admin/disputes');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('403s when user role is not ADMIN', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'CREATOR' },
    });
    const req = new NextRequest('http://localhost:3000/api/admin/disputes');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('returns list of disputes for admin', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (prisma.dispute.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'disp-1', status: 'open', escrowId: 'esc-1' },
    ]);
    (prisma.dispute.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const req = new NextRequest('http://localhost:3000/api/admin/disputes?status=open');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.disputes).toHaveLength(1);
    expect(data.total).toBe(1);
  });
});
