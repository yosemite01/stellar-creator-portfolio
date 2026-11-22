# #1785: Cron: tier upgrades and scheduled jobs with locks and observability

## Context
Scheduled work runs from two places, and neither has locking or run history:

- **Tier upgrade.** [lib/cron/tier-upgrade.ts](../../lib/cron/tier-upgrade.ts) runs
  nightly from [.github/workflows/nightly-tier-upgrade.yml](../../.github/workflows/nightly-tier-upgrade.yml)
  at `0 2 * * *`, and it can also be started with `workflow_dispatch`. It pages through
  every `CreatorProfile` and, for each one, compares the eligible tier with the stored
  tier, then writes `creatorProfile.update` and `tierHistory.create` in a transaction.
- **HTTP crons** under [app/api/admin/cron/](../../app/api/admin/cron/):
  `dispute-deadlines`, `kyc-cleanup`, `kyc-reattest`, `kyc-reconcile`,
  `notification-digest` and `corridor-aggregation`. They are authorised by
  `X-Cron-Secret` or an admin session.

Problems:
1. **No mutual exclusion.** A manual dispatch during the nightly run, a retried
   workflow, or a cron fired against more than one replica runs the job twice. The
   tier check reads and then writes with no guard, so two runners that both read
   `previousTier = VERIFIED` both write `TRUSTED`, and the result is **two
   `TierHistory` rows** for one upgrade, plus duplicate notifications or side effects
   later.
2. **`DRY_RUN` is ignored.** The workflow passes `DRY_RUN`, but `runTierUpgrade` never
   reads it, so a "dry run" writes to production.
3. **No run records.** The only output is `console.info` in the Actions log. There is no
   history of when a job ran, how long it took, what it changed, or whether it failed.
4. **Alerts only on a crash.** The Slack step fires on a non-zero exit. A run where
   every creator fails (`report.errors === total`) exits 0 and no alert is sent.
5. **No per-item idempotency.** A retry after a partial failure re-processes everything.
   That is safe for tiers today only because a creator whose tier already matches is
   skipped. Other jobs are not that lucky.

## Why it matters
Duplicate tier upgrades mean duplicate history and, once tier changes trigger
notifications or payouts, duplicate side effects. Without run records, nobody can tell
whether last night's job ran at all.

## Suggested approach
1. **Shared job runner**, `lib/jobs/runner.ts`:
   ```ts
   runJob(name, fn, { lockTtlMs, maxAttempts, dryRun }): Promise<JobRunResult>
   ```
   - **Lock:** `pg_try_advisory_lock(hashtext('job:' || name))` on a dedicated
     connection. Postgres is already required, and the lock is released automatically if
     the process dies. If the lock is taken, record a `SKIPPED_LOCKED` run and return.
     (You can use Redis `SET NX PX` with a fencing token instead, but do not rely on the
     no-op fallback in `lib/storage/redis.ts`, which skips silently when Redis is down.)
   - **Run record:** insert a `JobRun` row at start, and update it at the end with the
     status, duration, counters and error.
   - **Retries:** retry up to `maxAttempts` times with exponential backoff and jitter,
     but only for errors marked retriable. Each attempt increments `attempt` on the same
     `JobRun`.
2. **Schema:**
   ```prisma
   model JobRun {
     id         String    @id @default(cuid())
     job        String
     status     String    // RUNNING | SUCCESS | PARTIAL | FAILED | SKIPPED_LOCKED
     trigger    String    // schedule | manual | api
     triggeredBy String?
     dryRun     Boolean   @default(false)
     attempt    Int       @default(1)
     startedAt  DateTime  @default(now())
     finishedAt DateTime?
     durationMs Int?
     stats      Json?     // e.g. TierUpgradeReport
     error      String?   @db.Text

     @@index([job, startedAt])
     @@index([status])
   }
   ```
3. **Make the tier write idempotent as well.** Change the profile update to a
   compare-and-set: `updateMany({ where: { id, verificationTier: previousTier }, … })`,
   and only write `TierHistory` if `count === 1`. Even if the lock is bypassed, a
   concurrent runner then becomes a no-op instead of a duplicate. Honour `DRY_RUN` by
   computing the report and skipping both writes.
4. **Wire up existing jobs.** Wrap `runTierUpgrade` and each `app/api/admin/cron/*`
   handler in `runJob`. Keep the routes as thin auth wrappers. The workflow keeps its
   schedule, and the lock makes overlapping triggers safe.
5. **Alerting.** Alert to Slack when a run ends `FAILED`, ends `PARTIAL` (errors greater
   than 0 and above a threshold), or when a job has had no `SUCCESS` within its
   expected interval × 1.5. A staleness check (itself a small `runJob`) or a Grafana
   alert on a `job_last_success_timestamp` metric covers the case where the job never
   starts. Emit duration and error-count metrics through the existing telemetry.
6. **Admin view.** Add `/admin/jobs`, built like the existing feature-flags admin page.
   It lists jobs with last status, last success and duration trend. Clicking a job shows
   its recent `JobRun` rows with stats and error. A "Run now" button (ADMIN only,
   audited) calls the job with `trigger: 'manual'`, and a dry-run toggle sets `dryRun`.
7. **Retention:** delete `JobRun` rows older than 90 days, using its own job.

## Docs to update
- `docs/MAINTENANCE_NOTES.md`: how jobs are scheduled, locked and retried, how to run
  one manually, and where to see history.
- The header comment in `lib/cron/tier-upgrade.ts`: replace the "run via node -e"
  instructions.

## Test plan
- **Two instances run the job once:** start `runJob('tier-upgrade', …)` twice
  concurrently against the test DB ([docs/TEST_DATABASE.md](../TEST_DATABASE.md)). One
  run is `SUCCESS` and the other is `SKIPPED_LOCKED`. Exactly one `TierHistory` row per
  promoted creator.
- **Lock bypass is still safe:** call `processCreator` concurrently for the same
  profile without the runner. One `TierHistory` row is written.
- **Crash releases the lock:** kill the lock-holding connection, and the next run
  acquires the lock.
- **Dry run:** with `DRY_RUN=true`, there are no profile or history writes, and the
  report counts are the same as for a real run.
- **Retries:** a retriable error twice followed by success gives a `SUCCESS` run with
  `attempt = 3`. A non-retriable error fails immediately.
- **Alerting:** a `PARTIAL` or `FAILED` run, or a stale job, calls the (mocked) Slack
  notifier.
- **Admin view:** a non-admin gets a 403, and "Run now" writes an `AuditLog` row.

## Acceptance criteria
- [ ] Each scheduled job runs at most once at a time across all instances and
      triggers, and the tier upgrade's effects happen exactly once.
- [ ] Every run is recorded and visible in the admin view.
- [ ] Failures, partial failures and missed runs trigger alerts.
- [ ] CI is green (lint, type-check, tests).
- [ ] No new TODOs without a linked issue.
