# 📌 Issue Preview: Mobile offline-first database with sync engine

**Labels:** `mobile`, `backend`, `sync`, `offline`, `hard`

**Issue:** #1788 · **Size:** XL (split into stacked PRs) · **Pinned commit:** `dd8420b`

---

### Description
The mobile app has a WatermelonDB schema, an offline mutation queue, and a per-entity
conflict policy, and the web side has `/api/sync/pull` and `/api/sync/push`. These parts
don't fit together into a working sync engine. The table names don't match between client
and server, pull ignores `lastPulledAt`, no model classes are registered, and the conflict
rules on the server don't match the mobile policy. The goal: a user in a low-connectivity
region can browse and edit offline, and the edits sync correctly once they reconnect.

### Current Behavior (as found in code)

| Location | What it does today | Problem |
|---|---|---|
| [db.ts](../../mobile/src/database/db.ts#L53-L56) | `new Database({ modelClasses: [] })` | No `Model` classes are registered, so `db.get('bounties')` and `synchronize()` cannot apply changes. |
| [db.ts](../../mobile/src/database/db.ts#L63-L79) vs [schema.ts](../../mobile/src/database/schema.ts#L43) | Sync payload keys are `bounties`, `applications`, `messages` | The local table is `bounty_applications`, and no `messages` or `portfolios` sync exists. Pulled `applications` changes don't match any table. |
| [db.ts](../../mobile/src/database/db.ts#L100-L115) `pullChanges` | `GET /api/sync/pull` | `lastPulledAt` is never sent, so every sync is a full download. |
| [pull/route.ts](../../app/api/sync/pull/route.ts#L35-L93) | Returns **all** of the user's rows as `created` and leaves `updated`/`deleted` empty | No incremental sync. Deletes never reach the device. The server's `timestamp` is taken *after* the queries, so rows written during the query are skipped on the next pull (a gap). Dates are ISO strings, while the schema uses numbers (ms). |
| [push/route.ts](../../app/api/sync/push/route.ts#L44-L46) | `await req.json()` cast to `PushPayload`, plus `as any` everywhere | No zod. The client chooses the `id`, `budget`, `status`, `bounty_id`, and so on, which breaks "never trust client-supplied amounts or ids". `status` can be set to anything, including `COMPLETED`. |
| [push/route.ts](../../app/api/sync/push/route.ts#L48-L175) | Writes rows one at a time, with no transaction | A failure partway through leaves the push half-applied, and the client retries all of it. A retried `create` with the same id causes a 500 (unique violation), so the device is stuck. |
| push/route.ts conflict logic | Compares client `updated_at` with server `updatedAt`, and the newer one wins | It trusts the client's clock, so a device with a skewed clock wins every time. It doesn't follow [ADR 0001](../adr/0001-offline-conflict-resolution.md) (`merge` vs `last-write-wins` per entity). WatermelonDB's protocol expects the server to **reject** a push when there are server changes since `lastPulledAt`. |
| [OfflineQueue.ts](../../mobile/src/offline/OfflineQueue.ts) + [ConflictResolution.ts](../../mobile/src/offline/ConflictResolution.ts) | A separate REST replay queue with a 409 → resolve policy | A second sync path that runs in parallel to WatermelonDB. Nothing decides which entities use which path. |
| [push/route.ts](../../app/api/sync/push/route.ts#L180-L185) | Puts `details: String(error)` in the 500 body | Leaks internal error text to the client. |

### Design note (agree this design in the issue before coding, per XL guidance)

#### Two paths, clearly split
| Path | Entities | Why |
|---|---|---|
| **WatermelonDB sync** (`/api/sync/pull` and `/api/sync/push`) | `bounties`, `bounty_applications`, `portfolios` (read-only), later `messages` | Records the user browses and edits as documents |
| **OfflineQueue** (REST replay) | `escrow`, `payment`, `tip`, `rating` | Money and one-shot actions must go through their own validated endpoints and their own idempotency keys. They are never synced as row diffs. |

The sync push must **reject** any table outside its allowlist.

#### Protocol (WatermelonDB-compatible)
- `GET /api/sync/pull?lastPulledAt=<ms>&schemaVersion=<n>&migration=<json?>`
  returns `{ changes: { <table>: { created, updated, deleted } }, timestamp }`.
  - `timestamp` is read from the DB (`SELECT now()`) **before** the queries, and rows are
    selected with `updatedAt > lastPulledAt`. This gives at-least-once delivery with no gap;
    the client handles the duplicates.
  - With `lastPulledAt = null`, everything comes back as `created`. Otherwise rows created
    since then go in `created` and rows changed since then go in `updated`.
  - `deleted` comes from a new `SyncTombstone` table (`table`, `recordId`, `userId`,
    `deletedAt`), which is written by every soft delete or status change that removes a row
    from the user's view. Tombstones are pruned after 90 days. A client with a
    `lastPulledAt` older than that gets `410` and does a full resync.
  - Keys use the same snake_case names as the local schema, and all times are ms epoch.
- `POST /api/sync/push?lastPulledAt=<ms>` with body `{ changes }`:
  1. zod-validate each table's created, updated and deleted rows against a **per-table
     writable field allowlist**. For example, `bounties`: `title`, `description`,
     `deadline`, `category`, `tags`. The client can never write `budget` (that goes through
     escrow), `creator_id`, `applicant_id`, or `status`. `status` changes only through the
     allowed ones: the bounty creator may `CANCEL`, the applicant may `WITHDRAW`.
  2. Inside one `prisma.$transaction`: for each updated or deleted row, if the server's
     `updatedAt > lastPulledAt`, the row has a conflict.
  3. Conflict resolution follows `ENTITY_CONFLICT_POLICY`, which moves to the shared
     `lib/sync/conflict-policy.ts` and is imported by both web and mobile.
     - `last-write-wins` entities: reject the push with `409 { conflicts: [...] }`. The
       client then pulls again, and WatermelonDB re-runs its sync, rebasing the local
       changes.
     - `merge` entities: apply only the fields the client changed (WatermelonDB's `_changed`
       column list) on top of the server's row.
  4. Ownership is checked per row. A row the caller doesn't own is a conflict (reject), not
     a silent skip.
  5. `created` with an id that already exists and belongs to the same user is treated as an
     idempotent update. With a different owner it returns 409.
  6. Ids: the client generates WatermelonDB ids (random 16-character). The server accepts
     them only for `created`, validates their format, and keeps them as the primary key, so
     a retry is idempotent.
- Errors: 400 (validation), 401, 409 (conflict, so the client pulls and retries), 410
  (resync), 500 with no internal details.

#### Server time vs client time
Conflicts compare against `lastPulledAt`, which is **server time** returned by an earlier
pull. They never compare client `updated_at`. This fixes the clock-skew problem.

#### Mobile sync engine (`mobile/src/sync/`)
- `models/` holds the `Bounty`, `BountyApplication`, `Portfolio` Model classes, which are
  registered in `db.ts`.
- `SyncEngine.ts` serialises sync runs (a mutex), passes `lastPulledAt`,
  `sendCreatedAsUpdated: false`, and `migrationsEnabledAtVersion`, and on 409 retries up to
  3 times with jitter.
- Triggers:
  - app start;
  - the `NetworkProvider` offline→online transition (debounced 2 s);
  - after a local write (debounced 5 s);
  - `expo-background-fetch` / `expo-task-manager` about every 15 minutes (the OS decides;
    best effort).
- Auth: read the token from `authStore`. On 401, stop and emit `sync.auth_required`. Never
  loop.
- Events: `sync.started`, `sync.pulled{n}`, `sync.pushed{n}`, `sync.conflict{n}`,
  `sync.failed{reason}`, `sync.completed{durationMs}` go to `telemetryCollector`. The offline
  UI (`OfflineStatusBadge`) subscribes to them.

#### Server code layout
- The routes stay thin: auth plus zod.
- Logic lives in `server/services/sync/{pull,push,tombstones}.ts`.
- Per-table adapters live in `server/services/sync/tables/*.ts`, each defining
  `{ pullQuery, writableFields, applyCreate, applyUpdate, applyDelete, owns }`.

#### Failure modes
| Failure | Behaviour |
|---|---|
| Push fails partway | Nothing is applied (transaction). The client retries the whole push. |
| Retried push after a lost response | Creates are idempotent by id, and updates are idempotent by value. |
| Clock skew on device | Irrelevant, because only server timestamps are compared. |
| Schema version mismatch | The client sends `schemaVersion`. If it is too old, the server returns 426 and the app prompts for an update. |
| Huge first sync | Pull is paginated by table, up to 1,000 rows per page with a `hasMore` cursor. Later PR, with benchmark. |
| Background task killed by OS | Harmless. The next trigger resumes from the stored `lastPulledAt`. |

#### Stacked PR plan
1. Shared `lib/sync/conflict-policy.ts` + zod schemas + `SyncTombstone` migration
2. Server pull (incremental + tombstones) with tests
3. Server push (allowlist, transaction, conflicts, idempotency) with tests
4. Mobile models + `SyncEngine` + triggers (foreground)
5. Background sync + offline UI wiring + docs

### Files Involved
- [mobile/src/database/db.ts](../../mobile/src/database/db.ts), [mobile/src/database/schema.ts](../../mobile/src/database/schema.ts) (schema v3 migration)
- `mobile/src/sync/` (new), [mobile/src/offline/](../../mobile/src/offline) (`NetworkProvider` trigger; `ConflictResolution` re-exports the shared policy)
- [app/api/sync/pull/route.ts](../../app/api/sync/pull/route.ts), [app/api/sync/push/route.ts](../../app/api/sync/push/route.ts)
- `server/services/sync/` (new), `lib/sync/` (new, shared)
- [prisma/schema.prisma](../../prisma/schema.prisma) (`SyncTombstone`)
- [docs/adr/0001-offline-conflict-resolution.md](../adr/0001-offline-conflict-resolution.md) (amend: sync path vs queue path), [mobile/README.md](../../mobile/README.md)

### Test plan
- **Main path (acceptance):** edit a bounty offline, reconnect, sync, and the server row is
  updated. Another device then pulls and receives it in `updated`.
- **Edge cases:**
  - Server changed the row after `lastPulledAt` and the entity is LWW: push returns 409, the
    client pulls, rebases, and pushes again.
  - Merge entity (portfolio): client edits `title`, server edits `thumbnail_url`, and both
    are kept.
  - A deleted row reaches the other device through a tombstone.
  - A retried push (same payload twice) leaves one row and causes no 500.
  - `lastPulledAt` older than the tombstone retention returns 410, and the client does a full
    resync.
  - Device clock set a year ahead: no wrongful win.
- **Negative (privileged):**
  - Pushing an update to another user's bounty returns 409/403 and the row is unchanged.
  - Pushing `budget`, `creator_id` or `status: COMPLETED` is rejected with 400.
  - Pushing to an unknown table (`payments`) is rejected.
- **Regressions:**
  - Pull honours `lastPulledAt` (today it always returns everything).
  - `applications` vs `bounty_applications` naming: pulled rows land in the local table.
  - A rejected push leaves the DB untouched (transaction).
- **Mobile:** Jest with WatermelonDB's LokiJS adapter, so no native SQLite is needed in CI.
  `SyncEngine` mutex, debounce, and the 401 stop.
- **Benchmark:** pull of 10k rows and push of 500 changes. Record p95 latency and payload size
  in the PR.

### Action Items
- [ ] Agree the design in #1788 (XL), then open stacked PRs 1–5
- [ ] Shared conflict policy (web + mobile)
- [ ] Incremental pull with tombstones and a gap-free timestamp
- [ ] zod-validated, transactional, idempotent push with a field allowlist
- [ ] Register WatermelonDB models; fix table-name mismatch
- [ ] `SyncEngine` with foreground and background triggers
- [ ] Amend ADR 0001 + `mobile/README.md`
- [ ] Tests above. CI green.

### Deferred / out of scope
- `messages` sync (it needs the E2E messaging store from `mobile/src/messaging`, which is a
  separate design)
- CRDT-based merging (Yjs is already a dependency, but field-level merge is enough for now)
- Pagination of the first sync (PR 5 or a follow-up, depending on benchmark results)
