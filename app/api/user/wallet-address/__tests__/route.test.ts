import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '../route';

// Mock auth session
let mockSession: { user?: { id: string; name?: string } } | null = null;
vi.mock('@/lib/auth/auth', () => ({
  getServerSession: vi.fn(async () => mockSession),
}));

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';

// Known valid Stellar public key (56 chars, G prefix, valid CRC16 checksum)
const VALID_STELLAR_G_ADDRESS = 'GDLCJGQLXZGDAAT5QGRF6FM2MBEER3FPYGCSVPXYL47G2ABIOX2M2S6K';
// Another valid Stellar public key for multi-account testing
const ANOTHER_VALID_STELLAR_G_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
// 56-character string starting with G, but invalid CRC16 checksum
const CORRUPTED_CHECKSUM_G_ADDRESS = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
// Stellar secret key (starts with S) — must never be accepted as wallet address
const STELLAR_SECRET_KEY = 'SCV472K72V52R34H7L6WJ6J7L3V4Z3V4Z3V4Z3V4Z3V4Z3V4Z3V4Z3V4';

describe('User wallet-address endpoint (Issue #1526)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = { user: { id: 'usr_active_123' } };
  });

  describe('GET /api/user/wallet-address', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSession = null;
      const res = await GET();
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({ error: 'Unauthorized' });
    });

    it('returns current linked wallet address for authenticated user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        walletAddress: VALID_STELLAR_G_ADDRESS,
      } as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ walletAddress: VALID_STELLAR_G_ADDRESS });
    });

    it('returns null when user has no linked wallet address', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        walletAddress: null,
      } as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ walletAddress: null });
    });
  });

  describe('PATCH /api/user/wallet-address', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSession = null;
      const req = new NextRequest('http://localhost/api/user/wallet-address', {
        method: 'PATCH',
        body: JSON.stringify({ walletAddress: VALID_STELLAR_G_ADDRESS }),
      });

      const res = await PATCH(req);
      expect(res.status).toBe(401);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('returns 422 when body is empty or walletAddress is blank', async () => {
      const req = new NextRequest('http://localhost/api/user/wallet-address', {
        method: 'PATCH',
        body: JSON.stringify({ walletAddress: '   ' }),
      });

      const res = await PATCH(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json).toEqual({ error: 'walletAddress is required' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('returns 422 when address does not start with G (e.g. secret key)', async () => {
      const req = new NextRequest('http://localhost/api/user/wallet-address', {
        method: 'PATCH',
        body: JSON.stringify({ walletAddress: STELLAR_SECRET_KEY }),
      });

      const res = await PATCH(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toContain('start with G');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('returns 422 when address length is incorrect', async () => {
      const req = new NextRequest('http://localhost/api/user/wallet-address', {
        method: 'PATCH',
        body: JSON.stringify({ walletAddress: 'GDLCJGQLXZGDAAT5QGRF6FM2MBEER3FPYGCSVPXY' }),
      });

      const res = await PATCH(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toContain('56 characters');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('returns 422 when 56-character G-address fails Ed25519 checksum verification', async () => {
      const req = new NextRequest('http://localhost/api/user/wallet-address', {
        method: 'PATCH',
        body: JSON.stringify({ walletAddress: CORRUPTED_CHECKSUM_G_ADDRESS }),
      });

      const res = await PATCH(req);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toContain('valid checksum');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('returns 409 when address is already linked to another user account', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({
        id: 'usr_other_user_456',
      } as any);

      const req = new NextRequest('http://localhost/api/user/wallet-address', {
        method: 'PATCH',
        body: JSON.stringify({ walletAddress: VALID_STELLAR_G_ADDRESS }),
      });

      const res = await PATCH(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json).toEqual({ error: 'This address is already linked to another account' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('successfully links valid Stellar G-address to the authenticated user', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        walletAddress: VALID_STELLAR_G_ADDRESS,
      } as any);

      const req = new NextRequest('http://localhost/api/user/wallet-address', {
        method: 'PATCH',
        body: JSON.stringify({ walletAddress: `  ${VALID_STELLAR_G_ADDRESS}  ` }),
      });

      const res = await PATCH(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ walletAddress: VALID_STELLAR_G_ADDRESS });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_active_123' },
        data: { walletAddress: VALID_STELLAR_G_ADDRESS },
        select: { walletAddress: true },
      });
    });
  });
});
