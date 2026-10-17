import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '../route';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/utils/stellar-address', () => ({
  isValidStellarAddress: vi.fn((addr) => typeof addr === 'string' && addr.startsWith('G') && addr.length === 56),
}));

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';

describe('PATCH /api/user/wallet-address', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401s when there is no authenticated session', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/user/wallet-address', {
      method: 'PATCH',
      body: JSON.stringify({ walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it('422s when walletAddress is missing or invalid', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1' },
    });
    const req = new NextRequest('http://localhost:3000/api/user/wallet-address', {
      method: 'PATCH',
      body: JSON.stringify({ walletAddress: 'invalid-address' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(422);
  });

  it('409s when address is already claimed by another user', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1' },
    });
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'u2' });

    const req = new NextRequest('http://localhost:3000/api/user/wallet-address', {
      method: 'PATCH',
      body: JSON.stringify({ walletAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(409);
  });

  it('updates walletAddress successfully on valid request', async () => {
    const validAddr = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1' },
    });
    (prisma.user.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({ walletAddress: validAddr });

    const req = new NextRequest('http://localhost:3000/api/user/wallet-address', {
      method: 'PATCH',
      body: JSON.stringify({ walletAddress: validAddr }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.walletAddress).toBe(validAddr);
  });
});
