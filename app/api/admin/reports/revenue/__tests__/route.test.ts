import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => true),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { create: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

import { getServerSession } from '@/lib/auth/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';

describe('GET /api/admin/reports/revenue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403s when unauthenticated or non-admin', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/admin/reports/revenue');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('403s when user role is not ADMIN', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'CLIENT' },
    });
    const req = new NextRequest('http://localhost:3000/api/admin/reports/revenue');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('429s when rate limit check fails', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (checkRateLimit as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const req = new NextRequest('http://localhost:3000/api/admin/reports/revenue');
    const res = await GET(req);
    expect(res.status).toBe(429);
  });

  it('generates report for admin when rate limit passes', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (checkRateLimit as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (prisma.transaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/admin/reports/revenue?format=csv');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
