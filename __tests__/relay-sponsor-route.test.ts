/**
 * Thin-handler tests for POST /api/relay/sponsor (issue #1509).
 *
 * The fee-bump logic itself is covered in fee-bump.test.ts and the abuse controls
 * in sponsor-policy.test.ts; here we only check that the route requires a session,
 * parses input, delegates to the service, and maps errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { sponsorTransaction, getServerSession, authorizeSponsorship } = vi.hoisted(() => ({
  sponsorTransaction: vi.fn(),
  getServerSession: vi.fn(),
  authorizeSponsorship: vi.fn(),
}));
vi.mock('@/lib/payments/feeBump', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments/feeBump')>();
  return { ...actual, sponsorTransaction };
});
vi.mock('@/lib/auth/auth', () => ({ getServerSession }));
vi.mock('@/lib/payments/sponsorPolicy', () => ({ authorizeSponsorship }));

import { POST } from '@/app/api/relay/sponsor/route';
import { SponsorError } from '@/lib/payments/feeBump';

function request(body: unknown) {
  return new NextRequest('http://localhost/api/relay/sponsor', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sponsorTransaction.mockReset();
  authorizeSponsorship.mockReset();
  getServerSession.mockReset();
  getServerSession.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('POST /api/relay/sponsor', () => {
  it('returns 401 without a session and never reaches the service', async () => {
    getServerSession.mockResolvedValue(null);

    const res = await POST(request({ xdr: 'some-xdr' }));

    expect(res.status).toBe(401);
    expect(sponsorTransaction).not.toHaveBeenCalled();
  });

  it('checks the sponsorship policy for the signed-in user before signing', async () => {
    sponsorTransaction.mockImplementation(async (_xdr: string, beforeSign: (fb: unknown) => unknown) => {
      await beforeSign('fee-bump');
      return { hash: 'outer', innerHash: 'inner', ledger: 7, feeCharged: '200' };
    });

    const res = await POST(request({ xdr: 'some-xdr' }));

    expect(res.status).toBe(200);
    expect(authorizeSponsorship).toHaveBeenCalledWith('user-1', 'fee-bump');
  });

  it('returns 400 when xdr is missing', async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
    expect(sponsorTransaction).not.toHaveBeenCalled();
  });

  it('delegates to the fee-bump service and returns its result', async () => {
    const result = { hash: 'outer', innerHash: 'inner', ledger: 7, feeCharged: '200' };
    sponsorTransaction.mockResolvedValue(result);

    const res = await POST(request({ xdr: 'some-xdr' }));

    expect(sponsorTransaction).toHaveBeenCalledWith('some-xdr', expect.any(Function));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
  });

  it('maps a SponsorError to its HTTP status', async () => {
    sponsorTransaction.mockRejectedValue(new SponsorError('nope', 402));

    const res = await POST(request({ xdr: 'some-xdr' }));

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'nope' });
  });

  it('falls back to 500 for unexpected errors', async () => {
    sponsorTransaction.mockRejectedValue(new Error('boom'));

    const res = await POST(request({ xdr: 'some-xdr' }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });
});
