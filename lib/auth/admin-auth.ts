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

import { canAccess, hasPermission, type AdminAction, type AdminRole } from './admin-roles';

// Role helpers live in ./admin-roles so client components can use them
// without pulling Prisma and next-auth into the browser bundle.
export { canAccess, hasPermission };
export type { AdminAction, AdminRole };

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