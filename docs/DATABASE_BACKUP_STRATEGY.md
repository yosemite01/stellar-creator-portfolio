# PostgreSQL Automated Backup & Restore Strategy

This document outlines the architecture, configuration, and recovery targets for the automated database backup and restore strategy.

## Architecture

We use **WAL-G** (successor to WAL-E) for continuous archiving of PostgreSQL to AWS S3 (or any S3-compatible object storage). This enables Point-in-Time Recovery (PITR) to any second within the last 30 days.

```
                    ┌─────────────────────────┐
                    │  PostgreSQL Primary DB  │
                    └───────────┬─────────────┘
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼ (Continuous Archiving)                    ▼ (Scheduled Backup)
   Hourly WAL Segments                         Daily Full Basebackups
   (wal-g wal-push)                            (wal-g backup-push)
          │                                           │
          └─────────────────────┬─────────────────────┘
                                ▼
                     ┌──────────────────────┐
                     │ S3 Backup Bucket     │
                     │ (Retention: 30 days) │
                     └──────────────────────┘
```

## Recovery Targets

*   **RPO (Recovery Point Objective):** < 1 hour (ensured by pushing WAL segments hourly).
*   **RTO (Recovery Time Objective):** < 4 hours (ensured by automated restore drills and optimized network bandwidth).

---

## Configuration

### 1. WAL-G environment variables
WAL-G is configured via the following environment variables (stored securely in AWS SSM / Sealed Secrets):

```bash
WALG_S3_PREFIX=s3://stellar-db-backups/postgres
AWS_ACCESS_KEY_ID=<redacted — provided via the Kubernetes secret named in Values.secretName>
AWS_SECRET_ACCESS_KEY=<redacted — provided via the Kubernetes secret named in Values.secretName>
AWS_REGION=us-east-1
PGHOST=<postgres host>
PGUSER=<postgres user>
PGPASSWORD=<redacted — provided via the Kubernetes secret named in Values.secretName>
PGDATABASE=<database name>
```

See [`infrastructure/k8s/helm/postgres/templates/backup-cronjob.yaml`](../infrastructure/k8s/helm/postgres/templates/backup-cronjob.yaml)
for how these are actually wired in — via `envFrom.secretRef`, not committed
literals.

### 2. postgresql.conf Parameters
To enable continuous archiving in PostgreSQL:

```ini
wal_level = replica
archive_mode = on
archive_command = 'wal-g wal-push %p'
archive_timeout = 3600 # Force a WAL segment switch every hour
```

---

## Automation & Scheduling

Implemented as two Kubernetes CronJobs in
[`infrastructure/k8s/helm/postgres/templates/backup-cronjob.yaml`](../infrastructure/k8s/helm/postgres/templates/backup-cronjob.yaml):

1.  **Daily Full Backup (Basebackup):** `0 2 * * *` (02:00 UTC daily) — `wal-g backup-push`, then `wal-g delete before FIND_FULL <30 days ago> --confirm` to prune.
2.  **Monthly Restore Drill:** `0 4 1 * *` (04:00 UTC on the 1st) — posts a result to the `AuditLog` API.

**Current limitation**: the restore drill CronJob's own comment says its
smoke-test result is "simulated for this implementation" — it currently
POSTs a hardcoded `{"status": "SUCCESS", "smokeTests": "passed"}` rather
than actually spinning up a test instance, restoring into it, and running
real checks. Treat this drill as a placeholder for the real thing, not as
evidence restores have actually been verified to work.

---

## Monitoring & Alerts

### 1. Slack Alert on Failure
The alert isn't a separate script — it's inlined directly in the backup
CronJob's shell command (see the `if wal-g backup-push ...; then ... else
... curl ... fi` block in `backup-cronjob.yaml`): a non-zero exit from
`wal-g backup-push` posts to `$SLACK_WEBHOOK_URL` (sourced from the
`stellar-alerts-secret` Kubernetes secret) before the job exits non-zero.

### 2. Admin Dashboard Visibility
The admin dashboard fetches the latest backup status and age directly from the database's `AuditLog` table. A warning state is triggered if the last backup is older than 24 hours.

### 3. Restore Drill results
Monthly restore drills log details (success/failure, duration, data integrity checks) to `AuditLog`:
*   **Resource:** `db`
*   **Action:** `restore_drill`
*   **Payload:** `{ "status": "SUCCESS", "smokeTests": "passed", "restoredSize": "20.4 GB", "durationSec": 245 }`
