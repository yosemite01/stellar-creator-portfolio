'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';

// ── Auth guard ────────────────────────────────────────────────────────────────

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string })?.role;
  const userId = (session?.user as { id?: string })?.id;

  if (!session || role !== 'ADMIN' || !userId) {
    throw new Error('Unauthorized: Admin access required');
  }

  return userId;
}

// ── Admin actions for user management ──────────────────────────────────────────

export async function changeUserRole(userId: string, newRole: Role) {
  const adminId = await requireAdmin();

  if (adminId === userId && newRole === 'ADMIN') {
    throw new Error('Cannot self-promote to ADMIN role');
  }

  // Check if promoting to ADMIN requires 4-eyes approval
  if (newRole === 'ADMIN') {
    // This is where 4-eyes principle would be enforced
    // For now, we'll just log and allow, but this should require confirmation from another admin
    console.warn(
      `Admin promotion requested: ${adminId} → ${userId} to ADMIN role`,
    );
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

export async function suspendUser(userId: string, reason: string) {
  const adminId = await requireAdmin();

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

export async function unsuspendUser(userId: string) {
  const adminId = await requireAdmin();

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

export async function deleteUser(userId: string) {
  const adminId = await requireAdmin();

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

  return users.map((user) => ({
    id: user.id,
    name: user.name || 'Unnamed User',
    email: user.email || '',
    role: user.role,
    status: user.suspendedAt ? 'suspended' : 'active',
    joinedAt: user.createdAt.toISOString().split('T')[0],
    bounties: user.creatorProfile?.completedProjects || 0,
    reports: 0, // TODO: Calculate from database
  }));
}
