# Load Testing Suite

Load tests for all Tamgora services using [k6](https://k6.io/).

## Prerequisites

```bash
# Install k6
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker
docker pull grafana/k6
```

## Structure

```
load-tests/
├── config/
│   └── options.js          # Shared k6 options/thresholds
├── helpers/
│   └── auth.js             # Auth token helpers
├── scenarios/
│   ├── auth.test.js        # Auth endpoints
│   ├── bounties.test.js    # Bounties API
│   ├── creators.test.js    # Creators API
│   ├── users.test.js       # Users API
│   ├── reviews.test.js     # Reviews API
│   ├── messages.test.js    # Messages API
│   ├── analytics.test.js   # Analytics API
│   ├── referrals.test.js   # Referrals API
│   ├── upload.test.js      # Upload API
│   └── rust-api.test.js    # Rust backend API (port 3001)
├── smoke.test.js               # Quick smoke test (all services)
├── stress.test.js              # Stress test (ramp to breaking point)
├── soak.test.js                # Soak test (sustained load over time)
├── spike.test.js               # Sudden burst of traffic (flash-crowd simulation)
├── sequence-collision.test.js  # Issue #838: 50 concurrent Soroban tx submissions,
│                                # no sequence collisions — POSTs to /api/soroban/enqueue,
│                                # which does not exist yet (see docs/SOROBAN_SEQUENCE_MANAGEMENT.md)
└── README.md
```

## Running Tests Locally

Load tests hit a running instance of the app, so start the services first — k6 does not
boot them for you.

1. **Start the Next.js frontend** (in one terminal, from the repo root):
   ```bash
   pnpm dev
   # Ready on http://localhost:3000
   ```

2. **Start the Rust backend** (in a second terminal), if the scenario you're running
   touches `rust-api.test.js` or any endpoint proxied to it:
   ```bash
   cd backend && cargo run
   # Listening on http://localhost:3001
   ```

3. **Have a test user available.** Auth-flow scenarios (`auth.test.js`, and anything
   using `getSessionCookie()` from `helpers/auth.js`) log in with credentials from the
   `TEST_EMAIL` / `TEST_PASSWORD` env vars, defaulting to `test@example.com` /
   `TestPassword123!` (see [Environment Variables](#environment-variables) below). Seed
   a user with those credentials in your local database, or pass your own via `-e`.

4. **Run a test** (in a third terminal, from the repo root):
   ```bash
   k6 run load-tests/smoke.test.js
   ```

   A healthy run ends with a summary like this — all checks near 100% and thresholds
   marked with a checkmark:
   ```
   █ THRESHOLDS

     checks
     ✓ 'rate>0.95' rate=100.00%

     http_req_duration
     ✓ 'p(95)<500' p(95)=42.3ms
     ✓ 'p(99)<1000' p(99)=78.1ms

   █ TOTAL RESULTS

     checks_total.......: 48      9.6/s
     checks_succeeded...: 100.00% 48 out of 48
     checks_failed......: 0.00%   0 out of 48
   ```
   If `checks_failed` is non-zero or a threshold shows a ✗, re-check that both services
   from steps 1–2 are running and reachable at the URLs in
   [Environment Variables](#environment-variables).

### Other Test Types

```bash
# Individual service tests
k6 run load-tests/scenarios/bounties.test.js
k6 run load-tests/scenarios/creators.test.js
k6 run load-tests/scenarios/auth.test.js

# Stress test
k6 run load-tests/stress.test.js

# Soak test (long-running)
k6 run load-tests/soak.test.js

# With custom base URL
k6 run -e BASE_URL=https://staging.example.com load-tests/smoke.test.js

# With HTML report (requires k6-reporter)
k6 run --out json=results.json load-tests/smoke.test.js
```

There are no `load:*` scripts in `package.json` — run `k6 run load-tests/<file>` directly,
as above.

## Environment Variables

| Variable       | Default                  | Description              |
|----------------|--------------------------|--------------------------|
| `BASE_URL`     | `http://localhost:3000`  | Next.js frontend URL     |
| `RUST_API_URL` | `http://localhost:3001`  | Rust backend API URL     |
| `TEST_EMAIL`   | `test@example.com`       | Test user email          |
| `TEST_PASSWORD`| `TestPassword123!`       | Test user password       |

## Performance Thresholds

- p95 response time < 500ms
- p99 response time < 1000ms
- Error rate < 1%
- All checks pass > 95%
