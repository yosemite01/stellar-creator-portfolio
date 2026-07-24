/**
 * E2E coverage for the SEP-24 anchor deposit/withdraw flow, scoped ahead of
 * the actual implementation (components/features/sep24-flow.tsx is
 * currently TODO-stubbed — see IMPLEMENTATION_NOTES.md) so the tests land in
 * the same PR as the real SEP-24 API call instead of a later follow-up.
 *
 * Fill these in when implementing the interactive-URL request + transaction
 * status polling described in components/features/sep24-flow.tsx.
 */
import { describe, it } from 'vitest'

describe('E2E: SEP-24 anchor flow', () => {
  it.todo(
    'mocked-anchor happy path: requesting the interactive URL, completing the anchor flow, and polling reaches a `completed` transaction status',
  )

  it.todo(
    'failure/rejection path: the anchor returns an error (or the user is redirected back with a rejected/incomplete status) and the flow surfaces that as an `error` status rather than hanging in `pending_anchor`',
  )
})
