# Backlog & Next Steps Priority

This is the single canonical location for open-work / priority ordering for this
repo. Implementation-level technical notes (specs, formulas, data shapes) for
in-progress items live in [`IMPLEMENTATION_NOTES.md`](../IMPLEMENTATION_NOTES.md)
at the repo root — this file tracks *what's next and in what order*, that one
tracks *how to build it*. When an item below has a corresponding spec, it links
to it directly instead of duplicating the details here.

> Historically this repo also carried a root-level `IMPLEMENTATION_NOTES.md`
> and scattered docs under `docs/` with their own, sometimes conflicting,
> priority lists. Those pre-cleanup docs are gone; this file plus
> `IMPLEMENTATION_NOTES.md` are the two canonical sources going forward — keep
> them cross-linked instead of letting a third list start drifting again.

## Priority Ordering

1. **Yield deposits: contract-side `deposit_to_yield` / `max_slippage_bps`**
   — not yet implemented. See "Yield deposit slippage tolerance" in
   `IMPLEMENTATION_NOTES.md` for the spec the frontend below is built against.
2. **Yield deposits: frontend slippage-tolerance control** — implemented
   (`components/features/yield/slippage-tolerance-control.tsx`); currently
   presentational/standalone since it has no contract call to wire up to yet.
   Wire it to `deposit_to_yield` once (1) lands.
3. **SEP-24 anchor flow** — frontend component is TODO-stubbed
   (`components/features/sep24-flow.tsx`). E2E coverage (mocked-anchor happy
   path + failure/rejection path) is scoped alongside it in
   `__tests__/sep24-flow.e2e.test.ts` (currently `it.todo`) so the tests land
   in the same PR as the real implementation rather than as a follow-up.

## Process notes

- Contribution workflow, code style, and the CI-bypass merge policy live in
  [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Documentation changes should land in the same PR as the code change they
  describe, not as standalone doc-only commits to `main`.
