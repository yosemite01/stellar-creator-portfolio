# Load Testing Suite

Load tests for all Stellar Creator Portfolio services using [k6](https://k6.io/).

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
├── smoke.test.js           # Quick smoke test (all services)
├── stress.test.js          # Stress test (ramp to breaking point)
├── soak.test.js            # Soak test (sustained load over time)
└── README.md
```

## Running Tests

```bash
# Smoke test — quick sanity check
k6 run load-tests/smoke.test.js

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
