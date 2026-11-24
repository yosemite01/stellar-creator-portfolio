# #1780: Teams — on-chain payout split for multi-member teams

## Context

`app/api/teams/route.ts` creates teams with a `payoutSplitPercent` per member,
validated so splits sum to exactly 100:

```ts
// app/api/teams/route.ts
const memberSchema = z.object({
  userId: z.string().min(1),
  payoutSplitPercent: z.number().int().min(1).max(100),
});
```

`app/api/teams/[id]/route.ts` returns team details to owners and members, and the
application flow links teams to bounty applications via `app/api/bounties/[id]/apply`.

The split percentages are stored in Postgres but are not enforced on-chain. When a
bounty escrow is released, the full amount goes to a single payee address. There is no
contract mechanism that reads team membership and distributes funds to each member's
wallet according to their configured split.

## Why it matters

Agencies and collaborations rely on automatic revenue distribution. Without on-chain
enforcement, a team owner could receive the full escrow release and distribute (or not)
manually. This is a trust and coordination problem, and it blocks agencies from using
the platform for client work.

## Suggested approach

Write a short design note in the PR covering data model, failure modes, and upgrade
path before the bulk of the implementation.

### 1. Contract: split release entrypoint

Extend the Soroban escrow contract
(`backend/contracts/escrow/src/lib.rs`) with a `release_split` function:

```rust
pub fn release_split(
    env: Env,
    escrow_id: u64,
    payees: Vec<(Address, u32)>, // (wallet, basis_points) — must sum to 10_000
) -> Result<(), EscrowError>
```

The function:
- Verifies the caller is the authorized releaser (bounty poster or arbitrator).
- Verifies `payees` sums to exactly 10 000 basis points.
- Calls `token.transfer` for each payee in a single transaction; if any transfer fails,
  the whole transaction reverts.
- Emits a `("escrow", "split_released")` event with the escrow ID and the payee list as
  public signals (not private wallet addresses in event topics — emit amounts only).
- Benchmarks resource usage; XL splits (20 payees) must stay under the Soroban
  instruction budget.

### 2. Data model

Add `teamId String?` on the `Escrow` prisma model, linking an escrow to a team.
When a bounty with a team application is released, the API reads
`TeamMember.payoutSplitPercent` for each member and constructs the `payees` vector.

```prisma
model Escrow {
  // …existing fields…
  teamId  String?
  team    Team?    @relation(fields: [teamId], references: [id])
}
```

### 3. API: split-aware release

In the escrow release handler (wherever `releaseEscrow` is called), check whether
the escrow has a linked team. If it does, call `release_split` with the team's split
config. If it does not, call the existing single-payee `release`.

Validate that every `TeamMember` has a non-null `walletAddress` before submitting the
transaction; return a clear error if any member has not set a wallet.

Business logic lives in `lib/server/services/escrow-release.ts`. The route must not
contain split logic.

### 4. UI: split configuration

The team creation flow in the client already accepts `payoutSplitPercent` per member.
Add a summary screen showing the split before the team is submitted, so members can
verify before the first bounty application. No new data fields are required; this is a
UI change only.

Add a read-only split display to the team detail page (`app/api/teams/[id]`) visible
to all team members.

### 5. Upgrade path for existing teams

Existing teams with escrows in the `active` state use the single-payee release path
until they are explicitly migrated. The PR should document whether migration is
automatic (on next release) or manual (requires team owner action).

## Test plan

Write the failing test first.

- **Split correctness (contract, unit):** call `release_split` with a two-payee split
  (60/40); assert each `token.transfer` is called with the correct amount.
- **Basis-point mismatch:** `payees` summing to 9 999 → `EscrowError::InvalidSplit`.
- **Privileged path (negative):** a non-releaser calling `release_split` → error.
- **Missing wallet (API):** attempt a split release when one team member has no wallet
  address → 422 with a clear error message naming the member.
- **Single-payee fallback:** escrow with no team → existing single-payee release is
  unchanged.
- **Event emission:** `release_split` emits `("escrow", "split_released")` with
  escrow ID; assert in a contract unit test.
- **Rust benchmarks:** `cargo test --features bench` verifies a 20-payee split stays
  within the instruction budget.

## Acceptance criteria

- [ ] `release_split` distributes funds in a single atomic transaction
- [ ] A basis-point sum ≠ 10 000 is rejected by the contract
- [ ] Every privileged path has a negative test
- [ ] API returns 422 if any payee wallet is missing, with the member identified
- [ ] Resource usage for a 20-payee split is benchmarked and documented in the PR
- [ ] `docs/contracts.md` documents `release_split` arguments, events, and error codes
- [ ] CI is green (lint, type-check, tests, `cargo test --workspace`)
- [ ] No new TODOs without a linked issue

## Deferred

- UI for editing an existing team's splits after creation.
- Automatic repair of drift between DB split config and on-chain payee list.
