# 📌 Issue Preview: Disaster recovery: PITR, cross-region backups and restore drills

**Labels:** `infrastructure`, `reliability`, `database`

**Issue:** #1797

---

### Description
There are no agreed RPO/RTO targets per data store and no evidence that a restore actually works.
Backups sit in a single region, and the automated restore drill is a placeholder. A regional
outage or a bad migration could cause data loss we can't recover from within any known window.

### Current Behavior (as found in code)
- [docs/DATABASE_BACKUP_STRATEGY.md](../DATABASE_BACKUP_STRATEGY.md) describes WAL-G continuous
  archiving to S3 with 30-day retention and states RPO < 1h / RTO < 4h. The backup bucket is
  single-region (`AWS_REGION=us-east-1`), and the targets have not been measured.
- [docs/POSTGRES_RESTORE_RUNBOOK.md](../POSTGRES_RESTORE_RUNBOOK.md) has manual restore steps and
  a quarterly drill checklist. It notes that *"the automated monthly drill CronJob is still a
  placeholder"*.
- [infrastructure/k8s/helm/postgres/templates/backup-cronjob.yaml](../../infrastructure/k8s/helm/postgres/templates/backup-cronjob.yaml):
  - daily `wal-g backup-push` at 02:00 UTC
  - a `restore-drill` CronJob (monthly, `0 4 1 * *`) that only `echo`s and posts a hard-coded
    `"status": "SUCCESS"` audit event. It never restores anything
- [infrastructure/aws/](../../infrastructure/aws) contains only `kms.yaml` (CMK + Secrets Manager).
  No backup bucket, replication, or AWS Backup resources are defined as code.
- [helm/values.yaml](../../helm/values.yaml) is the umbrella chart (api, auth, notifications,
  indexer, next-app). It has no DR/backup settings.

### Proposed Implementation

**1. Define RPO/RTO**
Agree on and record targets per data store in `docs/DISASTER_RECOVERY.md`:

| Data store | RPO | RTO | Notes |
|------------|-----|-----|-------|
| PostgreSQL (primary app DB) | ≤ 5 min | ≤ 1 h (same region), ≤ 4 h (region loss) | WAL archiving + PITR |
| Object storage (uploads) | ≤ 15 min | ≤ 4 h | S3 versioning + CRR |
| Secrets / KMS keys | 0 | ≤ 1 h | Multi-region key or replica |
| On-chain state (contracts) | n/a | n/a | Source of truth is the ledger. Re-index via `indexer` |

Proposed numbers, for sign-off. The drill (3) measures against them.

**2. PITR and cross-region backups**
- Tighten WAL shipping: `archive_timeout = 60` so RPO doesn't depend on write volume. This
  replaces "hourly" in `DATABASE_BACKUP_STRATEGY.md`.
- New CloudFormation template `infrastructure/aws/backups.yaml`:
  - primary backup bucket (versioning, SSE-KMS with the CMK from `kms.yaml`, Object Lock in
    governance mode, lifecycle to Glacier after 30 days)
  - replica bucket in a second region (e.g. `eu-west-1`) with S3 Cross-Region Replication and
    Replication Time Control (15-min SLA), encrypted with a replica KMS key
  - same CRR setup for the uploads bucket
  - IAM role for the replication and a read-only role for restore drills
- If/when Postgres moves to RDS: enable automated backups (35-day PITR) plus
  `aws_backup` cross-region copy, and keep WAL-G as a secondary path.
- Add `backup.crossRegion.enabled`, `backup.replicaPrefix` to the postgres chart values so the
  restore job can target either region.

**3. Quarterly automated restore drill**
Replace the placeholder in `backup-cronjob.yaml` with a real job (schedule
`0 4 1 1,4,7,10 *`, first day of each quarter):
1. Start an ephemeral Postgres pod with an `emptyDir`/scratch PVC
2. `wal-g backup-fetch` + PITR to `now() - 1h`, reading from the **replica region** so
   cross-region restores are what gets tested
3. Run the smoke checks from the runbook (row counts, latest `createdAt`, `prisma migrate status`)
4. Measure elapsed time and data lag. Post the **actual** result (`SUCCESS`/`FAILURE`,
   `durationSeconds`, `rpoLagSeconds`) to the audit endpoint
5. Fail the job (non-zero exit) when either target is missed, and alert via existing
   monitoring ([infrastructure/monitoring/](../../infrastructure/monitoring))
6. Delete the scratch resources

Keep the manual quarterly checklist in the runbook for what can't be automated (e.g. DNS
failover, app cutover).

**4. Runbook**
`docs/DISASTER_RECOVERY.md` links to the existing Postgres runbook and adds:
- scenarios and decision tree: bad migration / accidental delete (PITR in place), primary
  instance loss (restore same region), region loss (restore in replica region)
- region-failover steps: restore DB in replica region, deploy the umbrella Helm chart there,
  switch `DATABASE_URL`, update DNS, re-run the indexer to reconcile on-chain state
- who declares a disaster, comms template, and how to record RPO/RTO actually achieved
- post-incident: re-establish replication back to the primary region

### Files Involved
- [infrastructure/k8s/helm/postgres/templates/backup-cronjob.yaml](../../infrastructure/k8s/helm/postgres/templates/backup-cronjob.yaml): real restore drill
- `infrastructure/aws/backups.yaml` (new): buckets, CRR, KMS replica, IAM
- [infrastructure/aws/kms.yaml](../../infrastructure/aws/kms.yaml): multi-region / replica key
- [helm/values.yaml](../../helm/values.yaml) and postgres chart values: DR settings
- [docs/DATABASE_BACKUP_STRATEGY.md](../DATABASE_BACKUP_STRATEGY.md): updated targets and architecture
- [docs/POSTGRES_RESTORE_RUNBOOK.md](../POSTGRES_RESTORE_RUNBOOK.md): cross-region restore steps
- `docs/DISASTER_RECOVERY.md` (new)

### Action Items
- [ ] Define RPO/RTO
- [ ] PITR and cross-region backups
- [ ] Quarterly automated restore drill
- [ ] Runbook
- [ ] Update docs / README where behaviour changes
- [ ] Add or update tests (see test plan)

### Test Plan
- [ ] `aws cloudformation validate-template` and `cfn-lint` pass for `backups.yaml`
- [ ] `helm template` + `kubeconform` pass for the postgres chart with DR values on and off
- [ ] Object written to the primary bucket appears in the replica within the RTC window
- [ ] Manually triggered drill job (`kubectl create job --from=cronjob/...`) restores from the
      replica region, passes smoke checks, and records real duration and lag in `AuditLog`
- [ ] Drill job exits non-zero and alerts when pointed at an empty/invalid prefix. It must not
      report `SUCCESS` unconditionally the way the placeholder does
- [ ] One tabletop exercise of the region-failover runbook, with gaps fixed in the doc
