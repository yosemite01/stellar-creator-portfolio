import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getServerSession, prismaFindUnique, prismaFindMany, prismaCreateMany } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  prismaFindUnique: vi.fn(),
  prismaFindMany: vi.fn(),
  prismaCreateMany: vi.fn(),
}));

vi.mock('@/lib/auth/auth', () => ({
  getServerSession,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    bounty: {
      findUnique: prismaFindUnique,
    },
    creatorProfile: {
      findMany: prismaFindMany,
    },
    matchNotification: {
      createMany: prismaCreateMany,
    },
  },
}));

import { GET, POST } from '@/app/api/bounties/[id]/suggested-creators/route';
import {
  isValidBountyId,
  verifyBountyOwnerOrAdmin,
} from '@/lib/match-creators';

const mockBounty = {
  id: 'bounty-123',
  creatorId: 'user-owner',
  title: 'React Soroban Dashboard',
  description: 'Build a decentralized dashboard on Stellar',
  budget: 5000,
  category: 'Development',
  tags: ['react', 'stellar', 'soroban'],
};

const mockProfiles = [
  {
    id: 'profile-1',
    userId: 'creator-user-1',
    displayName: 'Stellar Artisan',
    bio: 'React and Soroban developer',
    discipline: 'Development',
    skills: ['react', 'stellar', 'soroban'],
    rating: 4.9,
    completedProjects: 15,
  },
];

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('Security & Access Control: /api/bounties/[id]/suggested-creators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === mockBounty.id) {
        return mockBounty;
      }
      return null;
    });
    prismaFindMany.mockResolvedValue(mockProfiles);
    prismaCreateMany.mockResolvedValue({ count: 1 });
  });

  describe('Regression: Issue #1520 Protection Against Information Disclosure', () => {
    it('prevents anonymous attackers from scraping suggested creators (returns 401)', async () => {
      getServerSession.mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators');
      const res = await GET(req, makeContext('bounty-123'));

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({ error: 'Unauthorized' });
    });

    it('prevents competitor/non-owner accounts from accessing private bounty matches (returns 403)', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'attacker-competitor', role: 'USER' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators');
      const res = await GET(req, makeContext('bounty-123'));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json).toEqual({ error: 'Forbidden' });
    });
  });

  describe('GET /api/bounties/[id]/suggested-creators', () => {
    it('returns 401 when unauthenticated', async () => {
      getServerSession.mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators');
      const res = await GET(req, makeContext('bounty-123'));

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('returns 403 when authenticated as a non-owner non-admin user', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'other-user', role: 'CLIENT' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators');
      const res = await GET(req, makeContext('bounty-123'));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    it('returns 200 and suggested creators for the bounty owner', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'user-owner', role: 'USER' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators');
      const res = await GET(req, makeContext('bounty-123'));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bountyId).toBe('bounty-123');
      expect(Array.isArray(json.suggestions)).toBe(true);
      expect(json.count).toBe(json.suggestions.length);
    });

    it('returns 200 and suggested creators for an admin (even if not owner)', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'admin-user', role: 'ADMIN' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators');
      const res = await GET(req, makeContext('bounty-123'));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bountyId).toBe('bounty-123');
      expect(Array.isArray(json.suggestions)).toBe(true);
    });

    it('validates limit query param when supplied by owner', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'user-owner', role: 'USER' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators?limit=5');
      const res = await GET(req, makeContext('bounty-123'));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bountyId).toBe('bounty-123');
    });

    it('returns 400 for invalid id format', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'user-owner', role: 'USER' },
      });

      const req = new NextRequest('http://localhost/api/bounties/../bad-path/suggested-creators');
      const res = await GET(req, makeContext('../bad-path'));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid bounty id');
    });

    it('returns 404 when bounty does not exist', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'user-owner', role: 'USER' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-999/suggested-creators');
      const res = await GET(req, makeContext('bounty-999'));

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('Bounty not found');
    });
  });

  describe('POST /api/bounties/[id]/suggested-creators', () => {
    it('returns 401 when unauthenticated', async () => {
      getServerSession.mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators', {
        method: 'POST',
      });
      const res = await POST(req, makeContext('bounty-123'));

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('returns 403 when non-owner attempts to trigger matching notifications', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'other-user', role: 'CREATOR' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators', {
        method: 'POST',
      });
      const res = await POST(req, makeContext('bounty-123'));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    it('returns 200 and dispatches notifications for the bounty owner', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'user-owner', role: 'USER' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators', {
        method: 'POST',
      });
      const res = await POST(req, makeContext('bounty-123'));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bountyId).toBe('bounty-123');
      expect(json.notified).toBe(json.suggestions.length);
      expect(prismaCreateMany).toHaveBeenCalled();
    });

    it('returns 200 for an administrator', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'admin-1', role: 'ADMIN' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-123/suggested-creators', {
        method: 'POST',
      });
      const res = await POST(req, makeContext('bounty-123'));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.bountyId).toBe('bounty-123');
    });

    it('returns 400 for invalid id format', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'user-owner', role: 'USER' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bad$id/suggested-creators', {
        method: 'POST',
      });
      const res = await POST(req, makeContext('bad$id'));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid bounty id');
    });

    it('returns 404 when bounty does not exist', async () => {
      getServerSession.mockResolvedValue({
        user: { id: 'user-owner', role: 'USER' },
      });

      const req = new NextRequest('http://localhost/api/bounties/bounty-unknown/suggested-creators', {
        method: 'POST',
      });
      const res = await POST(req, makeContext('bounty-unknown'));

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('Bounty not found');
    });
  });

  describe('Core Unit Logic: isValidBountyId', () => {
    it('accepts valid alphanumeric, hyphenated, and cuid formats', () => {
      expect(isValidBountyId('bounty-123')).toBe(true);
      expect(isValidBountyId('cuid1234567890abcdef')).toBe(true);
      expect(isValidBountyId('b_456_test')).toBe(true);
      expect(isValidBountyId('12345')).toBe(true);
    });

    it('rejects empty strings, whitespace, path traversal, or special characters', () => {
      expect(isValidBountyId('')).toBe(false);
      expect(isValidBountyId('   ')).toBe(false);
      expect(isValidBountyId('bounty 123')).toBe(false);
      expect(isValidBountyId('../bounty')).toBe(false);
      expect(isValidBountyId('bounty/1')).toBe(false);
      expect(isValidBountyId('bounty<script>')).toBe(false);
      expect(isValidBountyId("bounty' OR 1=1--")).toBe(false);
      expect(isValidBountyId(null)).toBe(false);
      expect(isValidBountyId(undefined)).toBe(false);
      expect(isValidBountyId(123)).toBe(false);
      expect(isValidBountyId('a'.repeat(129))).toBe(false);
    });
  });

  describe('Core Unit Logic: verifyBountyOwnerOrAdmin', () => {
    it('rejects unauthenticated calls with 401', async () => {
      const res1 = await verifyBountyOwnerOrAdmin('bounty-123', null);
      expect(res1).toEqual({ authorized: false, status: 401, error: 'Unauthorized' });

      const res2 = await verifyBountyOwnerOrAdmin('bounty-123', {});
      expect(res2).toEqual({ authorized: false, status: 401, error: 'Unauthorized' });

      const res3 = await verifyBountyOwnerOrAdmin('bounty-123', { user: {} });
      expect(res3).toEqual({ authorized: false, status: 401, error: 'Unauthorized' });
    });

    it('rejects invalid bountyId with 400', async () => {
      const session = { user: { id: 'u1', role: 'USER' } };
      const res = await verifyBountyOwnerOrAdmin('invalid id!', session);
      expect(res).toEqual({ authorized: false, status: 400, error: 'Invalid bounty id' });
    });

    it('returns 404 when bounty is missing from database', async () => {
      prismaFindUnique.mockResolvedValueOnce(null);
      const session = { user: { id: 'u1', role: 'USER' } };
      const res = await verifyBountyOwnerOrAdmin('bounty-missing', session);
      expect(res).toEqual({ authorized: false, status: 404, error: 'Bounty not found' });
    });

    it('rejects non-owner non-admin with 403', async () => {
      prismaFindUnique.mockResolvedValueOnce({ id: 'b1', creatorId: 'owner-id' });
      const session = { user: { id: 'intruder-id', role: 'USER' } };
      const res = await verifyBountyOwnerOrAdmin('b1', session);
      expect(res).toEqual({ authorized: false, status: 403, error: 'Forbidden' });
    });

    it('authorizes the bounty owner', async () => {
      prismaFindUnique.mockResolvedValueOnce({ id: 'b1', creatorId: 'owner-id' });
      const session = { user: { id: 'owner-id', role: 'USER' } };
      const res = await verifyBountyOwnerOrAdmin('b1', session);
      expect(res.authorized).toBe(true);
      if (res.authorized) {
        expect(res.bounty.creatorId).toBe('owner-id');
      }
    });

    it('authorizes an admin user even if not the owner', async () => {
      prismaFindUnique.mockResolvedValueOnce({ id: 'b1', creatorId: 'owner-id' });
      const session = { user: { id: 'admin-id', role: 'ADMIN' } };
      const res = await verifyBountyOwnerOrAdmin('b1', session);
      expect(res.authorized).toBe(true);
      if (res.authorized) {
        expect(res.bounty.creatorId).toBe('owner-id');
      }
    });
  });
});
