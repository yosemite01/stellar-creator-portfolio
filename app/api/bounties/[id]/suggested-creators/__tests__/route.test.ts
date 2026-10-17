import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';

vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bounty: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/match-creators', () => ({
  TOP_MATCHES: 10,
  getSuggestedCreators: vi.fn(),
  matchCreatorsForBounty: vi.fn(),
}));

import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { getSuggestedCreators, matchCreatorsForBounty } from '@/lib/match-creators';

const mockOwnerSession = { user: { id: 'owner-1', role: 'USER' } };
const mockAdminSession = { user: { id: 'admin-1', role: 'ADMIN' } };
const mockOtherSession = { user: { id: 'other-user', role: 'USER' } };

const mockBounty = { id: 'bounty-1', creatorId: 'owner-1' };
const mockSuggestions = [
  { profileId: 'p1', userId: 'u1', displayName: 'Creator 1', score: 95, skills: ['Rust'], rating: 5, reasons: [] },
];

function getRequest(limit?: number) {
  const url = limit ? `http://localhost/api/bounties/bounty-1/suggested-creators?limit=${limit}` : 'http://localhost/api/bounties/bounty-1/suggested-creators';
  return new NextRequest(url, { method: 'GET' });
}

function postRequest() {
  return new NextRequest('http://localhost/api/bounties/bounty-1/suggested-creators', { method: 'POST' });
}

const ctx = { params: Promise.resolve({ id: 'bounty-1' }) };

describe('/api/bounties/[id]/suggested-creators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockOwnerSession);
    (prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockBounty);
    (getSuggestedCreators as ReturnType<typeof vi.fn>).mockResolvedValue(mockSuggestions);
    (matchCreatorsForBounty as ReturnType<typeof vi.fn>).mockResolvedValue(mockSuggestions);
  });

  describe('GET', () => {
    it('returns 401 when anonymous', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await GET(getRequest(), ctx);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 404 when bounty does not exist', async () => {
      (prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await GET(getRequest(), ctx);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Bounty not found');
    });

    it('returns 403 when requester is not the bounty owner or admin', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockOtherSession);
      const res = await GET(getRequest(), ctx);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    it('returns 200 with suggestions when requester is the bounty owner', async () => {
      const res = await GET(getRequest(), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.bountyId).toBe('bounty-1');
      expect(data.count).toBe(1);
      expect(data.suggestions).toEqual(mockSuggestions);
      expect(getSuggestedCreators).toHaveBeenCalledWith('bounty-1', 10);
    });

    it('returns 200 with suggestions when requester is an admin', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdminSession);
      const res = await GET(getRequest(), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.bountyId).toBe('bounty-1');
      expect(data.count).toBe(1);
    });
  });

  describe('POST', () => {
    it('returns 401 when anonymous', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await POST(postRequest(), ctx);
      expect(res.status).toBe(401);
    });

    it('returns 403 when requester is not the bounty owner or admin', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockOtherSession);
      const res = await POST(postRequest(), ctx);
      expect(res.status).toBe(403);
    });

    it('returns 200 and notifies when requester is the bounty owner', async () => {
      const res = await POST(postRequest(), ctx);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.bountyId).toBe('bounty-1');
      expect(data.notified).toBe(1);
      expect(matchCreatorsForBounty).toHaveBeenCalledWith('bounty-1');
    });

    it('returns 200 when requester is an admin', async () => {
      (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdminSession);
      const res = await POST(postRequest(), ctx);
      expect(res.status).toBe(200);
      expect(matchCreatorsForBounty).toHaveBeenCalledWith('bounty-1');
    });
  });
});
