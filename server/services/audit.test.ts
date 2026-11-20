/**
 * Audit service tests - hash chain verification
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { computeEntryHash, verifyAuditChain, anchorChainHeadOnStellar } from './audit';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('Audit Service - Hash Chain', () => {
  describe('computeEntryHash', () => {
    it('should compute deterministic SHA-256 hash', () => {
      const entry = {
        id: 'test-id',
        userId: 'user-123',
        resource: 'bounty',
        action: 'create',
        resourceId: 'bounty-456',
        payload: { title: 'Test bounty' },
        httpMethod: 'POST',
        requestPath: '/api/bounties',
        status: 'SUCCESS',
        errorMessage: null,
        traceId: 'trace-123',
        ipHash: 'ip-hash-456',
        userAgent: 'Mozilla/5.0',
        geoCountry: 'US',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        prevHash: null,
      };

      const hash = computeEntryHash(entry);
      
      // Hash should be 64 character hex string (SHA-256)
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      
      // Same input should produce same hash
      expect(computeEntryHash(entry)).toBe(hash);
    });

    it('should produce different hash when prevHash changes', () => {
      const entry: any = {
        id: 'test-id',
        userId: 'user-123',
        resource: 'bounty',
        action: 'create',
        resourceId: 'bounty-456',
        payload: { title: 'Test bounty' },
        httpMethod: 'POST',
        requestPath: '/api/bounties',
        status: 'SUCCESS',
        errorMessage: null,
        traceId: 'trace-123',
        ipHash: 'ip-hash-456',
        userAgent: 'Mozilla/5.0',
        geoCountry: 'US',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };

      const hash1 = computeEntryHash({ ...entry, prevHash: null });
      const hash2 = computeEntryHash({ ...entry, prevHash: 'abc123' });

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash when entry data changes', () => {
      const baseEntry: any = {
        id: 'test-id',
        userId: 'user-123',
        resource: 'bounty',
        action: 'create',
        resourceId: 'bounty-456',
        payload: { title: 'Test bounty' },
        httpMethod: 'POST',
        requestPath: '/api/bounties',
        status: 'SUCCESS',
        errorMessage: null,
        traceId: 'trace-123',
        ipHash: 'ip-hash-456',
        userAgent: 'Mozilla/5.0',
        geoCountry: 'US',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        prevHash: null,
      };

      const entryWithDifferentAction = { ...baseEntry, action: 'delete' };
      const hash1 = computeEntryHash(baseEntry);
      const hash2 = computeEntryHash(entryWithDifferentAction);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyAuditChain', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return valid for empty chain', async () => {
      (prisma.auditLog.findMany as any).mockResolvedValue([]);
      
      const result = await verifyAuditChain();
      
      expect(result).toEqual({
        isValid: true,
        tamperedEntries: [],
        message: 'No audit entries to verify',
      });
    });

    it('should return valid for chain with no tampering', async () => {
      const entries = [
        {
          id: 'a1',
          prevHash: null,
          entryHash: 'hash-a1',
          isTampered: false,
          userId: 'user1',
          resource: 'bounty',
          action: 'create',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'a2',
          prevHash: 'hash-a1',
          entryHash: 'hash-a2',
          isTampered: false,
          userId: 'user1',
          resource: 'bounty',
          action: 'update',
          createdAt: new Date('2026-01-01T01:00:00Z'),
        },
      ];

      (prisma.auditLog.findMany as any).mockResolvedValue(entries);
      // Mock computeEntryHash to return expected hashes
      vi.spyOn(require('./audit'), 'computeEntryHash').mockImplementation((entry: any) => {
        if (entry.id === 'a1') return 'hash-a1';
        if (entry.id === 'a2') return 'hash-a2';
        return 'unknown';
      });

      const result = await verifyAuditChain();
      
      expect(result.isValid).toBe(true);
      expect(result.tamperedEntries).toEqual([]);
    });

    it('should detect tampered entries', async () => {
      const entries = [
        {
          id: 'a1',
          prevHash: null,
          entryHash: 'hash-a1',
          isTampered: false,
          userId: 'user1',
          resource: 'bounty',
          action: 'create',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'a2',
          prevHash: 'wrong-hash', // Tampered - wrong prevHash
          entryHash: 'hash-a2',
          isTampered: false,
          userId: 'user1',
          resource: 'bounty',
          action: 'update',
          createdAt: new Date('2026-01-01T01:00:00Z'),
        },
      ];

      (prisma.auditLog.findMany as any).mockResolvedValue(entries);
      vi.spyOn(require('./audit'), 'computeEntryHash').mockImplementation((entry: any) => {
        if (entry.id === 'a1') return 'hash-a1';
        return 'hash-a2';
      });

      const result = await verifyAuditChain();
      
      expect(result.isValid).toBe(false);
      expect(result.tamperedEntries).toEqual(['a2']);
    });

    it('should detect entries marked as isTampered', async () => {
      const entries = [
        {
          id: 'a1',
          prevHash: null,
          entryHash: 'hash-a1',
          isTampered: true, // Marked as tampered
          userId: 'user1',
          resource: 'bounty',
          action: 'create',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ];

      (prisma.auditLog.findMany as any).mockResolvedValue(entries);

      const result = await verifyAuditChain();
      
      expect(result.isValid).toBe(false);
      expect(result.tamperedEntries).toEqual(['a1']);
    });
  });
});