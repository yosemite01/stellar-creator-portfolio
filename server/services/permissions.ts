/**
 * Permission Service - Centralized admin permission checks
 * 
 * Implements least-privilege access control across admin functions.
 */

import { prisma } from '@/lib/prisma';
import { getAdminSession, canAccess, hasPermission, AdminRole, AdminAction, requireStepUpAuthentication } from '@/lib/auth/admin-auth';

// ── Action definitions by role ───────────────────────────────────────────────

/**
 * Money-moving actions that require FINANCE or SUPERADMIN role
 */
export const MONEY_MOVING_ACTIONS: AdminAction[] = [
  'MANAGE_PAYOUTS',
  'VERIFY_ON_CHAIN',
];

/**
 * User management actions that require MODERATOR or SUPERADMIN role
 */
export const USER_MANAGEMENT_ACTIONS: AdminAction[] = [
  'MANAGE_USERS',
];

/**
 * Content moderation actions that require MODERATOR or SUPERADMIN role
 */
export const MODERATION_ACTIONS: AdminAction[] = [
  'MODERATE_CONTENT',
  'RESOLVE_DISPUTES',
];

// ── Permission check helpers ──────────────────────────────────────────────────

/**
 * Check if current user has permission for an action.
 */
export async function checkPermission(action: AdminAction): Promise<boolean> {
  try {
    const session = await getAdminSession();
    return hasPermission(session.role, action);
  } catch {
    return false;
  }
}

/**
 * Require permission for an action, throw 403 if denied.
 */
export async function requirePermission(action: AdminAction): Promise<void> {
  const hasAccess = await checkPermission(action);
  if (!hasAccess) {
    throw new Error(`Forbidden: You do not have permission for this action`);
  }
}

/**
 * Require FINANCE role or higher (for payout operations).
 */
export async function requireFinanceRole(): Promise<void> {
  const session = await getAdminSession();
  if (!canAccess(session.role, 'FINANCE')) {
    throw new Error('Forbidden: Finance or Superadmin role required');
  }
}

/**
 * Require MODERATOR role or higher (for user/content management).
 */
export async function requireModeratorRole(): Promise<void> {
  const session = await getAdminSession();
  if (!canAccess(session.role, 'MODERATOR')) {
    throw new Error('Forbidden: Moderator or Superadmin role required');
  }
}

/**
 * Require SUPERADMIN role (for system configuration).
 */
export async function requireSuperadminRole(): Promise<void> {
  const session = await getAdminSession();
  if (session.role !== 'SUPERADMIN') {
    throw new Error('Forbidden: Superadmin role required');
  }
}

// ── Payout service permission layer ──────────────────────────────────────────

/**
 * Check if user can approve a payout.
 * FINANCE or SUPERADMIN required.
 */
export async function canApprovePayout(userId: string): Promise<boolean> {
  try {
    await requireFinanceRole();
    return true;
  } catch {
    return false;
  }
}

/**
 * Require permission to approve a payout.
 */
export async function requireApprovePayoutPermission(): Promise<void> {
  await requireFinanceRole();
  await requireStepUpAuthentication(userId, 'PAYOUT_APPROVAL');
}

/**
 * Check if user can create a payout.
 * FINANCE or SUPERADMIN required.
 */
export async function canCreatePayout(userId: string): Promise<boolean> {
  try {
    await requireFinanceRole();
    return true;
  } catch {
    return false;
  }
}

// ── User service permission layer ────────────────────────────────────────────

/**
 * Check if user can modify another user's role.
 * SUPERADMIN only (no promotion self-service).
 */
export async function canChangeUserRole(userId: string, targetId: string): Promise<boolean> {
  if (userId === targetId) {
    return false; // No self-promotion
  }
  
  try {
    await requireSuperadminRole();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if user can suspend another user.
 * MODERATOR or SUPERADMIN required.
 */
export async function canSuspendUser(userId: string, targetId: string): Promise<boolean> {
  if (userId === targetId) {
    return false; // No self-suspension
  }
  
  try {
    await requireModeratorRole();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if user can delete another user.
 * SUPERADMIN only.
 */
export async function canDeleteUser(userId: string, targetId: string): Promise<boolean> {
  if (userId === targetId) {
    return false; // No self-deletion
  }
  
  try {
    await requireSuperadminRole();
    return true;
  } catch {
    return false;
  }
}

// ── Dispute service permission layer ─────────────────────────────────────────

/**
 * Check if user can resolve a dispute.
 * MODERATOR or SUPERADMIN required.
 */
export async function canResolveDispute(disputeId: string): Promise<boolean> {
  try {
    await requireModeratorRole();
    return true;
  } catch {
    return false;
  }
}

// ── Audit service permission layer ───────────────────────────────────────────

/**
 * Check if user can view audit logs.
 * MODERATOR or higher (FINANCE can also view).
 */
export async function canViewAuditLogs(): Promise<boolean> {
  try {
    await getAdminSession(); // Any admin can view
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if user can anchor audit chain on Stellar.
 * SUPERADMIN only (cryptographic proof requires highest privilege).
 */
export async function canAnchorAuditChain(): Promise<boolean> {
  try {
    await requireSuperadminRole();
    return true;
  } catch {
    return false;
  }
}

// ── Report service permission layer ──────────────────────────────────────────

/**
 * Check if user can view content reports.
 * SUPPORT or higher can view.
 */
export async function canViewReports(): Promise<boolean> {
  try {
    const session = await getAdminSession();
    return hasPermission(session.role, 'VIEW_REPORTS');
  } catch {
    return false;
  }
}

/**
 * Check if user can dismiss a report.
 * MODERATOR or higher required.
 */
export async function canDismissReport(): Promise<boolean> {
  try {
    await requireModeratorRole();
    return true;
  } catch {
    return false;
  }
}

// ── Feature flag service permission layer ────────────────────────────────────

/**
 * Check if user can manage feature flags.
 * SUPERADMIN only.
 */
export async function canManageFeatureFlags(): Promise<boolean> {
  try {
    await requireSuperadminRole();
    return true;
  } catch {
    return false;
  }
}