/**
 * Admin role hierarchy and permission matrix. Pure functions with no server
 * imports, so they are safe to use from client components (e.g. the admin
 * sidebar). Server-side guards live in ./admin-auth.
 */

export type AdminRole = 'SUPPORT' | 'MODERATOR' | 'FINANCE' | 'SUPERADMIN';

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

