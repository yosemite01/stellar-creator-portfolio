# #1779: Onboarding — resumable multi-step state machine with server persistence

## Context

`components/onboarding/onboarding-wizard.tsx` is a client component that holds all
wizard state in local React state (`useState`). Three steps — role selection, profile
details, and wallet — are hard-coded in component logic. Progress is not written to the
server until the final submission.

`app/api/onboarding/route.ts` exists and already reads/writes `onboardingStep` and
`onboardingData` on the `User` record:

```ts
// app/api/onboarding/route.ts
const updated = await prisma.user.update({
  where: { id: user.id },
  data: {
    onboardingStep: step ?? userRecord.onboardingStep,
    onboardingData: mergedData as Prisma.InputJsonObject,
    …
  },
});
```

The route is called at the end of the flow, not after each step. If the user closes the
tab mid-flow, their progress is lost. `GET /api/onboarding` already returns the saved
step and data, but the wizard ignores the response and always starts at step 1.

`lib/validations/onboarding.ts` provides zod schemas per step
(`onboardingProfileStepSchema`, `onboardingInterestsStepSchema`,
`onboardingWalletStepSchema`), but the wizard uses its own inline schemas.

## Why it matters

A user who starts onboarding on a desktop browser and later returns on mobile, or who
loses connectivity mid-flow, starts from scratch. This increases drop-off, particularly
for creators who need to look up their Stellar wallet address during the wallet step.

## Suggested approach

### 1. Persist after each step

Call `PATCH /api/onboarding` after the user completes each step, not only at the end.
The route already supports partial updates. Use the existing zod schemas from
`lib/validations/onboarding.ts` at the route boundary (the wizard currently uses its own
inline schemas; align them).

### 2. Resume on load

In `OnboardingWizard`, call `GET /api/onboarding` on mount. If `onboardingStep` is set
and greater than 1, navigate to that step and pre-populate the form with `onboardingData`.
The existing route already returns all required fields.

This can be done without XState for a first pass. The PR description should note whether
XState is included or deferred (see below).

### 3. XState machine (recommended, may be a follow-up)

Model the wizard as an XState v5 machine in
`lib/onboarding/onboarding-machine.ts`. States map one-to-one with steps:

```
idle → role → profile → wallet → complete
```

Each transition fires a `PATCH /api/onboarding` side effect. The machine's context holds
the accumulated form data, and the current state is derived from `onboardingStep`.
The wizard component becomes a thin renderer over `useMachine(onboardingMachine)`.

If XState is deferred to a follow-up issue, the machine file should still be created as
a stub so the structure is established before the component grows further.

### 4. Analytics on drop-off

Track a `onboarding_step_completed` event after each successful PATCH, with
`{ step, role }` properties. Use the existing `trackEvent` helper from
`lib/analytics/analytics.ts`, which is already imported in the wizard.

Do not send PII. `role` (`CREATOR` / `CLIENT`) is not PII. Do not send `displayName`,
`walletAddress`, or any other user-supplied value.

Add a `onboarding_abandoned` event in a `beforeunload` listener if the step is between
1 and the final step. Remove the listener on completion.

### 5. Device-resume flow

When the user loads the onboarding page on a second device, the wizard resumes at the
saved step with form fields pre-filled from `onboardingData`. The user can go back to
earlier steps. Saving on each step keeps the server state current.

## Test plan

Write the failing test first.

- **Resume (key test):** mock `GET /api/onboarding` to return `{ onboardingStep: 2,
  onboardingData: { role: 'CREATOR', displayName: 'Alice' } }`; render the wizard;
  assert it renders step 2 with "Alice" pre-filled, without calling `PATCH`.
- **Step persistence:** complete step 1; assert `PATCH /api/onboarding` is called with
  `{ step: 1, data: { role: 'CREATOR' } }` before step 2 renders.
- **Fresh start:** mock returns `{ onboardingStep: null }`; assert wizard starts at step 1.
- **Analytics:** complete step 2; assert `trackEvent('onboarding_step_completed', { step: 2, role: 'CREATOR' })` is called.
- **Route validation:** `PATCH` with an unrecognised `step` value → 400 (zod).
- **Resumption on second device (e2e, Playwright):** sign in, complete step 1 in
  browser A, open the onboarding URL in browser B, assert it starts at step 2.

## Acceptance criteria

- [ ] Completing any step calls `PATCH /api/onboarding` before advancing
- [ ] Loading the wizard when `onboardingStep > 0` resumes at that step with saved data
- [ ] Drop-off analytics events fire without sending PII
- [ ] Wizard uses `lib/validations/onboarding.ts` schemas rather than inline ones
- [ ] CI is green (lint, type-check, tests)
- [ ] No new TODOs without a linked issue

## Deferred

- XState machine (can land after basic persistence is in place).
- Server-side rendering of the wizard (currently `'use client'`; acceptable for now).
