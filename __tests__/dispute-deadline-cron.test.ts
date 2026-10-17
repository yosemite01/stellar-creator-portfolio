import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as disputeDeadlinesCron } from '@/app/api/admin/cron/dispute-deadlines/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dispute: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';

describe('Dispute deadline cron & auto-resolution (Issue #1577)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret-12345';
  });

  it('rejects requests with invalid or missing cron secret', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/admin/cron/dispute-deadlines', {
      method: 'POST',
      headers: { 'x-cron-secret': 'wrong-secret' },
    });

    const res = await disputeDeadlinesCron(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain('Unauthorized');
  });

  it('allows authorized cron invocation and auto-resolves expired disputes', async () => {
    const expiredDispute = {
      id: 'disp-1',
      escrowId: 'escrow-100',
      creatorId: 'creator-1',
      clientId: 'client-1',
      status: 'open',
      deadline: new Date(Date.now() - 3600000), // 1 hour ago
    };

    vi.mocked(prisma.dispute.findMany).mockResolvedValueOnce([expiredDispute as any]);
    vi.mocked(prisma.dispute.update).mockResolvedValueOnce({
      ...expiredDispute,
      status: 'resolved',
      reason: 'deadline_expired_auto_resolved',
    } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({ id: 'log-1' } as any);

    const req = new NextRequest('http://localhost:3000/api/admin/cron/dispute-deadlines', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-cron-secret-12345' },
    });

    const res = await disputeDeadlinesCron(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.resolvedCount).toBe(1);
    expect(data.resolvedIds).toEqual(['disp-1']);

    expect(prisma.dispute.update).toHaveBeenCalledWith({
      where: { id: 'disp-1' },
      data: {
        status: 'resolved',
        reason: 'deadline_expired_auto_resolved',
      },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resource: 'dispute',
        action: 'resolve.auto_deadline_expired',
        resourceId: 'disp-1',
        status: 'SUCCESS',
      }),
    });
  });

  it('does nothing when no disputes have expired deadlines', async () => {
    vi.mocked(prisma.dispute.findMany).mockResolvedValueOnce([]);

    const req = new NextRequest('http://localhost:3000/api/admin/cron/dispute-deadlines', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-cron-secret-12345' },
    });

    const res = await disputeDeadlinesCron(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.resolvedCount).toBe(0);
    expect(prisma.dispute.update).not.toHaveBeenCalled();
  });
});
