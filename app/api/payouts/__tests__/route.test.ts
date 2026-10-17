import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from '@/lib/auth/auth';

describe('GET /api/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'creator-1', name: 'Alex Rivera', role: 'CREATOR' },
    });
  });

  it('401s when there is no authenticated session', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/payouts');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns payouts list for authenticated freelancer', async () => {
    const req = new NextRequest('http://localhost:3000/api/payouts');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data.payouts)).toBe(true);
    expect(data.payouts.length).toBeGreaterThan(0);
    expect(data.payouts[0]).toHaveProperty('feeBreakdown');
    expect(data.payouts[0].feeBreakdown).toHaveProperty('platformFeeAmount');
  });

  it('filters payouts by type', async () => {
    const req = new NextRequest('http://localhost:3000/api/payouts?type=on-chain');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.payouts.every((p: any) => p.type === 'on-chain')).toBe(true);
  });
});

describe('POST /api/payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'admin-1', name: 'Admin', role: 'ADMIN' },
    });
  });

  it('401s when unauthenticated', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/payouts', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('400s when required fields are missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/payouts', {
      method: 'POST',
      body: JSON.stringify({ grossAmount: 100 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates payout record on valid input', async () => {
    const req = new NextRequest('http://localhost:3000/api/payouts', {
      method: 'POST',
      body: JSON.stringify({
        bountyId: 'bounty-123',
        bountyTitle: 'Fix issue',
        grossAmount: 1500,
        clientUserId: 'client-9',
        currency: 'USDC',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.payout.grossAmount).toBe(1500);
    expect(data.payout.feeBreakdown.platformFeeAmount).toBe(150);
  });
});
