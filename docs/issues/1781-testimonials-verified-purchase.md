# #1781: Testimonials and reviews — verified-purchase linkage

## Context

`app/api/testimonials/route.ts` returns testimonials from the `Testimonial` prisma
model. The `GET` handler filters by `featured` and `limit`, and returns the full
testimonial with creator and bounty relations. There is no `POST` handler in
`app/api/testimonials/route.ts` — testimonials can be created through another path or
are seeded directly.

`lib/services/review-service.ts` manages a separate in-memory review store with an
`isVerifiedPurchase: boolean` field, but this flag is set by the caller and never
verified against an on-chain escrow:

```ts
// lib/services/review-service.ts
export interface Review {
  // …
  isVerifiedPurchase: boolean  // set by client; not enforced
  status: 'pending' | 'approved' | 'rejected'
}
```

`lib/rating-integration.test.ts` (404 lines) tests the `fetchCreatorReputation` path
against a mock API but does not test escrow linkage.

`lib/zk-review-proof.ts` exists for anonymous ZK-proof reviews (issue #628) and
generates a nullifier to prevent double-submission. That mechanism is separate from
the verified-purchase linkage described here.

## Why it matters

Any user can post a testimonial or review without having completed a bounty with the
creator. Fake testimonials inflate creator ratings, harm clients who rely on them to
choose creators, and damage platform trust. The existing `isVerifiedPurchase` flag
provides no enforcement.

## Suggested approach

Write a short design note in the PR covering data model, verification flow, and
moderation queue before the bulk of the implementation.

### 1. Require a completed escrow ID

Add a `POST /api/testimonials` route that requires `escrowId` in the request body:

```ts
const createTestimonialSchema = z.object({
  creatorId:  z.string().min(1),
  escrowId:   z.string().min(1),   // required; verified on-chain
  rating:     z.number().int().min(1).max(5),
  quote:      z.string().trim().min(10).max(2000),
  videoUrl:   z.string().url().max(2048).optional(),
});
```

The route must:
1. Look up the `Escrow` row by `escrowId`.
2. Verify the calling user is the `clientId` on that escrow (the buyer, not the creator).
3. Verify the escrow's DB status is `released` or `complete`.
4. Verify on-chain that the escrow contract reports the same terminal status (call
   `get_escrow` via Soroban RPC, the same read-only path used in #1573).
5. Verify no testimonial already exists for this `escrowId` (one review per completed
   engagement).

Steps 1–5 must all pass before the testimonial row is written. Business logic lives in
`lib/server/services/testimonial-service.ts`.

### 2. Prisma schema change

Add `escrowId String? @unique` to `Testimonial`. Null values remain possible for
legacy/seeded rows that pre-date this change, but any row created after this deploy
must have a non-null, verified `escrowId`.

```prisma
model Testimonial {
  // …existing fields…
  escrowId          String?  @unique
  escrow            Escrow?  @relation(fields: [escrowId], references: [id])
  verifiedOnChain   Boolean  @default(false)
  moderationStatus  ModerationStatus @default(PENDING)
}

enum ModerationStatus {
  PENDING
  APPROVED
  REJECTED
}
```

### 3. Verified badge

Add a `verifiedOnChain: boolean` read field to the testimonial API response. The UI
in `components/reviews/` can render a "Verified Purchase" badge for rows where this
is `true`. Do not show the badge for legacy rows where `escrowId` is null.

### 4. Moderation queue

Add `GET /api/admin/testimonials/moderation` (ADMIN role only) that returns
`PENDING` testimonials ordered by `createdAt`. Add `PATCH /api/admin/testimonials/[id]`
to approve or reject with a required `reason` for rejections.

Approval sets `moderationStatus = APPROVED` and makes the testimonial visible in public
API responses. Rejection sets `moderationStatus = REJECTED` and notifies the author
(use the existing notification channel).

Public `GET /api/testimonials` returns only `APPROVED` testimonials. Legacy rows with
null `escrowId` and no `moderationStatus` are treated as `APPROVED` to avoid breaking
existing content.

### 5. Review-service alignment

`lib/services/review-service.ts` uses an in-memory store. If this issue ships before
it is migrated to Prisma, add a note in the PR documenting the gap. The
`isVerifiedPurchase` flag should be derived from escrow linkage, not set by the caller,
once the service is Prisma-backed.

## Test plan

Write the failing test first.

- **Missing escrow (key regression):** `POST /api/testimonials` without `escrowId` → 400.
- **Escrow belongs to wrong user:** escrow exists but `clientId ≠ caller` → 403.
- **Escrow not complete:** escrow status is `active` → 422 with a clear message.
- **On-chain mismatch:** DB says `released` but Soroban RPC returns `Active` → 422;
  do not write the testimonial.
- **Duplicate:** same `escrowId` used twice → 409 Conflict.
- **Happy path:** valid escrow, correct user, `released` on-chain → testimonial created
  with `verifiedOnChain: true`, `moderationStatus: PENDING`.
- **Public GET:** `PENDING` and `REJECTED` testimonials are not returned by
  `GET /api/testimonials`.
- **Moderation (admin):** approve sets `APPROVED`; non-admin access → 403.
- **Legacy rows:** existing testimonials with null `escrowId` still appear in public GET.

## Acceptance criteria

- [ ] `POST /api/testimonials` requires a completed escrow ID, verified on-chain
- [ ] One testimonial per escrow is enforced at the DB level (`@unique`)
- [ ] Unverified submissions are rejected or held as unverified, never shown as verified
- [ ] Verified badge reflects `verifiedOnChain`, not a client-supplied flag
- [ ] Moderation queue is accessible to ADMIN only
- [ ] Legacy testimonials without `escrowId` remain visible (no data loss)
- [ ] `lib/rating-integration.test.ts` includes a test for the escrow-linkage path
- [ ] CI is green (lint, type-check, tests)
- [ ] No new TODOs without a linked issue

## Deferred

- Migrating `lib/services/review-service.ts` from in-memory to Prisma.
- Integrating with the ZK anonymous review path (`lib/zk-review-proof.ts`).
