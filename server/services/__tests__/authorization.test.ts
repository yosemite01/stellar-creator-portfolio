import { describe, it, expect, beforeEach } from 'vitest'
import {
  requireAuth,
  requireRole,
  requireOwnership,
  requireOwnerOrAdmin,
  requireModifyTemplatePermission,
  canCreateEscrow,
  canReleaseEscrow,
  canRefundEscrow,
  canViewKycSubmissions,
  canViewDisputes,
  NotAuthenticatedError,
  ForbiddenError,
  type AuthContext,
  type AuthenticatedUser,
} from '../authorization'

// ── Mock Data ─────────────────────────────────────────────────────────────────

function createUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'USER',
    ...overrides,
  }
}

function createAuthContext(user?: AuthenticatedUser | null): AuthContext {
  return { user }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('returns authenticated user', () => {
    const user = createUser()
    const result = requireAuth(createAuthContext(user))
    expect(result).toEqual(user)
  })

  it('throws NotAuthenticatedError when user is null', () => {
    expect(() => requireAuth(createAuthContext(null))).toThrow(NotAuthenticatedError)
  })

  it('throws NotAuthenticatedError when user is undefined', () => {
    expect(() => requireAuth(createAuthContext())).toThrow(NotAuthenticatedError)
  })

  it('defaults role to USER when not present', () => {
    const user = createUser({ role: undefined as unknown as 'USER' })
    const result = requireAuth(createAuthContext(user))
    expect(result.role).toBe('USER')
  })
})

describe('requireRole', () => {
  const adminUser = createUser({ role: 'ADMIN' })
  const clientUser = createUser({ role: 'CLIENT' })
  const creatorUser = createUser({ role: 'CREATOR' })

  it('allows authorized role (authenticated user)', () => {
    expect(() => requireRole(adminUser, ['ADMIN', 'CLIENT'])).not.toThrow()
    expect(() => requireRole(clientUser, ['ADMIN', 'CLIENT'])).not.toThrow()
  })

  it('allows authorized role (context)', () => {
    expect(() => requireRole(createAuthContext(adminUser), ['ADMIN', 'CLIENT'])).not.toThrow()
    expect(() => requireRole(createAuthContext(clientUser), ['ADMIN', 'CLIENT'])).not.toThrow()
  })

  it('throws ForbiddenError when role not in allowed list', () => {
    expect(() => requireRole(creatorUser, ['ADMIN'])).toThrow(ForbiddenError)
    expect(() => requireRole(creatorUser, ['ADMIN'])).toThrow(
      'Action requires one of: ADMIN. Your role: CREATOR',
    )
  })

  it('throws ForbiddenError when context has no user', () => {
    expect(() => requireRole(createAuthContext(), ['ADMIN'])).toThrow(ForbiddenError)
  })
})

describe('requireOwnership', () => {
  it('allows owner to access resource', () => {
    expect(() => requireOwnership('user-123', 'user-123')).not.toThrow()
  })

  it('throws ForbiddenError when user is not owner', () => {
    expect(() => requireOwnership('user-456', 'user-123')).toThrow(ForbiddenError)
    expect(() => requireOwnership('user-456', 'user-123')).toThrow(
      'You do not have permission to access this resource',
    )
  })

  it('allows null resource owner (for backwards compatibility)', () => {
    expect(() => requireOwnership(null, 'user-123')).toThrow(ForbiddenError)
  })
})

describe('requireOwnerOrAdmin', () => {
  const adminUser = createUser({ role: 'ADMIN' })
  const regularUser = createUser({ role: 'USER' })

  it('allows owner to access resource', () => {
    const result = requireOwnerOrAdmin('user-123', createAuthContext(regularUser))
    expect(result).toEqual(regularUser)
  })

  it('allows admin to access any resource', () => {
    const result = requireOwnerOrAdmin('user-456', createAuthContext(adminUser))
    expect(result).toEqual(adminUser)
  })

  it('throws ForbiddenError when user is not owner and not admin', () => {
    expect(() =>
      requireOwnerOrAdmin('user-456', createAuthContext(regularUser)),
    ).toThrow(ForbiddenError)
  })
})

