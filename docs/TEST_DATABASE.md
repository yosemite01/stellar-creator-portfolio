# Test Database & Integration Testing Guide

## Overview

Integration tests run against a real PostgreSQL instance with all Prisma migrations applied, rather than mocked database drivers. This catches schema drift, foreign key constraint violations, atomic transaction race conditions, and raw SQL issues before deployment.

## Architecture

- **Docker Compose Service (`docker-compose.test.yml`)**:
  - Image: `postgres:16-alpine`
  - Default Port: `5433` (mapped from container `5432` to avoid conflicts with local dev databases)
  - Storage: In-memory `tmpfs` mounted at `/var/lib/postgresql/data` for maximum I/O performance and test speed.
- **Vitest Global Setup (`tests/integration/setup/global-setup.ts`)**:
  - Automatically verifies PostgreSQL connectivity before test execution.
  - Deploys Prisma migrations using `prisma migrate deploy`.
- **Parallel Isolation (`tests/integration/setup/test-db.ts`)**:
  - Uses a dedicated PostgreSQL schema per Vitest worker (`worker_${poolId}`).
  - Fast table truncation (`TRUNCATE TABLE ... CASCADE`) runs before each test to guarantee determinism.

## Quick Start / Operating Instructions

### 1. Start the test database:
```bash
pnpm run db:test:up
```

### 2. Run the integration test suite:
```bash
pnpm run test:integration
```

### 3. Stop and clean up the test database:
```bash
pnpm run db:test:down
```

## Environment Variables

- `TEST_DATABASE_URL`: Connection string for the integration test database. Defaults to `postgresql://postgres:postgres@localhost:5433/test_db`.

## CI Pipeline Integration

In GitHub Actions (`.github/workflows/ci.yml`), integration tests run in a dedicated step using the GitHub Actions PostgreSQL service container:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: test_db
    ports:
      - 5433:5432
    options: >-
      --health-cmd "pg_isready -U postgres -d test_db"
      --health-interval 3s
      --health-timeout 3s
      --health-retries 5
```

## Troubleshooting

- **Port in use (5433)**: Ensure no other container or process is bound to port 5433 (`lsof -i :5433`).
- **Connection refused**: Check that Docker is running and run `docker logs stellar-postgres-test`.
