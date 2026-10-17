import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dispute: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('POST /api/admin/disputes/[id]/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403s when unauthenticated or non-admin', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/admin/disputes/disp-1/resolve', {
      method: 'POST',
      body: JSON.stringify({ resolution: 'release_to_freelancer' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'disp-1' }) });
    expect(res.status).toBe(403);
  });

  it('400s when resolution value is invalid', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    const req = new NextRequest('http://localhost:3000/api/admin/disputes/disp-1/resolve', {
      method: 'POST',
      body: JSON.stringify({ resolution: 'invalid_resolution' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'disp-1' }) });
    expect(res.status).toBe(400);
  });

  it('404s when dispute does not exist', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (prisma.dispute.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/admin/disputes/missing-id/resolve', {
      method: 'POST',
      body: JSON.stringify({ resolution: 'release_to_freelancer' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'missing-id' }) });
    expect(res.status).toBe(404);
  });

  it('409s when dispute is already resolved', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (prisma.dispute.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'disp-1',
      status: 'resolved',
      escrowId: 'esc-1',
    });
    const req = new NextRequest('http://localhost:3000/api/admin/disputes/disp-1/resolve', {
      method: 'POST',
      body: JSON.stringify({ resolution: 'release_to_freelancer' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'disp-1' }) });
    expect(res.status).toBe(409);
  });

  it('resolves dispute and writes audit log on valid open dispute', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (prisma.dispute.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'disp-1',
      status: 'open',
      escrowId: 'esc-1',
    });
    (prisma.dispute.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'disp-1', status: 'resolved' });
    (prisma.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'audit-1' });

    const req = new NextRequest('http://localhost:3000/api/admin/disputes/disp-1/resolve', {
      method: 'POST',
      body: JSON.stringify({ resolution: 'release_to_freelancer', note: 'Milestone verified' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'disp-1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(prisma.dispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'disp-1' },
        data: expect.objectContaining({ status: 'resolved' }),
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
