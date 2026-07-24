# Implementation Notes

Technical specs and implementation detail for in-progress backlog items. For
*priority ordering* of what's next, see [`docs/BACKLOG.md`](docs/BACKLOG.md) —
that's the canonical backlog location; this file is its implementation-detail
companion, cross-linked so the two don't drift apart.

## Yield deposit slippage tolerance

**Status:** frontend implemented, contract-side blocked (see `docs/BACKLOG.md`).

Users depositing into a yield vault need to see expected vs. actual shares
before confirming, and a slippage tolerance expressed in basis points
(`max_slippage_bps`) that produces a recommended minimum acceptable share
count:

```
recommended min_shares = expected_shares * (1 - max_slippage_bps / 10_000)
```

- `expected_shares`: shares quoted at the time of the deposit request.
- `max_slippage_bps`: user-configurable tolerance, in basis points (e.g. `50`
  = 0.50%).
- `min_shares`: the value passed to the eventual `deposit_to_yield` contract
  call as the minimum acceptable output; the deposit should revert on-chain
  if actual shares would fall below this.

Frontend implementation:
`components/features/yield/slippage-tolerance-control.tsx` — computes
`min_shares` from the formula above and surfaces expected vs. actual shares.
It's built as a self-contained/presentational component (no contract call
wired in) since `deposit_to_yield` / `max_slippage_bps` don't exist on the
contract side yet. Once that lands, wire its `onConfirm(minShares)` callback
to the actual deposit call.

## SEP-24 anchor flow

**Status:** TODO-stubbed, not implemented.

`components/features/sep24-flow.tsx` is a stub pending the actual SEP-24
interactive deposit/withdraw API call. E2E test coverage is scoped now
(rather than as a later follow-up) in `__tests__/sep24-flow.e2e.test.ts` as
`it.todo` cases covering, at minimum:

1. Mocked-anchor happy path (interactive flow completes, transaction status
   reaches `completed`).
2. Failure / rejection path (anchor returns an error or the user is
   redirected back with a rejected status).

When implementing the real SEP-24 API call, fill in these test cases as part
of the same PR — see `docs/BACKLOG.md` for why this is called out explicitly.
