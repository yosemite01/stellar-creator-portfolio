# Admin Role-Based Access Control

## Overview

Admin access is now granular with four role tiers instead of binary admin/non-admin. This implements the **principle of least privilege** - support staff can't approve payouts, finance staff can't modify users, etc.

## Role Hierarchy

```
SUPPORT (1) < MODERATOR (2) < FINANCE (3) < SUPERADMIN (4)
```

Higher roles automatically inherit all permissions from lower roles.

## Permission Matrix

| Action | SUPPORT | MODERATOR | FINANCE | SUPERADMIN |
|--------|---------|-----------|---------|------------|
| View reports | ✓ | ✓ | - | ✓ |
| View analytics | - | ✓ | ✓ | ✓ |
| Manage users | - | ✓ | - | ✓ |
| Moderate content | - | ✓ | - | ✓ |
| Resolve disputes | - | ✓ | - | ✓ |
| Manage payouts | - | - | ✓ | ✓ |
| Verify on-chain | - | - | ✓ | ✓ |
| System config | - | - | - | ✓ |
| View audit log | - | ✓ | ✓ | ✓ |
| Anchor audit chain | - | - | - | ✓ |

## Role Definitions

### SUPPORT
- **Purpose**: Customer support, content flagging
- **Can**: View all reports, view analytics
- **Cannot**: Suspend users, approve payouts, modify system
- **Use case**: Support staff handling user complaints

### MODERATOR
- **Purpose**: Content and community moderation
- **Can**: All SUPPORT actions + user management, dispute resolution
- **Cannot**: Approve payouts, change system config
- **Use case**: Community managers, content moderators

### FINANCE
- **Purpose**: Payout processing and financial operations
- **Can**: View reports, analytics, manage payouts, verify on-chain
- **Cannot**: Modify users, manage content
- **Use case**: Finance team, payout processors

### SUPERADMIN
- **Purpose**: Platform administration and configuration
- **Can**: All actions including system configuration
- **Cannot**: None (full access)
- **Use case**: Platform owners, technical admins

## Permission Checks

### In Service Layer (Server)

```typescript
import { requireFinanceRole, requireSuperadminRole } from '@/server/services/permissions';

// Require FINANCE role or higher
await requireFinanceRole();

// Require SUPERADMIN role
await requireSuperadminRole();
```

### In Admin Actions

```typescript
import { canApprovePayout } from '@/server/services/permissions';

const canApprove = await canApprovePayout(userId);
if (!canApprove) {
  throw new Error('Forbidden');
}
```

### In Client Components

```typescript
import { useCanManagePayouts } from '@/lib/hooks/admin-permissions';

const canManagePayouts = useCanManagePayouts();

if (canManagePayouts) {
  return <PayoutApprover />;
}
```

## Step-Up Authentication

Money-moving actions (payout approvals, account suspensions) require **step-up authentication** using WebAuthn:

```typescript
await requireStepUpAuthentication(userId, 'PAYOUT_APPROVAL');
```

This requires users to re-authenticate with their hardware security key before sensitive operations.

## Migration from Binary Roles

### Database Migration

The existing `Role` enum in the database has `ADMIN` which maps to `SUPERADMIN`:

| Old Role | New Role |
|----------|----------|
| `ADMIN`  | `SUPERADMIN` |
| `USER`   | Not an admin role |

### Code Changes

Update any existing admin checks:

```typescript
// Before
const isAdmin = session.user.role === 'ADMIN';

// After
const { role } = await getAdminSession();
const isSuperadmin = role === 'SUPERADMIN';
const canManagePayouts = role === 'FINANCE' || role === 'SUPERADMIN';
```

## Testing

### Test Permission Matrix

| User Role | Action | Expected Result |
|-----------|--------|-----------------|
| SUPPORT | View reports | ✓ Allowed |
| SUPPORT | Manage payouts | ✗ Forbidden |
| MODERATOR | View reports | ✓ Allowed |
| MODERATOR | Manage payouts | ✗ Forbidden |
| FINANCE | Manage payouts | ✓ Allowed |
| SUPERADMIN | All actions | ✓ Allowed |

### Test Commands

```bash
# Run permission tests
pnpm test server/services/permissions.test.ts
pnpm test lib/hooks/admin-permissions.test.ts
```

## Security Considerations

1. **Least Privilege**: Each role has minimal necessary permissions
2. **Defense in Depth**: Multiple layers of permission checks
3. **Audit Trail**: All admin actions are logged with user identity
4. **Step-Up Auth**: Sensitive operations require additional verification
5. **No Self-Privilege**: Users cannot promote/suspend themselves

## References

- [Principle of Least Privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege)
- [WebAuthn](https://www.w3.org/TR/webauthn/)
- [RBAC](https://en.wikipedia.org/wiki/Role-based_access_control)