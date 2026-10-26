import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

const BOUNTY_ID = 'clh3k2q0a0000abcdefghijk';
const OWNER_ID = 'clh3k2q0a0001abcdefghijk';
const OTHER_ID = 'clh3k2q0a0002abcdefghijk';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bounty: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/match-creators', () => ({
  TOP_MATCHES: 10,
  getSuggestedCreators: vi.fn(async () => [{ userId: 'creator-1', score: 90 }]),
  matchCreatorsForBounty: vi.fn(async () => [{ userId: 'creator-1', score: 90 }]),
}));

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { getSuggestedCreators, matchCreatorsForBounty } from '@/lib/match-creators';

function asSession(user: { id: string; role: string } | null) {
  (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(user ? { user } : null);
}

describe('/api/bounties/[id]/suggested-creators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: BOUNTY_ID,
      creatorId: OWNER_ID,
    });
  });

  it('returns 401 for an anonymous caller', async () => {
    asSession(null);
    const req = new NextRequest(`http://localhost:3000/api/bounties/${BOUNTY_ID}/suggested-creators`);
    const res = await GET(req, { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(401);
    expect(getSuggestedCreators).not.toHaveBeenCalled();
  });

  it('returns 403 for a signed-in user who does not own the bounty', async () => {
    asSession({ id: OTHER_ID, role: 'CLIENT' });
    const req = new NextRequest(`http://localhost:3000/api/bounties/${BOUNTY_ID}/suggested-creators`);
    const res = await GET(req, { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(403);
    expect(getSuggestedCreators).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed bounty id', async () => {
    asSession({ id: OWNER_ID, role: 'CLIENT' });
    const req = new NextRequest('http://localhost:3000/api/bounties/not-a-cuid/suggested-creators');
    const res = await GET(req, { params: Promise.resolve({ id: 'not-a-cuid' }) });
    expect(res.status).toBe(400);
    expect(prisma.bounty.findUnique).not.toHaveBeenCalled();
  });

  it('returns 200 for the bounty owner', async () => {
    asSession({ id: OWNER_ID, role: 'CLIENT' });
    const req = new NextRequest(`http://localhost:3000/api/bounties/${BOUNTY_ID}/suggested-creators`);
    const res = await GET(req, { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bountyId).toBe(BOUNTY_ID);
    expect(body.count).toBe(1);
    expect(getSuggestedCreators).toHaveBeenCalledWith(BOUNTY_ID, 10);
  });

  it('returns 200 for an admin who is not the owner', async () => {
    asSession({ id: OTHER_ID, role: 'ADMIN' });
    const req = new NextRequest(`http://localhost:3000/api/bounties/${BOUNTY_ID}/suggested-creators`);
    const res = await GET(req, { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(200);
  });

  it('returns 403 on POST from a non-owner and does not notify creators', async () => {
    asSession({ id: OTHER_ID, role: 'CLIENT' });
    const req = new NextRequest(`http://localhost:3000/api/bounties/${BOUNTY_ID}/suggested-creators`, {
      method: 'POST',
    });
    const res = await POST(req, { params: Promise.resolve({ id: BOUNTY_ID }) });
    expect(res.status).toBe(403);
    expect(matchCreatorsForBounty).not.toHaveBeenCalled();
  });
});
