# #1782: Disputes evidence: integrity hashes and access control

## Context
[app/api/disputes/[id]/evidence/route.ts](../../app/api/disputes/%5Bid%5D/evidence/route.ts)
stores evidence as metadata only:

- **`POST`** accepts `fileUrl`, `fileName`, `fileSize`, `mimeType`, `message` and
  `messageId` from the client, and writes them to `DisputeEvidence`
  ([schema](../../prisma/schema.prisma)). The server never sees the file bytes, so it
  cannot hash them. `fileUrl` can be any URL, including one the uploader can later
  change.
- **`GET`** lets dispute parties (`creatorId` or `clientId`) and **any user with role
  `ADMIN`** read evidence. It returns `uploadedBy.email` for every item, so each party
  sees the other party's email address.
- **Audit.** `POST` writes an `AuditLog` row. `GET` does not, so nobody can tell who has
  viewed evidence.

The escrow contract already supports anchoring. `submit_evidence(escrow_id, party, hash)`
in [backend/contracts/escrow/src/arbitration.rs](../../backend/contracts/escrow/src/arbitration.rs)
stores a sha256 per piece of evidence and emits an `("arb","evidence")` event. That
module also selects a per-dispute arbiter panel (#1713). Nothing in the web app calls
`submit_evidence` yet, and arbiters have no off-chain representation, so the API cannot
give them access.

## Why it matters
Evidence decides where escrowed funds go. If it can be quietly swapped after
submission, or read by people outside the dispute, the arbitration result can't be
trusted, and both parties are exposed to leaks.

## Suggested approach
1. **Server-controlled upload.**
   - Add `POST /api/disputes/:id/evidence/upload-url`. It returns a presigned S3 `PUT`
     URL for the key `disputes/<disputeId>/<evidenceId>`, using the existing client in
     [lib/storage/s3.ts](../../lib/storage/s3.ts). Apply the same checks as
     [upload-validation.ts](../../lib/storage/upload-validation.ts) (type and size).
   - The evidence `POST` then takes `{ evidenceId, message? }` and no longer takes
     `fileUrl`. The server streams the object, computes its `sha256`, and stores it.
     Never trust a hash sent by the client.
2. **Schema.** Add to `DisputeEvidence`:
   ```prisma
   sha256        String?   // hex, of the stored object bytes; for messages, of the UTF-8 text
   storageKey    String?   // S3 key; replaces client-supplied fileUrl
   versionId     String?   // S3 object version, pinned at submit time
   anchorTxHash  String?   // Stellar tx that called submit_evidence
   anchoredAt    DateTime?
   ```
   Also hash text-only evidence (`message`) so it is tamper-evident in the same way.
3. **Immutable storage.** Use a dedicated evidence bucket with versioning and **S3 Object
   Lock in compliance mode**, with retention of at least the dispute window plus the
   appeal window (`APPEAL_SECS`) plus legal hold. Store `versionId` and always read that
   version. Define the bucket in `infrastructure/` and do not reuse the general uploads
   bucket.
4. **On-chain anchor.** After the DB write, enqueue a job, using the transactional
   outbox from #1759 (`recordOutboxEvent` in `lib/db/transaction-manager.ts`), that calls `submit_evidence` with the hash and records
   `anchorTxHash`. If anchoring fails, the job retries, and the evidence stays visible
   as "pending anchor". The contract rejects evidence after voting starts. Surface that
   rejection as `409` for new uploads once the case is in the voting phase.
5. **Verification.** Add `GET /api/disputes/:id/evidence/:evidenceId/verify`. It
   re-reads the pinned version, recomputes sha256, compares it with the DB value and,
   if the item is anchored, with `load_evidence`. It returns
   `{ dbMatch, chainMatch }`. The arbiter UI shows a badge for each item.
6. **Access control.**
   - Allowed: the two parties, and arbiters on the current panel for that escrow (read
     from the contract or from an indexed `DisputeArbiter` table populated by the
     indexer). Admins get access only through an explicit, audited break-glass role,
     not through `role === 'ADMIN'` alone.
   - Return `404` instead of `403` to non-participants, so the response does not
     confirm that a dispute exists.
   - Downloads use presigned `GET` URLs that expire after 5 minutes or less. Raw
     `storageKey` values are never exposed.
   - Drop `email` from the `uploadedBy` select.
7. **Audit.** Write an `AuditLog` row (`resource: 'dispute_evidence'`) for upload, view
   (list), download-URL issue, verify, and anchor result. Store IDs and hashes only, no
   file contents. The audit table is already hash-chained
   ([docs/audit-hash-chain.md](../audit-hash-chain.md)).

## Docs to update
- `docs/PAYMENTS.md` or a new `docs/disputes-evidence.md`: the upload flow, retention
  policy, who can access evidence, and how to verify it.
- `infrastructure/` README: the evidence bucket and its Object Lock settings.

## Test plan
- **Non-party cannot access:** an authenticated user who is neither a party nor a panel
  arbiter gets `404` on list, upload-url, download and verify. A plain `ADMIN` without
  break-glass is denied.
- **Arbiter access:** a panel arbiter can read but not upload. An arbiter removed from
  the panel (appeal round) loses access.
- **Modified file detected:** upload an object and submit it, then overwrite the S3 key
  with different bytes (mocked S3 with versioning). `verify` reads the pinned version and
  reports a match, or a mismatch when the pinned version itself is mutated in the mock.
  A mismatched DB hash is reported as `dbMatch: false`.
- **Client hash ignored:** a request body that includes `sha256` has no effect on the
  stored value.
- **Anchor:** a successful job stores `anchorTxHash`. A contract error leaves the item
  pending and schedules a retry.
- **Audit:** each access path writes exactly one row, and payloads contain no file
  contents and no email addresses.
- **Contract:** an existing `arbitration.rs` test covers `submit_evidence`. Add a case
  for evidence submitted after the voting phase starts.

## Acceptance criteria
- [ ] Every piece of evidence has a server-computed sha256, is stored immutably and is
      anchored on-chain.
- [ ] Only parties and assigned arbiters (plus audited break-glass) can access
      evidence.
- [ ] Tampering is detectable through the verify endpoint.
- [ ] CI is green (lint, type-check, tests).
- [ ] No new TODOs without a linked issue.
