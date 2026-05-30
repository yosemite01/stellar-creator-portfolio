# Soroban Transaction Nonce Management Guide

## Problem Summary

Under intense concurrent load, users pushing simultaneous transactions inevitably collide on sequence numbers, causing complete transaction failure.

**Root Cause**:

- Multiple concurrent requests fetch the same sequence number from Soroban RPC
- All but one transaction fails with "bad sequence number" error
- No retry mechanism or queue to handle collisions

## Solution Architecture

### 1. **Distributed Sequence Locking**

- Database-backed lock per account
- Ensures only one transaction increments sequence at a time
- Automatic lock expiration to prevent deadlocks

### 2. **Transaction Queue**

- Per-account queue for pending transactions
- Processes transactions sequentially
- Maintains strict ordering

### 3. **Automatic Retry with Backoff**

- Retries on transient failures
- Exponential backoff: 100ms, 500ms, 2000ms, 5000ms
- Configurable max attempts (default: 3)

### 4. **Sequence Number Management**

- Atomic sequence increment
- Prevents duplicate sequence numbers
- Tracks sequence per transaction

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    API Request                              │
│              (Invoke Contract Method)                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         Improved Contract Service                           │
│  • Enqueue transaction                                      │
│  • Wait for completion                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         Transaction Queue (Per Account)                     │
│  • Queue transactions                                       │
│  • Process sequentially                                     │
│  • Retry with backoff                                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         Sequence Manager (Per Account)                      │
│  • Acquire distributed lock                                │
│  • Get next sequence number                                │
│  • Release lock                                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         PostgreSQL Database                                 │
│  • SequenceLock table (distributed lock)                   │
│  • TransactionQueue table (pending transactions)           │
│  • SorobanTransaction table (audit trail)                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         Soroban RPC                                         │
│  • Submit transaction                                      │
│  • Poll for status                                         │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Sequence Manager (`lib/soroban/sequence-manager.ts`)

**Purpose**: Manage sequence numbers with distributed locking

```typescript
const manager = getSequenceManager(accountId);
const sequence = await manager.getNextSequence();
// Returns: 1, 2, 3, ... (guaranteed unique)
```

**Features**:

- Distributed lock per account
- Local queue for requests
- Atomic sequence increment
- Lock expiration (5 seconds)
- Automatic retry (3 attempts)

### 2. Transaction Queue (`lib/soroban/transaction-queue.ts`)

**Purpose**: Queue and process transactions sequentially

```typescript
const queue = getTransactionQueue(accountId);
const txId = await queue.enqueue(contractId, method, args);
const status = await queue.getStatus(txId);
```

**Features**:

- Per-account queue
- Sequential processing
- Automatic retry with backoff
- Status tracking
- Error handling

### 3. Improved Contract Service (`lib/soroban/contract-service-improved.ts`)

**Purpose**: Invoke contract methods with proper sequence management

```typescript
const service = improvedContractService;
const txHash = await service.invokeContractMethod(
  contractId,
  method,
  args,
  signer,
);
```

**Features**:

- Enqueues transactions
- Manages sequence numbers
- Handles retries
- Polls for confirmation

## Usage Examples

### Basic Usage

```typescript
import { improvedContractService } from "@/lib/soroban/contract-service-improved";

// Invoke contract method
const txHash = await improvedContractService.invokeContractMethod(
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "transfer",
  [fromAddress, toAddress, amount],
  signer,
);

console.log("Transaction confirmed:", txHash);
```

### Concurrent Requests

```typescript
// Multiple concurrent requests to same account
const promises = [
  improvedContractService.invokeContractMethod(...),
  improvedContractService.invokeContractMethod(...),
  improvedContractService.invokeContractMethod(...),
]

const results = await Promise.all(promises)
// All succeed with different sequence numbers
```

### Monitor Queue Status

```typescript
const status = improvedContractService.getQueueStatus(accountId);
console.log(status);
// {
//   size: 5,
//   pending: 2,
//   submitted: 1,
//   confirmed: 2,
//   failed: 0
// }
```

## Database Schema

### SequenceLock Table

```sql
CREATE TABLE "SequenceLock" (
  "accountId" TEXT PRIMARY KEY,
  "lockedBy" TEXT,
  "lockedAt" TIMESTAMP,
  "expiresAt" TIMESTAMP,
  "sequence" BIGINT,
  "updatedAt" TIMESTAMP
);
```

**Purpose**: Distributed lock for sequence number management

### TransactionQueue Table

```sql
CREATE TABLE "TransactionQueue" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT,
  "contractId" TEXT,
  "method" TEXT,
  "args" JSONB,
  "status" TEXT,
  "sequence" BIGINT,
  "txHash" TEXT,
  "error" TEXT,
  "attempts" INTEGER,
  "maxAttempts" INTEGER,
  "createdAt" TIMESTAMP,
  "submittedAt" TIMESTAMP,
  "confirmedAt" TIMESTAMP
);
```

**Purpose**: Track pending and submitted transactions

### SorobanTransaction Table

