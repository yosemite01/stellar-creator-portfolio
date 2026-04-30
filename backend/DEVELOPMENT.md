# Backend Development Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | 1.81+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Stellar CLI | latest | `cargo install stellar-cli --locked` |
| Docker & Compose | latest | https://docs.docker.com/get-docker/ |
| pnpm | latest | `npm i -g pnpm` |

## First-time Setup

```bash
# 1. Install Rust clippy component
rustup component add clippy

# 2. Add the Soroban/WASM target (for contract builds)
rustup target add wasm32-unknown-unknown

# 3. Copy environment config
cp backend/.env.example backend/.env
# Edit backend/.env with your local values

# 4. Install frontend dependencies
pnpm install
```

## Building

```bash
# Build entire workspace (services + contracts)
cd backend
cargo build

# Build contracts only (WASM output)
cargo build --target wasm32-unknown-unknown --release \
  -p stellar-bounty-contract \
  -p stellar-escrow-contract \
  -p stellar-freelancer-contract \
  -p stellar-governance-contract
```

## Running Tests

```bash
# All workspace tests
cd backend
cargo test

# Single contract
cargo test -p stellar-bounty-contract

# API service tests only
cargo test -p stellar-api
```

## Linting (required before PR)

```bash
# From repo root
pnpm run backend:clippy
pnpm run smart-contract:clippy

# Or run everything at once
pnpm run cli-checks
```

## Running Locally

### Infrastructure only (postgres + redis)

```bash
cd backend
docker compose up postgres redis -d
```

### API service

```bash
cd backend
cargo run --bin stellar-api
# Listening on http://localhost:3001
```

### Full stack

```bash
cd backend
docker compose up
# API:     http://localhost:3001
# pgAdmin: http://localhost:5050  (admin@stellar.dev / admin)
# PG:      localhost:5432
# Redis:   localhost:6379
```

## Contract Deployment

```bash
# Deploy bounty contract to testnet
stellar contract deploy \
  --network testnet \
  --source <your-account-name> \
  --wasm backend/target/wasm32-unknown-unknown/release/stellar_bounty_contract.wasm

# Copy the returned contract ID into backend/.env → BOUNTY_CONTRACT_ID
```

Repeat for `escrow`, `freelancer`, and `governance` contracts.

## Project Structure

```
backend/
├── contracts/
│   ├── bounty/        # Bounty lifecycle (create, apply, complete)
│   ├── escrow/        # Payment escrow with release conditions
│   ├── freelancer/    # Freelancer registry & ratings
│   └── governance/    # Platform config & DAO proposals
├── services/
│   ├── api/           # Actix-web REST API (port 3001)
│   ├── auth/          # JWT authentication service
│   ├── notifications/ # Email / push notification service
│   └── indexer/       # Soroban event indexer → PostgreSQL
├── .env.example       # Environment variable reference
├── clippy.toml        # Workspace clippy configuration
├── Cargo.toml         # Workspace manifest
└── docker-compose.yml # Full local stack
```

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `STELLAR_NETWORK` | `testnet` \| `futurenet` \| `mainnet` |
| `STELLAR_RPC_URL` | Soroban RPC endpoint |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `BOUNTY_CONTRACT_ID` | Deployed bounty contract address |

## CI/CD

GitHub Actions runs on every push/PR to `main`:

1. Frontend lint (`pnpm run frontend:orbit-check`)
2. Backend clippy (`pnpm run backend:clippy`)
3. Smart contract clippy (`pnpm run smart-contract:clippy`)

See `.github/workflows/cli-checks.yml`.
