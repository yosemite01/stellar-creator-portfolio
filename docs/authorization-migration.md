# Authorization Migration Guide

## Overview

Authorization logic has been centralized into `server/services/authorization.ts` to eliminate duplication between tRPC and REST API endpoints.

## New Authorization Service

All authorization checks should now use the primitives in `server/services/authorization.ts`:

```typescript
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
} from '@/server/services/authorization'
```

### Core Functions

| Function | Description |
|----------|-------------|
| `requireAuth(ctx)` | Require authentication. Throws `NotAuthenticatedError` if no user. |
| `requireRole(user, roles)` | Require user has one of the allowed roles. Throws `ForbiddenError` if not authorized. |
| `requireOwnership(owner, userId)` | Require user owns the resource. Throws `ForbiddenError` if not owner. |
| `requireOwnerOrAdmin(owner, ctx)` | Require user is owner OR admin. Throws `ForbiddenError` if neither. |
| `canCreateEscrow(ctx)` | Check if user can create escrow (CLIENT or ADMIN only). |
| `canReleaseEscrow(escrow.clientUserId, ctx)` | Check if user can release escrow (owner or ADMIN). |
| `canRefundEscrow(escrow.clientUserId, ctx)` | Check if user can refund escrow (owner or ADMIN). |
| `canViewKycSubmissions(ctx)` | Check if user can view KYC (ADMIN only). |
| `canViewDisputes(ctx)` | Check if user can view disputes (ADMIN only). |
| `requireModifyTemplatePermission(templateCreatedBy, ctx)` | Require permission to modify template (owner only, system templates read-only). |

## REST Route Migration

### Before (Duplicated Authorization)
```typescript
import { getServerSession } from '@/lib/auth/auth'

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  
  // ... use session.user.id throughout
}
```

### After (Centralized Authorization)
```typescript
import { getServerSession } from '@/lib/auth/auth'
import { requireAuth, requireAdmin } from '@/server/services/authorization'

export async function GET() {
  const session = await getServerSession()
  const user = requireAdmin({ user: session?.user })
  
  // ... use user.id throughout
}
```

## Migration Checklist

- [x] Created `server/services/authorization.ts` with centralized primitives
- [x] Created policy tests in `server/services/__tests__/authorization.test.ts`
- [x] Updated `app/api/notifications/route.ts`
- [x] Updated `app/api/bounty-templates/route.ts`
- [x] Updated `app/api/payments/route.ts`
- [x] Updated `app/api/admin/kyc/route.ts`
- [x] Updated `app/api/admin/disputes/route.ts`
- [x] Updated `app/api/onboarding/route.ts`
- [x] Updated `app/api/creators/profile/route.ts`
- [x] Updated `app/api/feature-flags/evaluate/route.ts`
- [x] Updated `app/api/analytics/route.ts`
- [x] Updated `app/api/profile/completion/route.ts`
- [x] Updated `app/api/search/hybrid/route.ts`
- [x] Updated `app/api/messages/route.ts`
- [ ] Update tRPC router to use `requireRoleMiddleware`
- [ ] Update remaining REST routes
- [ ] Update documentation in `README.md`
- [ ] Add deprecation warnings to duplicate operations

## API Documentation

### `requireAuth(ctx: AuthContext): AuthenticatedUser`

Requires the caller to be authenticated.

**Parameters:**
- `ctx` - Auth context with optional `user` field

**Returns:** Authenticated user object with `id`, `email`, `name`, `role`

**Throws:**
- `NotAuthenticatedError` - If user is not present in context

### `requireRole(userOrCtx: AuthenticatedUser | AuthContext, allowedRoles: Role[]): void`

Requires the user to have one of the allowed roles.

**Parameters:**
- `userOrCtx` - Authenticated user object or auth context
- `allowedRoles` - Array of allowed role strings (e.g., `['ADMIN', 'CLIENT']`)

**Throws:**
- `ForbiddenError` - If user's role is not in allowed list

### `requireOwnership(resourceOwner: string | null | undefined, userId: string): void`

Requires the user to own the resource.

**Parameters:**
- `resourceOwner` - The owner ID of the resource
- `userId` - The authenticated user's ID

**Throws:**
- `ForbiddenError` - If user is not the owner

### `requireOwnerOrAdmin(resourceOwner: string | null | undefined, ctx: AuthContext): AuthenticatedUser`

Requires the user to either own the resource OR be an admin.

**Parameters:**
- `resourceOwner` - The owner ID of the resource
- `ctx` - Auth context with user

**Returns:** Authenticated user

**Throws:**
- `ForbiddenError` - If user is neither owner nor admin

## Testing

Run the authorization tests:

```bash
pnpm test server/services/__tests__/authorization.test.ts
```

## Breaking Changes

None - the new authorization service is additive. Existing code continues to work while new code should use the centralized service.

## Rollback Plan

If issues are discovered, the old authorization code in individual routes can be re-enabled. The new code does not modify any database schemas or data structures.

## Support

For questions about authorization, see:
- `server/services/authorization.ts` - Implementation
- `docs/architecture.md` - System architecture
- `README.md` - Project overview
