# Stellar Creator Portfolio

A full-stack platform connecting non-technical tech professionals (designers, writers, marketers, PMs) with bounties, clients, and collaborators — powered by Stellar/Soroban smart contracts.

## Live Contracts — Stellar Testnet

| Contract | Address |
|---|---|
| Escrow | `CDDVR4DXPPYYH43OVBVUVK2V7A4NPNN6DAJJ7QFPRB53LMK3XK4U4D76` |
| Vault | `CA23KXIQGCGMBITUT7IZCTQWMMO3A2PDIZXCL4FS7KZHS6FEMGUY4Y6U` |
| AMM | `CD2733NB3EKZQFS7BDFWVS4W7QOQ4IX5EVY5PTPCHLPMRBW7UBSPWFHD` |
| Analytics | `CAZNWED5SCKMPIOSU274DCHLFRGGFZLQNMCWXWNAO3HF5RY2PMPIODWA` |

View on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet).

Network passphrase: `Test SDF Network ; September 2015`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui |
| Auth | NextAuth.js |
| Database | PostgreSQL via Prisma ORM (Supabase recommended) |
| Smart Contracts | Rust + Soroban SDK 21.7.7 |
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
├── mobile/           # React Native app (Expo)
└── .husky/           # Git hooks (TS check, secret scan, size limit)
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Rust + `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- Stellar CLI 27+ (`cargo install --locked stellar-cli`)
- PostgreSQL (or a Supabase project)

### Frontend

```bash
pnpm install
cp .env.example .env.local   # fill in required values
pnpm dev                      # http://localhost:3000
pnpm build                    # production build
```

### Required environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (PgBouncer pooler) |
| `DIRECT_DATABASE_URL` | Direct Postgres URL (Prisma migrate only) |
| `NEXTAUTH_SECRET` | Random secret for NextAuth |
| `NEXTAUTH_URL` | App URL (http://localhost:3000 in dev) |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` or `mainnet` |

See `.env.example` for the full list.

### Database setup

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

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
