import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from 'next-auth';

describe('POST /api/payments/sep24', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401s when there is no authenticated session', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('400s when body is invalid JSON', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1' },
    });
    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: 'invalid-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400s when schema validation fails', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1' },
    });
    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: JSON.stringify({ invalid: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('503s when no anchor domain is configured', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'user-1' },
    });
    delete process.env.SEP24_ANCHOR_DOMAIN;

    const req = new NextRequest('http://localhost:3000/api/payments/sep24', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'deposit',
        assetCode: 'USDC',
        amount: '100',
        destinationAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain('No SEP-24 anchor is configured');
  });
});