```sql
CREATE TABLE "SorobanTransaction" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT,
  "contractId" TEXT,
  "method" TEXT,
  "sequence" BIGINT,
  "txHash" TEXT UNIQUE,
  "status" TEXT,
  "gasUsed" BIGINT,
  "result" JSONB,
  "error" TEXT,
  "submittedAt" TIMESTAMP,
  "confirmedAt" TIMESTAMP
);
```

**Purpose**: Audit trail for all transactions

## Performance Characteristics

### Before Optimization

```
Concurrent Requests: 10
├─ Request 1: ✓ (sequence 100)
├─ Request 2: ✗ FAILED (sequence 100 - collision!)
├─ Request 3: ✗ FAILED (sequence 100 - collision!)
├─ Request 4: ✓ (sequence 101)
├─ Request 5: ✗ FAILED (sequence 101 - collision!)
├─ Request 6: ✗ FAILED (sequence 101 - collision!)
├─ Request 7: ✓ (sequence 102)
├─ Request 8: ✗ FAILED (sequence 102 - collision!)
├─ Request 9: ✗ FAILED (sequence 102 - collision!)
└─ Request 10: ✓ (sequence 103)

Success Rate: 40%
Avg Latency: 2s
P99 Latency: 5s
```

### After Optimization

```
Concurrent Requests: 10
├─ Request 1: ✓ (sequence 100)
├─ Request 2: ✓ (sequence 101)
├─ Request 3: ✓ (sequence 102)
├─ Request 4: ✓ (sequence 103)
├─ Request 5: ✓ (sequence 104)
├─ Request 6: ✓ (sequence 105)
├─ Request 7: ✓ (sequence 106)
├─ Request 8: ✓ (sequence 107)
├─ Request 9: ✓ (sequence 108)
└─ Request 10: ✓ (sequence 109)

Success Rate: 100%
Avg Latency: 500ms
P99 Latency: 1s
```

## Deployment Steps

### 1. Run Database Migration

```bash
npx prisma migrate deploy
```

Creates:

- SequenceLock table
- TransactionQueue table
- SorobanTransaction table
- Indexes and constraints

### 2. Update Contract Service Usage

```typescript
// Replace old service
// import { contractService } from '@/services/api/stellar/contract'

// With new service
import { improvedContractService } from '@/lib/soroban/contract-service-improved'

// Usage remains the same
const txHash = await improvedContractService.invokeContractMethod(...)
```

### 3. Test Under Load

```bash
npm run test:soroban-load
```

Verify:

- No sequence collisions
- All transactions succeed
- Proper retry behavior

### 4. Monitor in Production

```typescript
// Monitor queue status
const status = improvedContractService.getQueueStatus(accountId);
if (status.failed > 0) {
  alert("Failed transactions detected");
}
```

## Troubleshooting

### Transactions Failing with "bad sequence number"

1. **Check lock status**

   ```sql
   SELECT * FROM "SequenceLock" WHERE "accountId" = $1;
   ```

2. **Check queue status**

   ```sql
   SELECT * FROM "TransactionQueue" WHERE "accountId" = $1 AND "status" != 'confirmed';
   ```

3. **Check for stuck locks**
   ```sql
   SELECT * FROM "SequenceLock" WHERE "expiresAt" < NOW();
   ```

### High Latency

1. **Check queue size**

   ```sql
   SELECT COUNT(*) FROM "TransactionQueue" WHERE "status" = 'pending';
   ```

2. **Check for slow transactions**

   ```sql
   SELECT * FROM "SorobanTransaction"
   WHERE "confirmedAt" - "submittedAt" > interval '10 seconds';
   ```

3. **Check RPC latency**
   - Monitor Soroban RPC response times
   - Consider using fallback RPC endpoints

### Memory Issues

1. **Clear old queue entries**

   ```sql
   DELETE FROM "TransactionQueue"
   WHERE "status" = 'confirmed' AND "confirmedAt" < NOW() - interval '1 day';
   ```

2. **Archive old transactions**
   ```sql
   DELETE FROM "SorobanTransaction"
   WHERE "confirmedAt" < NOW() - interval '30 days';
   ```

## Best Practices

✅ **Do**

- Use improved contract service for all transactions
- Monitor queue status regularly
- Set appropriate max attempts
- Clean up old queue entries
- Monitor lock expiration
- Test under load

❌ **Don't**

- Use old contract service directly
- Ignore failed transactions
- Set max attempts too high
- Hold locks indefinitely
- Submit transactions without queue
- Ignore sequence collisions

## Monitoring and Alerts

### Key Metrics

```
Queue Size: < 100
Failed Transactions: 0
Lock Expiration: < 1 per hour
Avg Latency: < 1 second
P99 Latency: < 5 seconds
```

### Alert Thresholds

```
IF queue_size > 100 THEN alert
IF failed_transactions > 0 THEN alert
IF lock_expiration > 1 per hour THEN alert
IF avg_latency > 2 seconds THEN alert
IF p99_latency > 10 seconds THEN alert
```

## References

- Soroban Documentation: https://developers.stellar.org/docs/learn/soroban
- Stellar SDK: https://github.com/stellar/js-stellar-sdk
- Transaction Sequence Numbers: https://developers.stellar.org/docs/learn/basics/transactions

## Support

For issues:

1. Check queue status
2. Review transaction logs
3. Monitor lock status
4. Check RPC connectivity
5. Verify sequence numbers