describe('requireModifyTemplatePermission', () => {
  const user = createUser()
  const adminUser = createUser({ role: 'ADMIN' })

  it('allows owner to modify template', () => {
    const result = requireModifyTemplatePermission('user-123', createAuthContext(user))
    expect(result).toEqual(user)
  })

  it('throws ForbiddenError for system templates (null creator)', () => {
    expect(() =>
      requireModifyTemplatePermission(null, createAuthContext(user)),
    ).toThrow(ForbiddenError)
    expect(() =>
      requireModifyTemplatePermission(null, createAuthContext(user)),
    ).toThrow('Cannot modify system templates')
  })

  it('throws ForbiddenError when user is not owner', () => {
    expect(() =>
      requireModifyTemplatePermission('user-456', createAuthContext(user)),
    ).toThrow(ForbiddenError)
    expect(() =>
      requireModifyTemplatePermission('user-456', createAuthContext(user)),
    ).toThrow('You do not have permission to modify this template')
  })

  it('throws ForbiddenError when context is not authenticated', () => {
    expect(() =>
      requireModifyTemplatePermission('user-123', createAuthContext()),
    ).toThrow(NotAuthenticatedError)
  })
})

describe('canCreateEscrow', () => {
  it('allows CLIENT to create escrow', () => {
    expect(() => canCreateEscrow(createAuthContext({ role: 'CLIENT' }))).not.toThrow()
  })

  it('allows ADMIN to create escrow', () => {
    expect(() => canCreateEscrow(createAuthContext({ role: 'ADMIN' }))).not.toThrow()
  })

  it('throws ForbiddenError for other roles', () => {
    expect(() => canCreateEscrow(createAuthContext({ role: 'CREATOR' }))).toThrow(
      ForbiddenError,
    )
    expect(() => canCreateEscrow(createAuthContext({ role: 'USER' }))).toThrow(
      ForbiddenError,
    )
  })
})

describe('canReleaseEscrow', () => {
  const user = createUser()

  it('allows owner to release escrow', () => {
    const result = canReleaseEscrow('user-123', createAuthContext(user))
    expect(result).toEqual(user)
  })

  it('allows ADMIN to release escrow', () => {
    const adminUser = createUser({ role: 'ADMIN' })
    const result = canReleaseEscrow('user-456', createAuthContext(adminUser))
    expect(result).toEqual(adminUser)
  })

  it('throws ForbiddenError when user is not owner and not admin', () => {
    expect(() => canReleaseEscrow('user-456', createAuthContext(user))).toThrow(
      ForbiddenError,
    )
  })
})

describe('canRefundEscrow', () => {
  const user = createUser()

  it('allows owner to refund escrow', () => {
    const result = canRefundEscrow('user-123', createAuthContext(user))
    expect(result).toEqual(user)
  })

  it('allows ADMIN to refund escrow', () => {
    const adminUser = createUser({ role: 'ADMIN' })
    const result = canRefundEscrow('user-456', createAuthContext(adminUser))
    expect(result).toEqual(adminUser)
  })

  it('throws ForbiddenError when user is not owner and not admin', () => {
    expect(() => canRefundEscrow('user-456', createAuthContext(user))).toThrow(
      ForbiddenError,
    )
  })
})

describe('canViewKycSubmissions', () => {
  it('allows ADMIN to view KYC submissions', () => {
    expect(() =>
      canViewKycSubmissions(createAuthContext({ role: 'ADMIN' })),
    ).not.toThrow()
  })

  it('throws ForbiddenError for non-ADMIN users', () => {
    expect(() =>
      canViewKycSubmissions(createAuthContext({ role: 'USER' })),
    ).toThrow(ForbiddenError)
    expect(() =>
      canViewKycSubmissions(createAuthContext({ role: 'CLIENT' })),
    ).toThrow(ForbiddenError)
    expect(() =>
      canViewKycSubmissions(createAuthContext({ role: 'CREATOR' })),
    ).toThrow(ForbiddenError)
  })
})

describe('canViewDisputes', () => {
  it('allows ADMIN to view disputes', () => {
    expect(() =>
      canViewDisputes(createAuthContext({ role: 'ADMIN' })),
    ).not.toThrow()
  })

  it('throws ForbiddenError for non-ADMIN users', () => {
    expect(() =>
      canViewDisputes(createAuthContext({ role: 'USER' })),
    ).toThrow(ForbiddenError)
    expect(() =>
      canViewDisputes(createAuthContext({ role: 'CLIENT' })),
    ).toThrow(ForbiddenError)
    expect(() =>
      canViewDisputes(createAuthContext({ role: 'CREATOR' })),
    ).toThrow(ForbiddenError)
  })
})
