/**
 * Centralized Authorization Service
 *
 * Provides consistent authorization primitives for both REST and tRPC endpoints.
 * All authorization checks should go through this service to ensure consistency
 * and prevent authorization bugs from duplicated logic.
 *
 * Design principles:
 *  - Fail-safe: All functions throw on authorization failure
 *  - Clear error messages: HTTP status codes and descriptive messages
 *  - Single source of truth: Authorization logic in one place
 */

import type { User } from '@/server/api/trpc'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Role = 'ADMIN' | 'CLIENT' | 'CREATOR' | 'USER'

export interface AuthContext {
  user?: User | null
  role?: Role
}

export interface AuthenticatedUser {
  id: string
  email: string | null
  name: string | null
  role: Role
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

export class NotAuthenticatedError extends AuthorizationError {
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'NotAuthenticatedError'
  }
}

export class ForbiddenError extends AuthorizationError {
  constructor(message = 'Insufficient permissions') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

// ── Core Authorization Functions ─────────────────────────────────────────────

/**
 * Require authentication. Throws NotAuthenticatedError if user is not present.
 * Returns the authenticated user.
 */
export function requireAuth(ctx: AuthContext): AuthenticatedUser {
  if (!ctx.user) {
    throw new NotAuthenticatedError()
  }

  // Ensure role exists (default to USER for backwards compatibility)
  const role = (ctx.user as { role?: Role }).role ?? 'USER'

  return {
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    role,
  }
}

/**
 * Require a specific role. Throws ForbiddenError if user doesn't have the role.
 * Can be called with requireAuth() result or with user object directly.
 */
export function requireRole(
  userOrCtx: AuthenticatedUser | AuthContext,
  allowedRoles: Role[],
): void {
  const user = 'id' in userOrCtx ? userOrCtx : requireAuth(userOrCtx)

  if (!allowedRoles.includes(user.role)) {
    throw new ForbiddenError(
      `Action requires one of: ${allowedRoles.join(', ')}. Your role: ${user.role}`,
    )
  }
}

/**
 * Require ownership of a resource. Throws ForbiddenError if user doesn't own
 * the resource. Used for IDOR prevention.
 */
export function requireOwnership(
  resourceOwner: string | null | undefined,
  userId: string,
): void {
  if (resourceOwner !== userId) {
    throw new ForbiddenError('You do not have permission to access this resource')
  }
}

/**
 * Require that a user is either the owner or has admin role.
 */
export function requireOwnerOrAdmin(
  resourceOwner: string | null | undefined,
  ctx: AuthContext,
): AuthenticatedUser {
  const user = requireAuth(ctx)

  if (resourceOwner !== user.id && user.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have permission to access this resource')
  }

  return user
}

// ── Filtering Helpers (for IDOR prevention) ───────────────────────────────────

/**
 * Filter an array of items to only include those owned by the user.
 * Used for query results to ensure users can only see their own data.
 */
export function filterByUser<T extends { userId?: string | null }>(
  items: T[],
  userId: string,
): T[] {
  return items.filter((item) => item.userId === userId)
}

/**
 * Filter an array of items to only include those owned by the owner.
 * Alternative naming for clarity when ownerId is the field name.
 */
export function filterByOwner<T extends { ownerId?: string | null }>(
  items: T[],
  ownerId: string,
): T[] {
  return items.filter((item) => item.ownerId === ownerId)
}

/**
 * Filter an array of items to only include those accessible by the user
 * (owned by user OR user is admin). Used for admin endpoints.
 */
export function filterByUserOrAdmin<T extends { userId?: string | null }>(
  items: T[],
  user: AuthenticatedUser,
): T[] {
  if (user.role === 'ADMIN') {
    return items
  }
  return items.filter((item) => item.userId === user.id)
}

// ── tRPC Middleware Factory ───────────────────────────────────────────────────

import type { MiddlewareFunction } from '@trpc/server'

/**
 * Create a tRPC middleware that enforces role requirements.
 * Usage: .use(requireRoleMiddleware(['ADMIN', 'CLIENT']))
 */
export function requireRoleMiddleware(allowedRoles: Role[]): MiddlewareFunction {
  return async ({ ctx, next }) => {
    try {
      requireRole(ctx, allowedRoles)
    } catch (error) {
      if (error instanceof NotAuthenticatedError) {
        throw new Error('UNAUTHORIZED')
      }
      if (error instanceof ForbiddenError) {
        throw new Error('FORBIDDEN')
      }
      throw error
    }
    return next()
  }
}

/**
 * Create a tRPC middleware that enforces ownership of a resource.
 * Usage: .use(requireOwnershipMiddleware('userId'))
 */
export function requireOwnershipMiddleware(ownerField: string) {
  return async ({ ctx, next, input }: any) => {
    try {
      requireAuth(ctx)
      const resourceOwner = (input as Record<string, unknown>)?.[ownerField]
      if (resourceOwner) {
        requireOwnership(
          typeof resourceOwner === 'string' ? resourceOwner : undefined,
          ctx.user!.id,
        )
      }
    } catch (error) {
      if (error instanceof NotAuthenticatedError) {
        throw new Error('UNAUTHORIZED')
      }
      if (error instanceof ForbiddenError) {
        throw new Error('FORBIDDEN')
      }
      throw error
    }
    return next()
  }
}

// ── Admin Authorization ───────────────────────────────────────────────────────

/**
 * Require admin role. Convenience wrapper around requireRole.
 */
export function requireAdmin(ctx: AuthContext): AuthenticatedUser {
  return requireRole(ctx, ['ADMIN'])
}

// ── Payment/Escrow Authorization ─────────────────────────────────────────────

/**
 * Check if a user can create escrow (only CLIENT or ADMIN).
 */
export function canCreateEscrow(ctx: AuthContext): AuthenticatedUser {
  return requireRole(ctx, ['CLIENT', 'ADMIN'])
}

/**
 * Check if a user can release escrow (owner or ADMIN).
 */
export function canReleaseEscrow(
  escrowClientUserId: string | null | undefined,
  ctx: AuthContext,
): AuthenticatedUser {
  return requireOwnerOrAdmin(escrowClientUserId, ctx)
}

/**
 * Check if a user can refund escrow (owner or ADMIN).
 */
export function canRefundEscrow(
  escrowClientUserId: string | null | undefined,
  ctx: AuthContext,
): AuthenticatedUser {
  return requireOwnerOrAdmin(escrowClientUserId, ctx)
}

// ── Bounty Template Authorization ─────────────────────────────────────────────

/**
 * Check if a user can modify a bounty template (owner or system template).
 * System templates have createdByUserId === null and are read-only.
 */
export function canModifyTemplate(
  templateCreatedBy: string | null | undefined,
  userId: string,
): boolean {
  // System templates (null creator) are read-only
  if (templateCreatedBy === null) {
    return false
  }
  // User can modify if they are the creator
  return templateCreatedBy === userId
}

/**
 * Require permission to modify a bounty template.
 */
export function requireModifyTemplatePermission(
  templateCreatedBy: string | null | undefined,
  ctx: AuthContext,
): AuthenticatedUser {
  const user = requireAuth(ctx)

  // System templates (null creator) are read-only
  if (templateCreatedBy === null) {
    throw new ForbiddenError('Cannot modify system templates')
  }

  if (templateCreatedBy !== user.id) {
    throw new ForbiddenError('You do not have permission to modify this template')
  }

  return user
}

// ── KYC Authorization ─────────────────────────────────────────────────────────

/**
 * Check if a user can view KYC submissions (ADMIN only).
 */
export function canViewKycSubmissions(ctx: AuthContext): AuthenticatedUser {
  return requireRole(ctx, ['ADMIN'])
}

/**
 * Check if a user can approve/reject KYC submissions (ADMIN only).
 */
export function canReviewKyc(ctx: AuthContext): AuthenticatedUser {
  return requireRole(ctx, ['ADMIN'])
}

// ── Dispute Authorization ─────────────────────────────────────────────────────

/**
 * Check if a user can view disputes (ADMIN only).
 */
export function canViewDisputes(ctx: AuthContext): AuthenticatedUser {
  return requireRole(ctx, ['ADMIN'])
}

/**
 * Check if a user can resolve disputes (ADMIN only).
 */
export function canResolveDisputes(ctx: AuthContext): AuthenticatedUser {
  return requireRole(ctx, ['ADMIN'])
}
