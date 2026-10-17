import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/payments/stripe', () => ({
  getStripe: vi.fn(),
  isStripeConfigured: vi.fn(() => false),
}));

import { getServerSession } from 'next-auth';

describe('GET /api/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401s when there is no authenticated session', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns escrows for authenticated user', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'client-user-1', role: 'CLIENT' },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.escrows)).toBe(true);
    expect(data.stripeConfigured).toBe(false);
  });
});

describe('POST /api/payments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'client-user-1', role: 'CLIENT' },
    });
  });

  it('401s when there is no authenticated session', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-1' },
      body: JSON.stringify({ type: 'bounty_escrow' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('400s when Idempotency-Key header is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/payments', {
      method: 'POST',
      body: JSON.stringify({ type: 'bounty_escrow' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Idempotency-Key');
  });

  it('400s when request body is invalid JSON', async () => {
    const req = new NextRequest('http://localhost:3000/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-2' },
      body: 'invalid-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400s when schema validation fails', async () => {
    const req = new NextRequest('http://localhost:3000/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-3' },
      body: JSON.stringify({ type: 'invalid_type' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('403s when user has insufficient role for bounty_escrow', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'creator-user-1', role: 'CREATOR' },
    });
    const req = new NextRequest('http://localhost:3000/api/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-4' },
      body: JSON.stringify({
        type: 'bounty_escrow',
        bountyId: 'b-1',
        amountCents: 5000,
        currency: 'usd',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
