/**
 * Admin Permission Hooks
 * Client-side permission checks for admin features.
 */

import { useEffect, useState } from 'react';
import type { AdminRole } from '@/lib/auth/admin-auth';

/**
 * Get current user's admin role from session.
 */
export function useAdminRole(): AdminRole | null {
  const [role, setRole] = useState<AdminRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkRole() {
      try {
        const res = await fetch('/api/admin/session');
        if (res.ok) {
          const data = await res.json();
          setRole(data.role as AdminRole);
        }
      } catch {
        // Silent fail - user is not an admin
      } finally {
        setLoading(false);
      }
    }
    checkRole();
  }, []);

  return role;
}

/**
 * Check if user has permission for an action.
 */
export function usePermission(action: string): boolean {
  const role = useAdminRole();
  const [hasPermission, setHasPermission] = useState(false);

  useEffect(() => {
    if (!role) {
      setHasPermission(false);
      return;
    }

    // Map action strings to permission checks
    const permissions: Record<string, boolean> = {
      // User management
      'user_view': role === 'SUPERADMIN',
      'user_edit': role === 'SUPERADMIN',
      'user_suspend': role === 'MODERATOR',
      
      // Payout management
      'payout_approve': role === 'FINANCE',
      'payout_create': role === 'FINANCE',
      
      // Content moderation
      'report_view': role !== null,
      'dispute_resolve': role === 'MODERATOR',
      
      // Analytics
      'analytics_view': role === 'MODERATOR',
      
      // System
      'system_config': role === 'SUPERADMIN',
    };

    setHasPermission(permissions[action] ?? false);
  }, [role, action]);

  return hasPermission;
}

/**
 * Check if user can perform money-moving actions (FINANCE+).
 */
export function useCanManagePayouts(): boolean {
  const role = useAdminRole();
  return role === 'FINANCE' || role === 'SUPERADMIN';
}

/**
 * Check if user can manage users (MODERATOR+).
 */
export function useCanManageUsers(): boolean {
  const role = useAdminRole();
  return role === 'MODERATOR' || role === 'SUPERADMIN';
}

/**
 * Check if user can resolve disputes (MODERATOR+).
 */
export function useCanResolveDisputes(): boolean {
  const role = useAdminRole();
  return role === 'MODERATOR' || role === 'SUPERADMIN';
}