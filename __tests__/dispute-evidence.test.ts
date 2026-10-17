import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getEvidence, POST as postEvidence } from '@/app/api/disputes/[id]/evidence/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dispute: {
      findUnique: vi.fn(),
    },
    disputeEvidence: {
      findMany: vi.fn(),
      create: vi.fn(),
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

describe('Dispute Evidence API (Issue #1577)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated users', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/disputes/disp-1/evidence');
    const res = await getEvidence(req, { params: Promise.resolve({ id: 'disp-1' }) });
    expect(res.status).toBe(401);
  });

  it('rejects non-parties from viewing dispute evidence', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'random-user', role: 'USER' },
    } as any);

    vi.mocked(prisma.dispute.findUnique).mockResolvedValueOnce({
      id: 'disp-1',
      creatorId: 'creator-1',
      clientId: 'client-1',
      status: 'open',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/disputes/disp-1/evidence');
    const res = await getEvidence(req, { params: Promise.resolve({ id: 'disp-1' }) });
    expect(res.status).toBe(403);
  });

  it('allows creator or client to upload evidence with file or message', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'creator-1', role: 'CREATOR' },
    } as any);

    vi.mocked(prisma.dispute.findUnique).mockResolvedValueOnce({
      id: 'disp-1',
      creatorId: 'creator-1',
      clientId: 'client-1',
      status: 'open',
    } as any);

    const createdEvidence = {
      id: 'ev-1',
      disputeId: 'disp-1',
      uploadedById: 'creator-1',
      fileUrl: 'https://storage.tamgora.com/evidence/contract.pdf',
      fileName: 'contract.pdf',
      fileSize: 10240,
      mimeType: 'application/pdf',
      message: 'Here is the signed milestone document',
      createdAt: new Date(),
    };

    vi.mocked(prisma.disputeEvidence.create).mockResolvedValueOnce(createdEvidence as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValueOnce({ id: 'log-1' } as any);

    const req = new NextRequest('http://localhost:3000/api/disputes/disp-1/evidence', {
      method: 'POST',
      body: JSON.stringify({
        fileUrl: 'https://storage.tamgora.com/evidence/contract.pdf',
        fileName: 'contract.pdf',
        fileSize: 10240,
        mimeType: 'application/pdf',
        message: 'Here is the signed milestone document',
      }),
    });

    const res = await postEvidence(req, { params: Promise.resolve({ id: 'disp-1' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.evidence.id).toBe('ev-1');
  });

  it('rejects evidence upload without file or message', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce({
      user: { id: 'client-1', role: 'CLIENT' },
    } as any);

    vi.mocked(prisma.dispute.findUnique).mockResolvedValueOnce({
      id: 'disp-1',
      creatorId: 'creator-1',
      clientId: 'client-1',
      status: 'open',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/disputes/disp-1/evidence', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await postEvidence(req, { params: Promise.resolve({ id: 'disp-1' }) });
    expect(res.status).toBe(400);
  });
});
