# Tamper-Evident Audit Log with Hash Chain

## Overview

The audit log now uses a hash chain to provide tamper-evident logging. Any attempt to modify, delete, or insert entries will break the chain and be detectable.

## Architecture

### Hash Chain Mechanism

Each audit entry contains:
- `entryHash`: SHA-256 hash of all entry fields + `prevHash`
- `prevHash`: SHA-256 hash of the previous entry's `entryHash` (null for first entry)

```
Entry 1: hash(data₁ + prevHash=null)
Entry 2: hash(data₂ + hash(Entry 1))
Entry 3: hash(data₃ + hash(Entry 2))
...
```

### Database Protection

PostgreSQL triggers ensure:
1. **Auto-compute hashes**: `entryHash` and `prevHash` are computed on insert
2. **Prevent modifications**: UPDATE operations raise an exception
3. **Prevent deletions**: DELETE operations raise an exception

### Stellar Anchoring

The chain head hash is periodically anchored on the Stellar blockchain:
- Uses `manage_data` operation with key `audit_chain_head`
- Provides cryptographic proof of existence at a specific time
- Transaction hash is stored in the audit entry's `anchoredAt` field

## Usage

### Writing Audit Logs

```typescript
import { writeAuditLog } from '@/server/services/audit';

await writeAuditLog({
  userId: 'user123',
  resource: 'bounty',
  action: 'create',
  resourceId: 'bounty-456',
  payload: { title: 'New bounty' },
});
```

The hash chain fields are computed automatically by the database trigger.

### Verifying Chain Integrity

```typescript
import { verifyAuditChain } from '@/server/services/audit';

const result = await verifyAuditChain();
if (!result.isValid) {
  console.log('Tampered entries:', result.tamperedEntries);
}
```

### Admin UI

The admin audit page (`/admin/audit`) shows:
- Chain verification status (lock icon = verified)
- Tampered entry warnings
- Stellar anchoring status

### CLI Tool

```bash
# Verify chain integrity
node scripts/verify-audit-chain.mjs

# Verify and anchor on Stellar
node scripts/verify-audit-chain.mjs --anchor

# Output as JSON for CI
node scripts/verify-audit-chain.mjs --json
```

### Scheduled Anchoring

Run periodically (e.g., hourly via cron):

```bash
# Cron example (run hourly)
0 * * * * cd /path/to/project && node scripts/audit-anchoring.mjs
```

## Verification

The chain is verified by:
1. Checking `isTampered` flag (set by database on detected tampering)
2. Verifying `prevHash` chain continuity
3. Recomputing each entry's `entryHash` and comparing

## Database Schema

```sql
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "entryHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AuditLog" ADD COLUMN "isTampered" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "AuditLog" ADD COLUMN "anchoredAt" TIMESTAMPTZ;
```

## Migration

Apply the migration:

```bash
npx prisma migrate deploy
```

## Testing

```bash
# Run audit service tests
pnpm test server/services/audit.test.ts

# Verify chain integrity
node scripts/verify-audit-chain.mjs
```

## Security Considerations

1. **Hash Function**: SHA-256 provides collision resistance
2. **Database Triggers**: Prevent SQL injection or direct DB modifications
3. **Admin Access**: Only authorized admins can anchor to Stellar
4. **Anchoring Frequency**: Balance between security and Stellar costs

## References

- [Stellar SEP-47: manage_data](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0047.md)
- [PostgreSQL Triggers](https://www.postgresql.org/docs/current/triggers.html)
- [Hash Chain Cryptography](https://en.wikipedia.org/wiki/Hash_chain)