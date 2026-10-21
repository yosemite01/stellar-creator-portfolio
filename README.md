# Tamgora

[![CI](https://github.com/yosemite01/stellar-creator-portfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/yosemite01/stellar-creator-portfolio/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/yosemite01/stellar-creator-portfolio/branch/main/graph/badge.svg)](https://codecov.io/gh/yosemite01/stellar-creator-portfolio)

A full-stack platform connecting non-technical tech professionals (designers, writers, marketers, PMs) with bounties, clients, and collaborators — powered by Stellar/Soroban smart contracts.


## Live Contracts — Stellar Testnet

The canonical contracts (`backend/contracts/`: `bounty`, `escrow`, `freelancer`,
`governance`, `oracle`, `identity`) are built, tested, and deployed to testnet
automatically by CI on every push to `main`
([`deploy-contracts.yml`](.github/workflows/deploy-contracts.yml)). Each deploy
commits the current addresses and WASM hashes to
**[`deployments/testnet.json`](./deployments/testnet.json)**, which the app reads.
See [`docs/deployments.md`](./docs/deployments.md) for the schema and runbook.
Error codes and events for every canonical contract are catalogued in
[`docs/contracts.md`](./docs/contracts.md), including the not-yet-deployed
`insurance` and `stellar_insights` (reputation) crates.

> **Historical — legacy testnet addresses.** The table below is a one-time
> manual testnet deployment of the **legacy top-level** `contracts/` tree.
> That tree has since been archived (source preserved at commit `734cff58`;
> see [ADR 0003](./docs/adr/0003-legacy-contracts-tree-archived.md) and
> [#1552](./docs/issues/1552-legacy-contracts-tree.md) for the rationale).
> These contracts are still live on testnet as of this writing, but nothing
> in the platform integrates against them — do not wire against these
> addresses. The canonical escrow lives in `backend/contracts/escrow` and is
> deployed by CI.

| Contract | Address |
|---|---|
| Escrow (`contracts/escrow`, legacy) | `CDDVR4DXPPYYH43OVBVUVK2V7A4NPNN6DAJJ7QFPRB53LMK3XK4U4D76` |
| Vault | `CA23KXIQGCGMBITUT7IZCTQWMMO3A2PDIZXCL4FS7KZHS6FEMGUY4Y6U` |
| AMM | `CD2733NB3EKZQFS7BDFWVS4W7QOQ4IX5EVY5PTPCHLPMRBW7UBSPWFHD` |
| Analytics | `CAZNWED5SCKMPIOSU274DCHLFRGGFZLQNMCWXWNAO3HF5RY2PMPIODWA` |

View on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet).

Network passphrase: `Test SDF Network ; September 2015`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui |
| Auth | NextAuth.js |
| Database | PostgreSQL via Prisma ORM (Supabase recommended) |
| Smart Contracts | Rust + Soroban SDK 23.5.3 (`backend/contracts/`), one SDK version across the repo |
| Rust API | Actix-web |
| Mobile | React Native (Expo) |
| Payments | Stripe |
| Storage | AWS S3 |
| Monitoring | Sentry, OpenTelemetry |

**TypeScript clients** for the contracts are generated into
[`packages/contracts-ts`](./packages/contracts-ts/README.md).

## Project Structure

```
├── app/              # Next.js App Router: pages and API routes only
├── components/       # React components, grouped by feature
│   ├── ui/           #   shadcn/ui primitives
│   ├── layout/       #   header, footer, sidebars, layout provider
│   ├── providers/    #   app-wide context providers (tRPC, session, i18n, motion)
│   └── <feature>/    #   bounties, reviews, payments, wallet, analytics, ...
├── hooks/            # React hooks
├── lib/              # Framework-agnostic helpers, clients and data access
│   ├── db/           #   Prisma + Supabase clients, locking, transactions
│   ├── payments/     #   Stripe, escrow state machine, payment validation
│   ├── storage/      #   S3 object storage, Redis, upload validation
│   └── utils/        #   formatting, validation, class-name helpers
├── server/           # Server-only TypeScript used by the API routes
│   ├── api/          #   tRPC router, context, rate limiting
│   ├── graphql/      #   GraphQL schema, resolvers, context
│   ├── services/     #   audit log, events, KMS, tracing, notifications
│   ├── stellar/      #   Stellar RPC client, contract calls, Soroban indexer
│   └── realtime/     #   standalone websocket servers (collab, signalling)
├── prisma/           # Database schema & migrations
├── __tests__/        # Vitest suites (others sit beside the code they test)
├── e2e/              # Playwright specs
├── backend/          # Rust workspace: API services (no top-level contracts/ — see note below)
│   └── contracts/    #   Canonical Soroban contracts (see note below)
├── mobile/           # React Native app (Expo), with its own toolchain
├── infrastructure/   # Kubernetes, monitoring and AWS configuration
├── helm/             # Helm charts
├── load-tests/       # k6 scenarios
├── scripts/          # Build, deploy and setup scripts
├── docs/             # Backlog, implementation and maintenance notes
└── .husky/           # Git hooks (TS check, secret scan, size limit)
```

> **Legacy `contracts/` tree (archived):** all Soroban contracts live in
> `backend/contracts/`, the workspace in `backend/Cargo.toml`, and build against
> a single `soroban-sdk = "23.5.3"`. The old top-level `contracts/` tree (`amm`,
> `analytics`, `core`, `escrow`, `vault`) pinned soroban-sdk 21.7.7. No workspace
> or CI job built it, so it was removed rather than upgraded. Its source,
> including `amm`, `vault` and `analytics`, which have no `backend/contracts/`
> equivalent and back the legacy testnet addresses above, is preserved in git
> history at commit `734cff58`
> (e.g. `git show 734cff58:contracts/vault/src/lib.rs`). To revive one, port it
> into `backend/contracts/` against SDK 23. The decision and alternatives
> considered are recorded in [ADR 0003](./docs/adr/0003-legacy-contracts-tree-archived.md)
> (see [#1552](./docs/issues/1552-legacy-contracts-tree.md)).

See [`docs/architecture.md`](./docs/architecture.md) for a platform-wide
diagram of how the Next.js app, tRPC/GraphQL/REST, the Rust API, realtime
servers, Soroban contracts, mobile app, and their data stores fit together.

## Observability

### Structured logging

Server code (`app/api/`, `server/`) uses the structured logger in `lib/logger.ts`
instead of `console.log`. Every log line is a JSON object with `time`, `level`,
`msg`, and — when inside a request — `requestId`:

```ts
import { logger } from '@/lib/logger';
logger.info('KYC cleanup complete', { deleted: count });
logger.error('Failed to index creator', { creatorId, err: String(err) });
```

Set the `LOG_LEVEL` environment variable to `debug | info | warn | error`
(defaults to `debug` in development, `info` in production).

### Request IDs

Every inbound HTTP request is assigned an `x-request-id`:

- The middleware reads an existing `x-request-id` header from trusted upstream
  proxies (e.g. Vercel, Cloudflare); if absent, a UUID v4 is generated.
- The ID is echoed back in the response `x-request-id` header.
- The ID is stored in `AsyncLocalStorage` for the lifetime of the request, so
  the logger and Sentry scope include it automatically — no prop-drilling.

Wrap a Next.js Route Handler:

```ts
import { withRequestId } from '@/lib/request-id-middleware';

export const GET = withRequestId(async (req) => {
  return NextResponse.json({ ok: true });
});
```

The `x-request-id` value appears in every Sentry event (`request_id` tag) and
in every structured log line (`requestId` field), making it trivial to
correlate a client error with server-side logs.

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+ (the repo pins `pnpm@10.33.0` via `packageManager`; `corepack enable` picks it up automatically)
- Rust 1.74+ (the workspace MSRV pinned in `backend/Cargo.toml`) + `wasm32v1-none` target:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup target add wasm32v1-none
  ```
- Stellar CLI 27+ (includes Soroban contract CLI):
  ```bash
  cargo install --locked stellar-cli
  stellar --version  # verify: should show v27.0.0 or higher
  ```
  The `--locked` flag ensures reproducible builds by using the exact dependency versions from the lockfile.
- PostgreSQL 16+ (or a Supabase project) — a Docker Compose file is included
  for local development, see [Database setup](#database-setup) below

### Frontend

```bash
pnpm install
cp .env.example .env.local
pnpm dev                      # http://localhost:3000
pnpm build                    # production build
```

### Environment variables

`.env.example` holds around 70 variables covering every integration the project
can use. **You do not need most of them to run the app locally.** Copy it, then
fill in the five below; everything else can stay at its placeholder until you
touch the feature that needs it.

#### The five you must set

| Variable | What to put in it |
|---|---|
| `DATABASE_URL` | Postgres connection string used for runtime queries. Against the bundled Docker Postgres: `postgresql://postgres:postgres@localhost:6432/stellar_portfolio?schema=public&pgbouncer=true&connection_limit=1` |
| `DIRECT_DATABASE_URL` | Same database, **direct port, no pooler** — Prisma Migrate only: `postgresql://postgres:postgres@localhost:5432/stellar_portfolio?schema=public` |
| `NEXTAUTH_SECRET` | Any high-entropy string. Generate one with the command below. |
| `NEXTAUTH_URL` | `http://localhost:3000` in development. Must match the origin you actually browse to, or OAuth callbacks fail. |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` for local work. Only set `mainnet` when deploying against real funds. |

Generate the auth secret:

```bash
openssl rand -base64 32
# → 7Qw1kZ9m0uP4rT8vX2yB5nC6dF3gH1jK4lM7oR0sU9w=
```

Paste that value into `NEXTAUTH_SECRET` in `.env.local`.

#### Two things that catch people out

**`DATABASE_URL` and `DIRECT_DATABASE_URL` are not interchangeable.** The first
goes through PgBouncer on port **6432** for application queries; the second must
bypass the pooler on port **5432** because Prisma Migrate needs a session-mode
connection. Pointing both at the same port produces migrations that hang or fail
with prepared-statement errors.

**`NEXT_PUBLIC_*` variables are baked in at build time,** not read at runtime.
Changing one means restarting `pnpm dev` (or rebuilding); editing `.env.local`
alone will not pick it up. This is also why `NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED`
exists as a separate flag — a client bundle cannot read the server-only
`GOOGLE_CLIENT_ID`, so that mirror has to be kept in sync by hand.

#### Optional groups

Leave these alone unless you are working on the feature in question. Each is
commented in `.env.example` with what it does:

| Group | Variables | Needed for |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase-hosted Postgres and storage |
| Google sign-in | `GOOGLE_CLIENT_*`, `NEXT_PUBLIC_GOOGLE_SIGNIN_ENABLED`, `EXPO_PUBLIC_GOOGLE_*` | "Continue with Google" on web and mobile |
| Stellar RPC | `NEXT_PUBLIC_STELLAR_RPC_*` | Overriding the default testnet/mainnet RPC endpoints |
| Contracts | `CONTRACT_ID`, `STELLAR_ADMIN_SECRET` | On-chain escrow and the KYC review flow |
| Key management | `KMS_PROVIDER`, `KMS_SECRET_PREFIX` | Defaults to `env` locally; `aws` pulls from Secrets Manager |
| Storage | `AWS_*` | S3 uploads |
| Payments | `STRIPE_*` | Stripe checkout and webhooks |
| Paymaster relay | `PAYMASTER_RELAY_ENABLED`, `STELLAR_FEE_ACCOUNT`, `STELLAR_SPONSOR_*`, `STELLAR_FEE_ACCOUNT_MIN_BALANCE` | Fee-bump relay. Callers must be signed in, may only sponsor calls into our contracts (`deployments/<network>.json`) plus any classic ops in `STELLAR_SPONSOR_ALLOWED_OPS`, and are capped by `STELLAR_SPONSOR_DAILY_BUDGET`; sponsoring pauses when the fee account runs low |
| Semantic search | `OPENAI_API_KEY`, `EMBED_*` | `/api/search/vector` and `/api/search/hybrid`. Vector search is rate limited per IP (30/min) or signed-in user (300/min). Also set a usage alert and a hard monthly cap in the OpenAI dashboard |

#### Check it worked

```bash
pnpm exec prisma migrate deploy   # exits 0 once DATABASE_URL/DIRECT_DATABASE_URL are right
pnpm exec prisma generate
pnpm dev
```

`pnpm dev` should print `Ready in …` and serve <http://localhost:3000>. A crash
on boot naming a missing variable means that one still holds its placeholder.

### Database setup

#### Option A — Local Postgres via Docker (recommended)

The fastest way to get a working database is the included Docker Compose file.
It starts Postgres 16, PgBouncer, and (optionally) pgAdmin in a single command.

```bash
cd backend
docker compose up -d postgres   # starts Postgres + PgBouncer
docker compose ps               # verify: postgres should show "healthy"
```

Once running, set these two variables in `.env.local` (the values match the
Docker Compose defaults exactly):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:6432/stellar_portfolio?schema=public&pgbouncer=true&connection_limit=1"
DIRECT_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stellar_portfolio?schema=public"
```

| Variable | Port | Purpose |
|---|---|---|
| `DATABASE_URL` | 6432 (PgBouncer) | Application runtime queries — connection-pooled |
| `DIRECT_DATABASE_URL` | 5432 (Postgres) | Prisma Migrate only — must bypass PgBouncer |

> **Why two ports?** PgBouncer on 6432 multiplexes connections for efficiency,
> but Prisma Migrate needs a raw session-mode connection, so it must hit the
> direct port 5432. Pointing both at the same port causes migrations to hang
> or fail with prepared-statement errors.

#### Option B — Supabase or external Postgres

If you already have a Postgres instance (Supabase, Neon, etc.), use the
connection strings from your provider's dashboard. You still need **two**
URLs — a pooled one for runtime and a direct one for migrations — even if
your provider exposes only a single port.

#### Running migrations and generating the client

```bash
pnpm exec prisma migrate deploy   # applies pending migrations
pnpm exec prisma generate          # generates Prisma Client
```

You should see output similar to:

```
Applying migration(s) ...
Database migration(s) applied successfully
```

If `migrate deploy` fails with `connection refused` or `password auth failed`,
double-check that your Postgres instance is running and the credentials in
`.env.local` match.

#### Seeding demo data (optional)

```bash
pnpm exec prisma db seed
```

Expected output on success:

```
Seeded 2 demo users, 2 profiles, and 1 demo bounty.
```

The seed script creates `creator@example.com`, `client@example.com`, their
matching profiles, and an open design bounty. Records use stable IDs and
`upsert`, so rerunning is safe and never duplicates data. Seeding is for
local development only — verify `.env.local` points to your local database
before running it.

### Smart Contracts

Build and deploy contracts to testnet. CI does this automatically on every
push to `main` (see [`docs/contracts.md`](./docs/contracts.md) for the full
pipeline); the snippet below is for a one-off manual deploy from a
checkout of `backend/contracts/`:

```bash
cd backend/contracts/escrow
cargo build --release --target wasm32v1-none   # produces wasm32v1-none WASM
stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_escrow_contract.wasm \
  --source <your-key-name> \
  --network testnet
```

Set the returned contract ID as `CONTRACT_ID` in your `.env.local`. The
canonical contracts built by CI are listed in
[`backend/Cargo.toml`](./backend/Cargo.toml); workspace members not yet in
the deploy pipeline (`core`, `insurance`, `referral`, `stellar_insights`,
`test-utils`) are documented in [`docs/contracts.md`](./docs/contracts.md).

## Key Features

- **Creator Portfolios** — customizable profiles with projects, testimonials, and social links
- **Bounty Marketplace** — post and apply for short-term projects with on-chain escrow payments
- **Freelancer Directory** — search across 15+ non-technical tech disciplines
- **On-chain Escrow** — milestone-based fund releases via Soroban contracts
- **AMM** — constant-product swap pool for platform tokens
- **Mobile App** — React Native (Expo) companion with infinite scroll, haptics, and offline support
- **Dark/Light Mode** — system-aware theme with manual override

## Supported Disciplines

UI/UX Design · Brand Strategy · Writing · Content Creation · Marketing · Community Management · Product Management · Project Management · Business Development · Data Analysis · Sales · Customer Success · HR & Recruiting · Legal & Compliance

## Deployment

The app uses `output: 'standalone'` (Next.js) and can be deployed to:

- **Vercel** — import the repo, add env vars, deploy
- **Railway / Render / Fly.io** — use the standalone output
- **Docker** — `docker build` with the generated Dockerfile in `.next/standalone`

## Contributing

1. Fork → feature branch → PR against `main`
2. The pre-commit hook runs TypeScript check (warning), secret scan (gitleaks, if installed), and a 10 MB file-size guard
3. Soroban contracts require `overflow-checks = true` in `[profile.release]`
4. Looking for open work? [`docs/IMPLEMENTATION_NOTES.md`](./docs/IMPLEMENTATION_NOTES.md) tracks partially-scoped backlog items (e.g. STT integration, escrow slippage protection, OCR KYC) with implementation specs already written out
5. Deploying or upgrading a Soroban contract? See [`docs/contracts.md`](./docs/contracts.md) for how CI deploys to Testnet/Mainnet, where the resulting contract addresses go, and how to upgrade a live contract safely (48h-timelocked upgrades and two-step admin transfer)
   - What on-chain "verified" means (KYC levels, tiers, social proofs, expiry, revocation): [`docs/identity-verification.md`](./docs/identity-verification.md)
   - Governance vote weighting and proposal snapshots: [`docs/governance-voting.md`](./docs/governance-voting.md)
   - Referral self-referral and loop rules: [`docs/referrals.md`](./docs/referrals.md)
6. Restoring the database or running the quarterly restore drill? Follow [`docs/POSTGRES_RESTORE_RUNBOOK.md`](./docs/POSTGRES_RESTORE_RUNBOOK.md)
7. Freelancer payouts and receipt generation: See [`docs/PAYMENTS.md`](./docs/PAYMENTS.md)
8. Running integration tests against a Docker PostgreSQL instance: See [`docs/TEST_DATABASE.md`](./docs/TEST_DATABASE.md)
9. Playwright multi-context messaging E2E tests: See [`e2e/README.md`](./e2e/README.md)
11. **Messages API identity model** — `POST /api/messages` and the WebSocket endpoint (`GET /api/messages` with `Upgrade: websocket`) now require an authenticated session. Any `senderId`, `userId`, or `moderatorId` field in the request body or WebSocket event payload is **silently ignored**; the server always derives the caller's identity from the session token. Existing clients that relied on supplying identity fields must be updated to omit them (the values were never trusted by the server anyway — this change makes that explicit). The `moderate` event is restricted to users with the `ADMIN` role; non-admin attempts are rejected with a `FORBIDDEN` error and written to the audit log. See [`app/api/messages/message-handler.ts`](./app/api/messages/message-handler.ts) for the full security model and event documentation.
12. **Collab websocket auth** — the Yjs collaboration server (`server/realtime/collab.ts`) now rejects upgrades without a valid token (HTTP 401, or 403 for a token issued for another room). Clients get a 60 second token from `POST /api/collab/token { roomId }`, which requires a session and membership of the bounty behind the room (its owner or an accepted creator), and pass it as `?token=` — `CollaborativeEditor` does this and refreshes it on reconnect. Set `REALTIME_JWT_SECRET` to the same value on the Next.js app and the collab server (required in production; falls back to `NEXTAUTH_SECRET`). `GET`/`POST /api/collab` also require a session.
10. Audit/cleanup decisions for contracts and rate-limiting live in [`docs/issues/`](./docs/issues/) with matching ADRs in [`docs/adr/`](./docs/adr/): [#1552](./docs/issues/1552-legacy-contracts-tree.md) (legacy `contracts/` tree archived — [ADR 0003](./docs/adr/0003-legacy-contracts-tree-archived.md)), [#1553](./docs/issues/1553-stellar-insights-contract.md) (`stellar_insights` → `reputation` rename — [ADR 0004](./docs/adr/0004-stellar-insights-contract-purpose.md)), [#1554](./docs/issues/1554-insurance-contract.md) (`insurance` contract wiring — [ADR 0005](./docs/adr/0005-insurance-contract-status.md)), [#1555](./docs/issues/1555-backend-limit-package.md) (`backend/limit` removal — [ADR 0006](./docs/adr/0006-backend-limit-rate-limiter.md))

## License

MIT

## Handsoff notes

<!-- handsoff-issue-1364 -->
- #1364: [Mobile] Implement specialized Infinite Scrolling structures preserving memory gracefully
