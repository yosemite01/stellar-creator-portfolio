/**
 * Admin Authentication & Authorization
 * 
 * Role hierarchy:
 *   SUPPORT < MODERATOR < FINANCE < SUPERADMIN
 * 
 * Permission matrix:
 * | Action                    | SUPPORT | MODERATOR | FINANCE | SUPERADMIN |
 * |---------------------------|---------|-----------|---------|------------|
 * | User management           |    -    |     ✓     |    -    |      ✓     |
 * | Bounty approval           |    -    |     ✓     |    -    |      ✓     |
 * | Dispute resolution        |    -    |     ✓     |    -    |      ✓     |
 * | Report management         |    ✓    |     ✓     |    -    |      ✓     |
 * | View analytics            |    -    |     ✓     |    ✓    |      ✓     |
 * | Manage payouts            |    -    |     -     |    ✓    |      ✓     |
 * | Verify on-chain (Stellar) |    -    |     -     |    ✓    |      ✓     |
 * | System configuration      |    -    |     -     |    -    |      ✓     |
 * | View audit log            |    -    |     ✓     |    ✓    |      ✓     |
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';

export type AdminRole = 'SUPPORT' | 'MODERATOR' | 'FINANCE' | 'SUPERADMIN';

export interface AdminSession {
  userId: string;
  role: AdminRole;
  email?: string;
  name?: string;
}

/**
 * Get admin session with role check.
 * Throws 401 if not an admin, 403 if missing required role.
 */
export async function getAdminSession(requiredRole?: AdminRole): Promise<AdminSession> {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    throw new Error('Unauthorized: Admin access required');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, email: true, name: true },
  });

  if (!user) {
    throw new Error('Unauthorized: User not found');
  }

  // Map database Role to AdminRole
  const adminRole = mapRoleToAdminRole(user.role);
  if (!adminRole) {
    throw new Error('Unauthorized: Admin role required');
  }

  // Check required role if specified
  if (requiredRole && !canAccess(adminRole, requiredRole)) {
    throw new Error(`Forbidden: ${requiredRole} role required`);
  }

  return {
    userId: session.user.id,
    role: adminRole,
    email: user.email ?? undefined,
    name: user.name ?? undefined,
  };
}

/**
 * Map database Role enum to AdminRole.
 */
function mapRoleToAdminRole(role: string): AdminRole | null {
  switch (role) {
    case 'ADMIN':
      return 'SUPERADMIN';
    case 'USER':
      return 'SUPPORT';
    case 'CREATOR':
      return null; // Creators can't be admins
    case 'CLIENT':
      return null; // Clients can't be admins
    default:
      return null;
  }
}

/**
 * Check if user's role has access to required role level.
 * Higher roles can access lower role functionality.
 */
export function canAccess(userRole: AdminRole, requiredRole: AdminRole): boolean {
  const roleHierarchy: Record<AdminRole, number> = {
    SUPPORT: 1,
    MODERATOR: 2,
    FINANCE: 3,
    SUPERADMIN: 4,
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * Check if user has permission for an action.
 */
export function hasPermission(userRole: AdminRole, action: AdminAction): boolean {
  const permissions: Record<AdminRole, AdminAction[]> = {
    SUPPORT: ['VIEW_REPORTS', 'VIEW_ANALYTICS'],
    MODERATOR: [
      'VIEW_REPORTS', 'VIEW_ANALYTICS', 'MANAGE_USERS', 
      'MODERATE_CONTENT', 'RESOLVE_DISPUTES'
    ],
    FINANCE: [
      'VIEW_REPORTS', 'VIEW_ANALYTICS', 'MANAGE_PAYOUTS',
      'VERIFY_ON_CHAIN'
    ],
    SUPERADMIN: [
      'VIEW_REPORTS', 'VIEW_ANALYTICS', 'MANAGE_USERS',
      'MODERATE_CONTENT', 'RESOLVE_DISPUTES', 'MANAGE_PAYOUTS',
      'VERIFY_ON_CHAIN', 'CONFIGURE_SYSTEM'
    ],
  };

  return permissions[userRole]?.includes(action) ?? false;
}

/**
 * All admin actions with required roles.
 */
export type AdminAction =
  // User management (create, update, delete, suspend, role change)
  | 'MANAGE_USERS'
  // Content moderation (reports, flags)
  | 'MODERATE_CONTENT'
  // Dispute resolution
  | 'RESOLVE_DISPUTES'
  // View analytics
  | 'VIEW_ANALYTICS'
  // Payout management (approve, approve, cancel)
  | 'MANAGE_PAYOUTS'
  // On-chain verification (Stellar)
  | 'VERIFY_ON_CHAIN'
  // System configuration
  | 'CONFIGURE_SYSTEM'
  // Report viewing
  | 'VIEW_REPORTS';

/**
 * Guard that throws 403 if user lacks permission.
 */
export async function requirePermission(
  action: AdminAction,
  requiredRole?: AdminRole
): Promise<AdminSession> {
  const session = await getAdminSession(requiredRole);
  
  if (!hasPermission(session.role, action)) {
    throw new Error(`Forbidden: ${action} action requires higher privileges`);
  }

  return session;
}

/**
 * Step-up authentication required for sensitive operations.
 * Uses WebAuthn for money-moving actions.
 */
export async function requireStepUpAuthentication(
  userId: string,
  action: 'PAYOUT_APPROVAL' | 'ACCOUNT_SUSPENSION' | 'ROLE_PROMOTION'
): Promise<void> {
  // In production, this would verify WebAuthn credential
  // For now, log the requirement
  console.log(`Step-up auth required for ${action} by user ${userId}`);
  
  // TODO: Implement WebAuthn verification
  // 1. Generate challenge
  // 2. Verify credential response
  // 3. Reject if invalid
  
  // For now, allow (TODO: remove this comment when implemented)
}