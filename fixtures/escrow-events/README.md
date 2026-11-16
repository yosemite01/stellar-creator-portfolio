# Escrow Events Test Fixtures

Deterministic, versioned test fixtures capturing the full lifecycle of Soroban escrow events. These fixtures are shared across TypeScript (`lib/escrow-events.test.ts`) and Rust (`backend/contracts/escrow`) test suites to prevent contract event and client model drift.

## Directory Structure

```
fixtures/escrow-events/
├── README.md
└── v1/
    └── lifecycle.json    # Canonical testnet lifecycle events
```

## Lifecycle Event Catalog

Each fixture record in `v1/lifecycle.json` models an event emitted by the Soroban escrow contract and consumed by the API/indexer:

| Event Name | Operation | Topics | Key Contract Data | API Response Status |
|---|---|---|---|---|
| `escrow_deposited` | `deposit` | `["escrow", "deposited"]` | `escrowId`, `bountyId`, `payer`, `payee`, `netAmount`, `fee` | `confirmed` |
| `escrow_released` | `release` | `["escrow", "released"]` | `escrowId`, `bountyId`, `payee`, `amount` | `confirmed` |
| `escrow_refunded` | `refund` | `["escrow", "refunded"]` | `escrowId`, `bountyId`, `payer`, `amount` | `confirmed` |
| `escrow_disputed` | `dispute` | `["escrow", "disputed"]` | `escrowId`, `bountyId`, `authorizer`, `expiresAt` | `pending` |
| `escrow_resolved` | `resolve` | `["escrow", "resolved"]` | `escrowId`, `bountyId`, `recipient`, `releaseToPayee` | `confirmed` |
| `settled_by_timeout` | `timeout` | `["escrow", "auto_res"]` | `escrowId`, `bountyId`, `payeeAmount`, `payerAmount` | `confirmed` |
| `milestone_released` | `milestone_release` | `["escrow", "ms_rel"]` | `escrowId`, `index`, `payee`, `amount` | `confirmed` |

## Deterministic Regeneration

Fixtures can be generated or checked for drift using the provided generator script:

```bash
# Regenerate fixtures
pnpm run fixtures:generate

# Verify fixtures have not drifted from the schema generator
pnpm run fixtures:check
```

## Consumption

- **TypeScript / Web Client:** Imported directly into `lib/escrow-events.test.ts` to mock real Soroban event-driven responses without manual stubs.
- **Rust Contract / Services:** Tested via `backend/contracts/escrow/src/lib.rs` using `include_str!` to assert that event payloads adhere to prevailing contract definitions.
