/**
 * Admin Permission Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  canAccess,
  hasPermission,
  checkPermission,
  requirePermission,
  requireFinanceRole,
  requireModeratorRole,
  requireSuperadminRole,
  canApprovePayout,
  canCreatePayout,
  canChangeUserRole,
  canSuspendUser,
  canDeleteUser,
  canResolveDispute,
  canViewAuditLogs,
  canAnchorAuditChain,
  canViewReports,
  canDismissReport,
  canManageFeatureFlags,
} from './permissions';

// Mock dependencies
vi.mock('@/lib/auth/admin-auth', () => ({
  getAdminSession: vi.fn(),
  canAccess: vi.fn(),
  hasPermission: vi.fn(),
  requireStepUpAuthentication: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

describe('Admin Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('canAccess', () => {
    it('should allow higher role to access lower role functionality', () => {
      expect(canAccess('SUPERADMIN', 'FINANCE')).toBe(true);
      expect(canAccess('FINANCE', 'MODERATOR')).toBe(true);
      expect(canAccess('MODERATOR', 'SUPPORT')).toBe(true);
    });

    it('should deny lower role to access higher role functionality', () => {
      expect(canAccess('SUPPORT', 'MODERATOR')).toBe(false);
      expect(canAccess('MODERATOR', 'FINANCE')).toBe(false);
      expect(canAccess('FINANCE', 'SUPERADMIN')).toBe(false);
    });

    it('should allow same role access', () => {
      expect(canAccess('FINANCE', 'FINANCE')).toBe(true);
    });
  });

  describe('hasPermission', () => {
    it('should return true for supported actions', () => {
      expect(hasPermission('SUPPORT', 'VIEW_REPORTS')).toBe(true);
      expect(hasPermission('MODERATOR', 'MANAGE_USERS')).toBe(true);
      expect(hasPermission('FINANCE', 'MANAGE_PAYOUTS')).toBe(true);
      expect(hasPermission('SUPERADMIN', 'CONFIGURE_SYSTEM')).toBe(true);
    });

    it('should return false for unsupported actions', () => {
      expect(hasPermission('SUPPORT', 'MANAGE_PAYOUTS')).toBe(false);
      expect(hasPermission('MODERATOR', 'CONFIGURE_SYSTEM')).toBe(false);
    });
  });

  describe('requirePermission', () => {
    it('should not throw for permitted actions', async () => {
      vi.mocked(hasPermission).mockReturnValue(true);
      await expect(requirePermission('VIEW_REPORTS')).resolves.not.toThrow();
    });

    it('should throw for non-permitted actions', async () => {
      vi.mocked(hasPermission).mockReturnValue(false);
      await expect(requirePermission('MANAGE_PAYOUTS')).rejects.toThrow('Forbidden');
    });
  });

  describe('Finance Role Checks', () => {
    it('should allow finance role to manage payouts', async () => {
      vi.mocked(canAccess).mockImplementation((user, required) => user === 'FINANCE' && required === 'FINANCE');
      const result = await canApprovePayout('user123');
      expect(result).toBe(true);
    });

    it('should deny non-finance roles to manage payouts', async () => {
      vi.mocked(canAccess).mockImplementation(() => false);
      const result = await canApprovePayout('user123');
      expect(result).toBe(false);
    });
  });

  describe('User Management Checks', () => {
    it('should deny self-promotion', async () => {
      const result = await canChangeUserRole('user123', 'user123');
      expect(result).toBe(false);
    });

    it('should allow superadmin to promote others', async () => {
      vi.mocked(canAccess).mockImplementation((user, required) => user === 'SUPERADMIN');
      const result = await canChangeUserRole('admin1', 'user123');
      expect(result).toBe(true);
    });

    it('should deny moderator from promoting users', async () => {
      vi.mocked(canAccess).mockImplementation((user, required) => user === 'MODERATOR');
      const result = await canChangeUserRole('mod1', 'user123');
      expect(result).toBe(false);
    });
  });

  describe('Dispute Resolution Checks', () => {
    it('should allow moderator to resolve disputes', async () => {
      vi.mocked(canAccess).mockImplementation((user, required) => user === 'MODERATOR');
      const result = await canResolveDispute('dispute1');
      expect(result).toBe(true);
    });

    it('should deny support role from resolving disputes', async () => {
      vi.mocked(canAccess).mockImplementation((user, required) => user === 'SUPPORT');
      const result = await canResolveDispute('dispute1');
      expect(result).toBe(false);
    });
  });

  describe('Audit Chain Anchoring', () => {
    it('should require superadmin', async () => {
      vi.mocked(canAccess).mockImplementation((user, required) => user === 'SUPERADMIN');
      const result = await canAnchorAuditChain();
      expect(result).toBe(true);
    });
  });

  describe('Feature Flag Management', () => {
    it('should require superadmin', async () => {
      vi.mocked(canAccess).mockImplementation((user, required) => user === 'SUPERADMIN');
      const result = await canManageFeatureFlags();
      expect(result).toBe(true);
    });
  });
});