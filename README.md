# Stellar Creator Portfolio

A platform for creators to manage bounties, portfolio projects, and Stellar-based payments.

## Features

- Bounty marketplace with automated matching
- Portfolio showcase with rich-text editor
- SEP-24 compliant deposit/withdrawal via anchors
- Escrow with deadlock prevention
- KYC verification workflow
- Real-time notifications
- Multi-factor authentication

## Documentation

- [Sep-24 Transaction Tracking](docs/Sep24TransactionTracking.md) - Full documentation for SEP-24 persistence and polling
- [IPFS Multi-Provider Redundancy & Health Monitoring](docs/IPFS_REDUNDANCY.md) - Redundant pinning, gateway racing, CID verification, and auto-repin sweeps
- [Adaptive Media Pipeline](docs/MEDIA_PIPELINE.md) - HLS ABR transcoding, thumbnails/posters, progress tracking, and CloudFront signed URLs
- [RSC Migration & Performance Metrics](docs/rsc-migration-metrics.md) - React Server Components architecture, cache tags, and performance benchmarks
- [Wallet & Payment Accessibility](docs/ACCESSIBILITY_PAYMENTS.md) - WCAG 2.2 AA keyboard, focus trap, live region, and Playwright axe audit guide
- [Architecture Overview](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)

## Getting Started

### Prerequisites

- Node.js 22+
- PostgreSQL
- Docker (for local development)

### Installation

```bash
# Clone the repository
git clone https://github.com/yosemite01/stellar-creator-portfolio.git
cd stellar-creator-portfolio

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local
# Fill in DATABASE_URL, SEP24_ANCHOR_DOMAIN, etc.

# Run migrations
pnpm prisma generate
pnpm prisma migrate deploy

# Start development server
pnpm dev
```

### Running Tests

```bash
# Unit tests
pnpm test

# Integration tests
pnpm test:integration

# E2E tests
pnpm test:e2e

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Docker

```bash
# Start local development stack
docker compose -f docker-compose.yml up -d

# Run migrations in Docker
docker compose -f docker-compose.yml exec app pnpm prisma migrate deploy
```

## Configuration

### SEP-24 Anchor

Configure your SEP-24 anchor in `.env.local`:

```env
SEP24_ANCHOR_DOMAIN=testanchor.stellar.org
SEP24_ASSET_CODE=USDC
SEP24_AUTH_TOKEN=your-sep10-jwt
```

### SEP-24 Poller

Run the background poller:

```bash
node server/jobs/sep24-poller.js
```

Or use Docker:

```bash
docker compose -f docker-compose.yml up -d sep24-poller
```

### Tracing (OpenTelemetry)

The Next.js app and the Rust backend share a single OpenTelemetry setup so traces
stitch together across service boundaries.

**Shared resource attributes** — both services emit the same resource keys so a
trace can be filtered consistently in the collector and dashboards:

| Attribute | Next.js | Rust |
| --- | --- | --- |
| `service.name` | `OTEL_SERVICE_NAME` (default `stellar-creator-portfolio`) | `OTEL_SERVICE_NAME` (default `stellar-creator-backend`) |
| `service.version` | `OTEL_SERVICE_VERSION` / build version | `OTEL_SERVICE_VERSION` / crate version |
| `deployment.environment` | `OTEL_ENVIRONMENT` (default `development`) | `OTEL_ENVIRONMENT` (default `development`) |

**Propagators** — both services use the W3C `tracecontext` + `baggage`
propagators. Outgoing requests from Next.js inject `traceparent`/`tracestate`,
and the Rust backend extracts them, so a single trace spans both runtimes.

**Sampling** — a single `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` pair
controls sampling for both services (default: `parentbased_traceidratio` with
`OTEL_TRACES_SAMPLER_ARG=0.1`). Because both use parent-based sampling, the
sampling decision made at the edge is honored by downstream services.

**Collector** — point both services at the same OTLP endpoint via
`OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4317`). The collector
receives spans from both runtimes and forwards them to the configured backend.

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=stellar-creator-portfolio
OTEL_ENVIRONMENT=development
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
```

## Project Structure

```
.
├── app/                    # Next.js app router pages
│   ├── api/               # API routes
│   │   └── payments/      # Payment-related endpoints
│   │       └── sep24/     # SEP-24 endpoints
│   └── ...
├── components/            # React components
│   └── payments/          # Payment UI components
├── lib/                   # Business logic
│   └── stellar/           # Stellar protocol implementations
├── prisma/                # Database schema & migrations
├── server/                # Backend services
│   └── jobs/              # Background jobs
└── docs/                  # Documentation
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.