'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';
import { Role } from '@/lib/generated/prisma/client';
import { 
  requireSuperadminRole, 
  requireModeratorRole, 
  canChangeUserRole,
  canSuspendUser,
  canDeleteUser
} from '@/server/services/permissions';

// ── Auth guard ────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string })?.role;
  const userId = (session?.user as { id?: string })?.id;

  if (!session || !userId) {
    throw new Error('Unauthorized: Admin access required');
  }

  return { userId, role };
}

// ── User management actions ────────────────────────────────────────────────────

/**
 * Change a user's role.
 * Only SUPERADMIN can promote users (no self-promotion).
 */
export async function changeUserRole(userId: string, newRole: Role) {
  const { userId: adminId } = await requireAdmin();
  
  // Permission check: SUPERADMIN only
  if (!await canChangeUserRole(adminId, userId)) {
    throw new Error('Forbidden: Superadmin role required to change user roles');
  }

  // Check if promoting to ADMIN requires 4-eyes approval
  if (newRole === 'ADMIN') {
    console.warn(
      `Admin promotion requested: ${adminId} → ${userId} to ADMIN role`,
    );
    // In production, this would require confirmation from another superadmin
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { role: newRole },
  });

  // Log the action
  await prisma.auditLog.create({
    data: {
      userId: adminId,
      resource: 'user',
      action: 'role_change',
      resourceId: userId,
      payload: { previousRole: user.role, newRole },
    },
  });

  return user;
}

/**
 * Suspend a user.
 * MODERATOR or SUPERADMIN can suspend (no self-suspension).
 */
export async function suspendUser(userId: string, reason: string) {
  const { userId: adminId } = await requireAdmin();
  
  // Permission check: MODERATOR or higher
  if (!await canSuspendUser(adminId, userId)) {
    throw new Error('Forbidden: Moderator role required to suspend users');
  }

  if (!reason || reason.trim().length === 0) {
    throw new Error('Suspension reason is required');
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      suspendedAt: new Date(),
      suspensionReason: reason,
    },
  });

  // Delete all sessions for suspended user
  await prisma.session.deleteMany({
    where: { userId },
  });

  // Log the action
  await prisma.auditLog.create({
    data: {
      userId: adminId,
      resource: 'user',
      action: 'suspend',
      resourceId: userId,
      payload: { reason },
    },
  });

  return user;
}

/**
 * Unsuspend a user.
 * MODERATOR or SUPERADMIN can unsuspend.
 */
export async function unsuspendUser(userId: string) {
  const { userId: adminId } = await requireAdmin();
  
  // Permission check: MODERATOR or higher
  if (!await canSuspendUser(adminId, userId)) {
    throw new Error('Forbidden: Moderator role required to unsuspend users');
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      suspendedAt: null,
      suspensionReason: null,
    },
  });

  // Log the action
  await prisma.auditLog.create({
    data: {
      userId: adminId,
      resource: 'user',
      action: 'unsuspend',
      resourceId: userId,
    },
  });

  return user;
}

/**
 * Delete a user.
 * SUPERADMIN only (no self-deletion).
 */
export async function deleteUser(userId: string) {
  const { userId: adminId } = await requireAdmin();
  
  // Permission check: SUPERADMIN only
  if (!await canDeleteUser(adminId, userId)) {
    throw new Error('Forbidden: Superadmin role required to delete users');
  }

  // Log before deletion (immutable audit trail)
  await prisma.auditLog.create({
    data: {
      userId: adminId,
      resource: 'user',
      action: 'delete',
      resourceId: userId,
    },
  });

  // Cascade delete via Prisma relations
  await prisma.user.delete({
    where: { id: userId },
  });
}

// ── Utility functions ──────────────────────────────────────────────────────────

export async function getUsersSummary(
  search?: string,
  roleFilter?: string,
  statusFilter?: string,
) {
  const whereClause: any = {};

  if (search) {
    whereClause.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (roleFilter && roleFilter !== 'All') {
    whereClause.role = roleFilter;
  }

  if (statusFilter && statusFilter !== 'All') {
    if (statusFilter === 'suspended') {
      whereClause.suspendedAt = { not: null };
    } else if (statusFilter === 'active') {
      whereClause.suspendedAt = null;
    }
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      suspendedAt: true,
      creatorProfile: {
        select: {
          completedProjects: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Count disputes (reports) per user in a single query
  const userIds = users.map((u) => u.id);
  const disputeCounts = await prisma.dispute.groupBy({
    by: ['creatorId'],
    where: { creatorId: { in: userIds } },
    _count: { id: true },
  });
  const clientDisputeCounts = await prisma.dispute.groupBy({
    by: ['clientId'],
    where: { clientId: { in: userIds } },
    _count: { id: true },
  });

  // Build a lookup map of dispute counts per user
  const reportMap = new Map<string, number>();
  for (const d of disputeCounts) {
    reportMap.set(d.creatorId, (reportMap.get(d.creatorId) ?? 0) + d._count.id);
  }
  for (const d of clientDisputeCounts) {
    reportMap.set(d.clientId, (reportMap.get(d.clientId) ?? 0) + d._count.id);
  }

  return users.map((user) => ({
    id: user.id,
    name: user.name || 'Unnamed User',
    email: user.email || '',
    role: user.role,
    status: user.suspendedAt ? 'suspended' : 'active',
    joinedAt: user.createdAt.toISOString().split('T')[0],
    bounties: user.creatorProfile?.completedProjects || 0,
    reports: reportMap.get(user.id) ?? 0,
  }));
}
