# SEP-24 Transaction Tracking (Issue #1548)

## Overview

SEP-24 transactions are now persisted in the database with full status history for timeline display. This provides:

- **Durable status tracking** — Transactions survive page refreshes and server restarts
- **Status timeline** — Complete history of all status changes
- **Polling with backoff** — Automatic status updates from anchors
- **Callback support** — Anchors can push updates via webhooks

## Data Model

### Sep24Transaction

```prisma
model Sep24Transaction {
  id                   String        @id @default(cuid())
  userId               String
  anchorId             String        @unique  // Anchor's transaction ID
  transferServer       String         // Anchor's TRANSFER_SERVER URL
  kind                 Sep24Kind
  assetCode            String
  amountIn             String?
  amountOut            String?
  amountFee            String?
  status               Sep24Status   @default(pending_user_transfer_start)
  message              String?       @db.Text
  moreInfoUrl          String?       @db.Text
  stellarTransactionId String?
  externalTransactionId String?
  startedAt            DateTime      @default(now())
  completedAt          DateTime?
  lastPolledAt         DateTime?
  pollCount            Int           @default(0)
  staleAt              DateTime?
  statusHistory        Sep24StatusEntry[]
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt
}
```

### Sep24StatusEntry

```prisma
model Sep24StatusEntry {
  id          String        @id @default(cuid())
  transaction Sep24Transaction @relation(...)
  status      Sep24Status
  message     String?       @db.Text
  metadata    Json?         // Debug context
  createdAt   DateTime      @default(now())
}
```

## Status Enum

```prisma
enum Sep24Status {
  incomplete
  pending_user_transfer_start  // ← User needs to send funds
  pending_user_transfer_complete
  pending_external
  pending_anchor
  pending_stellar
  pending_trust
  pending_user
  completed
  refunded
  expired
  no_market
  too_small
  too_large
  error
}
```

## API Endpoints

### POST /api/payments/sep24

Starts a new SEP-24 transaction and persists it to the database.

**Request body:**
```json
{
  "recipientAddress": "G...",
  "amount": 100,
  "description": "Deposit USDC",
  "memo": "optional"
}
```

**Response:**
```json
{
  "id": "anchor-tx-id",
  "url": "https://anchor.example.com/interactive?tx=..."
}
```

### GET /api/payments/sep24

Lists all SEP-24 transactions for the authenticated user.

**Query params:**
- `limit` (default: 20)
- `offset` (default: 0)

**Response:**
```json
{
  "transactions": [...],
  "meta": {
    "limit": 20,
    "offset": 0,
    "count": 1
  }
}
```

### GET /api/payments/sep24/[id]

Fetches a single transaction with full status history.

**Response:**
```json
{
  "id": "db-tx-id",
  "anchorId": "anchor-tx-123",
  "status": "completed",
  "statusHistory": [
    {
      "id": "status-1",
      "status": "pending_user_transfer_start",
      "message": "Send funds to anchor",
      "createdAt": "2024-11-19T..."
    },
    {
      "id": "status-2",
      "status": "completed",
      "message": null,
      "createdAt": "2024-11-19T..."
    }
  ],
  ...
}
```

### POST /api/payments/sep24/[id]/poll

Manually triggers a poll for status updates (used when user sends funds).

**Response:**
```json
{
  "id": "db-tx-id",
  "status": "pending_anchor",
  "statusHistory": [...]
}
```

### POST /api/payments/sep24/callback

Anchor webhook endpoint for push notifications.

**Request body:**
```json
{
  "transaction": {
    "id": "anchor-tx-123",
    "status": "pending_user_transfer_start",
    "message": "...",
    "more_info_url": "...",
    "amount_in": "100",
    "amount_out": "99.50",
    "amount_fee": "0.50",
    ...
  }
}
```

## Polling Service

### Background Job

Run the poller as a background job:

```bash
node server/jobs/sep24-poller.js
```

**Environment:**
- `DATABASE_URL` - PostgreSQL connection
- `SEP24_AUTH_TOKEN` - SEP-10 JWT
- `SEP24_POLL_INTERVAL` - polling interval (default: 60000ms)
- `SEP24_BATCH_SIZE` - max transactions per run (default: 100)

### Polling Strategy

- **Initial interval:** 3 seconds
- **Exponential backoff:** 3s, 6s, 12s, 24s, 48s, 96s, 192s
- **Max attempts:** 7 before giving up
- **Stale threshold:** 72 hours without status change

### Stopping Conditions

Polling stops when:
1. Status is terminal (`completed`, `refunded`, `expired`, `error`, etc.)
2. Max poll count reached (100 attempts)
3. 72 hours elapsed since start
4. Abort signal received (popup closed)

## UI Components

### Sep24Timeline

Displays a complete timeline of status changes:

```tsx
import { Sep24Timeline } from '@/components/payments/sep24-timeline'

<Sep24Timeline transaction={transaction} onRetry={startFlow} />
```

**Features:**
- Visual timeline with status dots
- Hover cards with metadata
- Retry button for failed transactions
- Link to anchor window when needed
- Stellar transaction link when available

## Testing

### Unit Tests

```bash
pnpm test -- sep24-service
pnpm test -- sep24-poller
```

### Integration Tests

```bash
pnpm test:integration -- sep24
```

### E2E Tests

```bash
pnpm test:e2e -- sep24
```

## Migration

Run the migration to add the new tables:

```bash
pnpm prisma migrate dev --name add_sep24_transaction_tracking
```

Or if using Docker:

```bash
docker compose -f docker-compose.test.yml up -d
pnpm prisma migrate deploy
```

## Monitoring

### Metrics to Track

1. **Poll success rate** — % of successful polls vs failures
2. **Average poll time** — Time to reach terminal status
3. **Stale transactions** — Count of transactions marked stale
4. **Anchor errors** — Frequency of anchor-specific errors

### Logs to Monitor

```
[sep24] Polling X transactions
[sep24] Transaction tx-123 reached terminal status: completed
[sep24] Failed to poll tx-456: 502
[sep24] Marked X transactions as stuck
```

## Security Considerations

1. **Authorization** — Users can only access their own transactions
2. **Rate limiting** — Manual polls require 5 second cooldown
3. **Timeout** — 30 second fetch timeout prevents hanging
4. **Signature validation** — Optional webhook signature check

## Future Enhancements

- [ ] Webhook retry logic (exponential backoff)
- [ ] Transaction cancellation (user-initiated)
- [ ] Anchor switching (failover to backup anchor)
- [ ] Batch polling for performance
- [ ] Prometheus metrics integration

## Related Issues

- Original SEP-24 issue: #1393
- Status persistence: #1548