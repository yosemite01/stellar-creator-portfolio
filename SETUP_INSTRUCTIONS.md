# Setup Instructions for SEP-24 Transaction Tracking

## Prerequisites

Before running this implementation, ensure:

1. **Node.js 22+** is installed
2. **pnpm** is installed (recommended: `npm install -g pnpm`)
3. **PostgreSQL** is running (local or remote)
4. **Docker** is installed (for local development)

## Installation Steps

### 1. Install Dependencies

```bash
cd c:\Users\Pkaka\desktop\stellar-wave-5-peace\stellar-creator-portfolio
pnpm install
```

**Note:** This may take several minutes as it downloads and installs all packages.

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env.local
```

Fill in the required values:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/yourdb

# SEP-24 Anchor
SEP24_ANCHOR_DOMAIN=testanchor.stellar.org
SEP24_ASSET_CODE=USDC
SEP24_AUTH_TOKEN=your-sep10-jwt

# Optional: SEP-24 Poller
SEP24_POLL_INTERVAL=60000
SEP24_BATCH_SIZE=100
SEP24_CALLBACK_SECRET=your-webhook-secret
```

### 3. Run Migrations

Generate Prisma client and run migrations:

```bash
# Generate Prisma client
pnpm prisma generate

# Run migrations to create SEP-24 tables
pnpm prisma migrate dev --name add_sep24_transaction_tracking
```

**Or use Docker for local development:**

```bash
# Start database
docker compose -f docker-compose.yml up -d postgres

# Wait for DB to be ready, then run migrations
pnpm prisma migrate deploy
```

### 4. Run the Poller

**Option A: Manual background process**

```bash
# Run the poller
node server/jobs/sep24-poller.js
```

**Option B: Docker Compose**

Add to `docker-compose.yml`:

```yaml
sep24-poller:
  build:
    context: .
    dockerfile: Dockerfile.app
  environment:
    - DATABASE_URL=${DATABASE_URL}
    - SEP24_AUTH_TOKEN=${SEP24_AUTH_TOKEN}
    - SEP24_POLL_INTERVAL=${SEP24_POLL_INTERVAL:-60000}
    - SEP24_BATCH_SIZE=${SEP24_BATCH_SIZE:-100}
  command: node server/jobs/sep24-poller.js
  restart: unless-stopped
```

### 5. Configure Anchor Webhook

Set the callback URL in your anchor's configuration:

```
https://your-domain.com/api/payments/sep24/callback
```

### 6. Verify Setup

**Check database tables exist:**

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('Sep24Transaction', 'Sep24StatusEntry');
```

**Check migration:**

```bash
pnpm prisma migrate status
```

### 7. Test the Flow

1. Start the development server:
   ```bash
   pnpm dev
   ```

2. Navigate to a page that uses SEP-24 (e.g., deposits page)

3. Start a SEP-24 transaction

4. Verify in the UI:
   - Transaction appears in the timeline
   - Status updates as you interact with the anchor
   - Status history is preserved

## Running Tests

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

### Type Check

```bash
pnpm typecheck
```

### Lint

```bash
pnpm lint
```

## Troubleshooting

### Migration Fails

**Error:** `DATABASE_URL` not found

**Solution:**
- Check `.env.local` exists
- Run `pnpm prisma generate` first
- Ensure database is running

### Poller Doesn't Start

**Error:** `Could not authenticate with the anchor`

**Solution:**
- Verify `SEP24_AUTH_TOKEN` is valid
- Check anchor allows your IP/domain
- Ensure SEP-10 JWT is correctly signed

### UI Doesn't Show Timeline

**Error:** Transaction not found

**Solution:**
- Check database has SEP-24 transactions
- Verify `userId` matches authenticated user
- Check API response for errors

### Polls Failing

**Error:** `502 Bad Gateway`

**Solution:**
- Check anchor is reachable
- Verify `TRANSFER_SERVER` URL is correct
- Review anchor logs for issues

## Production Deployment

### 1. Run Migrations

```bash
pnpm prisma migrate deploy
```

### 2. Start Poller

Use a process manager like PM2:

```bash
pm2 start server/jobs/sep24-poller.js \
  --name sep24-poller \
  --output /var/log/sep24-poller.log \
  --error /var/log/sep24-poller-error.log
```

### 3. Configure Monitoring

Set up logs and metrics:
- Webhook callbacks: `/api/payments/sep24/callback`
- Poller logs: `server/jobs/sep24-poller.ts`
- Transaction status: `GET /api/payments/sep24/[id]`

### 4. Health Check

Create a health check endpoint that verifies:
- Database connection
- SEP-24 tables exist
- Poller is running
- Webhook is responding

## Security Checklist

- [ ] `SEP24_AUTH_TOKEN` is not committed to version control
- [ ] `SEP24_CALLBACK_SECRET` is strong and unique
- [ ] Database credentials use least-privilege accounts
- [ ] Webhook signature validation is enabled
- [ ] Rate limiting is configured
- [ ] SSL/TLS is enabled for production

## Monitoring

### Logs to Watch

```
[sep24] Polling X transactions
[sep24] Transaction tx-123 reached terminal status: completed
[sep24] Failed to poll tx-456: 502
[sep24] Marked X transactions as stuck
```

### Metrics to Track

1. **Poll success rate** - % successful polls vs failures
2. **Average poll time** - Time to reach terminal status
3. **Stale transactions** - Count of stuck transactions
4. **Anchor errors** - Frequency of anchor-specific errors
5. **Webhook delivery** - Success rate of callback requests

## Next Steps

After setup is complete:

1. Test a real deposit/withdrawal
2. Verify status updates appear in the UI
3. Check status history is preserved
4. Monitor logs for issues
5. Set up alerting for failures