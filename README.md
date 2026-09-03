# Tamgora

A full-stack platform connecting non-technical tech professionals (designers, writers, marketers, PMs) with bounties, clients, and collaborators — powered by Stellar/Soroban smart contracts.

## Live Contracts — Stellar Testnet

The canonical contracts (`backend/contracts/`: `bounty`, `escrow`, `freelancer`,
`governance`, `oracle`, `identity`) are built, tested, and deployed to testnet
automatically by CI on every push to `main`
([`deploy-contracts.yml`](.github/workflows/deploy-contracts.yml)). Their
addresses are generated per deploy and published as that run's
`contracts-testnet-<sha>` GitHub Actions artifact rather than pinned here —
check the latest successful run of that workflow for the current addresses.

The table below is a one-time manual testnet deployment of the **legacy
top-level** `contracts/` tree (see the note below) — still live as of this
writing, but not what CI builds or what the rest of the platform integrates
against:

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
| Smart Contracts | Rust + Soroban SDK 23.5.3 (`backend/contracts/`, canonical); the legacy top-level `contracts/` tree still pins 21.7.7 |
| Rust API | Actix-web |
| Mobile | React Native (Expo) |
| Payments | Stripe |
| Storage | AWS S3 |
| Monitoring | Sentry, OpenTelemetry |

## Project Structure

```
├── app/              # Next.js 15 App Router pages & API routes
├── components/       # React UI components
├── lib/              # Utilities, clients, services
├── prisma/           # Database schema & migrations
├── contracts/
│   ├── escrow/       # Payment escrow with milestone releases
│   ├── vault/        # Multi-vault batch withdrawal
│   ├── amm/          # Constant-product AMM (x*y=k)
│   ├── analytics/    # On-chain event analytics
│   └── core/         # Dispute arbitration, storage TTL, simulation
├── backend/          # Rust API services
│   └── contracts/    # Canonical Soroban contracts (see note below)
├── mobile/           # React Native app (Expo)
└── .husky/           # Git hooks (TS check, secret scan, size limit)
```

> **Note on the two `contracts/` directories:** this repo has Soroban contract
> code in both the top-level `contracts/` and `backend/contracts/`, including
> overlapping names (`core`, `escrow`). **`backend/contracts/` is canonical.**
> It's the workspace declared in `backend/Cargo.toml`, it's what CI actually
> builds and tests (`cd backend && cargo test --all-features`), and its
> implementations are substantially more complete — e.g. `backend/contracts/escrow`
> is ~1,800 lines vs. ~430 in the top-level equivalent, and `backend/contracts/core`
> is a full contract vs. a 5-line stub at the top level. The top-level `contracts/`
> tree is not referenced by any workspace member list or CI job; treat it as
> legacy/scaffold code pending removal or migration, not as a second deployment
> target.
>
> Additionally, three top-level contracts have **no equivalent in `backend/contracts/` at all**:
> `contracts/amm` (constant-product AMM), `contracts/vault` (multi-vault batch withdrawal),
> and `contracts/analytics` (on-chain event analytics). These exist only at the top level
> and are likewise not built or tested by CI.

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

Build and deploy contracts to testnet:

```bash
cd contracts/escrow
stellar contract build           # produces wasm32v1-none WASM
stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source <your-key-name> \
  --network testnet
```

Set the returned contract ID as `CONTRACT_ID` in your `.env.local`.

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
4. Looking for open work? [`IMPLEMENTATION_NOTES.md`](./IMPLEMENTATION_NOTES.md) tracks partially-scoped backlog items (e.g. STT integration, escrow slippage protection, OCR KYC) with implementation specs already written out

## License

MIT
