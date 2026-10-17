import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kYCSubmission: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('@/lib/kyc-encryption', () => ({
  decryptField: vi.fn(async () => 'Decrypted Jane Doe'),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('GET /api/admin/kyc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('403s when unauthenticated or non-admin', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/admin/kyc');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('returns decrypted KYC submissions for admin', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN' },
    });
    (prisma.kYCSubmission.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'kyc-1',
        userId: 'u1',
        documentType: 'passport',
        status: 'PENDING',
        encryptedName: 'enc-name',
        user: { email: 'user@example.com' },
      },
    ]);
    (prisma.kYCSubmission.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const req = new NextRequest('http://localhost:3000/api/admin/kyc?status=pending');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.submissions).toHaveLength(1);
    expect(data.submissions[0].name).toBe('Decrypted Jane Doe');
  });
});
