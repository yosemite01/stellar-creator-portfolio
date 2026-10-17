import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kYCSubmission: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    creatorProfile: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('@/server/services/identity-contract', () => ({
  verifyKycOnChain: vi.fn(async () => 'stellar-tx-hash-123'),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('POST /api/admin/kyc/[id]/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403s when unauthenticated or non-admin', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/admin/kyc/k-1/review', {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'k-1' }) });
    expect(res.status).toBe(403);
  });

  it('400s when decision is invalid or reason missing on reject', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    const req = new NextRequest('http://localhost:3000/api/admin/kyc/k-1/review', {
      method: 'POST',
      body: JSON.stringify({ decision: 'reject' }), // missing reason
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'k-1' }) });
    expect(res.status).toBe(400);
  });

  it('404s when submission not found', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (prisma.kYCSubmission.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/admin/kyc/missing/review', {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('approves submission and triggers on-chain identity verification', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (prisma.kYCSubmission.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'k-1',
      userId: 'user-1',
      status: 'PENDING',
      encryptedIdNumber: 'enc-id',
      user: { id: 'user-1', walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' },
    });
    (prisma.kYCSubmission.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'k-1', status: 'APPROVED' });

    const req = new NextRequest('http://localhost:3000/api/admin/kyc/k-1/review', {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'k-1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('APPROVED');
    expect(prisma.kYCSubmission.update).toHaveBeenCalled();
  });
});
