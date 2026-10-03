import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSession } = vi.hoisted(() => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth/auth', () => ({ getServerSession }));

import { GET, POST } from '@/app/api/referrals/route';
import { generateReferralCode } from '@/lib/services/referral-service';

const signedInAs = (id: string) => getServerSession.mockResolvedValue({ user: { id, role: 'USER' } });

function get(action: string) {
  return new NextRequest(`http://localhost/api/referrals?action=${action}`);
}

function post(body: unknown, ip = '203.0.113.20') {
  return new NextRequest('http://localhost/api/referrals', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getServerSession.mockReset();
});

describe('GET /api/referrals', () => {
  it('requires a session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await GET(get('code'))).status).toBe(401);
  });

  it('returns the same code on repeated requests', async () => {
    signedInAs('referrer-get');
    const first = await (await GET(get('code'))).json();
    const second = await (await GET(get('code'))).json();
    expect(first.code).toBeTruthy();
    expect(second.code).toBe(first.code);
  });

  it('returns stats and rejects unknown actions', async () => {
    signedInAs('referrer-stats');
    const stats = await (await GET(get('stats'))).json();
    expect(stats).toHaveProperty('totalReferrals');
    expect((await GET(get('nope'))).status).toBe(400);
  });
});

describe('POST /api/referrals', () => {
  it('records the referral for the signed-in user', async () => {
    const { code } = generateReferralCode('referrer-post');
    signedInAs('new-user-1');

    const res = await POST(post({ code, event: 'signup', referredUserId: 'someone-else' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    // A client-supplied referredUserId is ignored.
    expect(body.referral.referredUserId).toBe('new-user-1');
  });

  it('rejects self-referral, duplicates and unknown codes', async () => {
    const { code } = generateReferralCode('referrer-guards');

    signedInAs('referrer-guards');
    expect((await POST(post({ code, event: 'signup' }, '203.0.113.21'))).status).toBe(422);

    signedInAs('new-user-2');
    expect((await POST(post({ code, event: 'signup' }, '203.0.113.22'))).status).toBe(201);
    expect((await POST(post({ code, event: 'signup' }, '203.0.113.22'))).status).toBe(409);
    expect((await POST(post({ code: 'NOPE', event: 'signup' }))).status).toBe(404);
  });

  it('validates the event type', async () => {
    signedInAs('new-user-3');
    expect((await POST(post({ code: 'X', event: 'payday' }))).status).toBe(400);
  });
});
