import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    verificationToken: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(async (tasks) => Promise.all(tasks)),
  },
}));

import { prisma } from '@/lib/prisma';

describe('GET /api/auth/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects with error=missing_token when token param is absent', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/verify-email');
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login?error=missing_token');
  });

  it('redirects with error=invalid_token when token does not exist in db', async () => {
    (prisma.verificationToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/auth/verify-email?token=bad-token');
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login?error=invalid_token');
  });

  it('redirects with error=invalid_token when token has expired', async () => {
    (prisma.verificationToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      expires: new Date(Date.now() - 3600_000), // expired 1h ago
    });
    const req = new NextRequest('http://localhost:3000/api/auth/verify-email?token=expired-token');
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/auth/login?error=invalid_token');
  });

  it('verifies email and redirects to onboarding on valid unexpired token', async () => {
    (prisma.verificationToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      expires: new Date(Date.now() + 3600_000),
      user: { id: 'user-1' },
    });

    const req = new NextRequest('http://localhost:3000/api/auth/verify-email?token=valid-token');
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/onboarding?verified=1');
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
