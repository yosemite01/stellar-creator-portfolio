# Prisma Migration Convention

## Folder naming

All migration folders **must** use the 14-digit timestamp prefix produced by
`prisma migrate dev`:

```
YYYYMMDDHHMMSS_<snake_case_description>
```

Prisma applies migrations in lexical (alphabetical) folder order.  A folder
like `20260530_add_foo` sorts *before* `20260529000000_create_missing_core_tables`
on some filesystems because `2` < `_`, which can apply migrations out of order
on a fresh database.  The 14-digit format ensures migrations always sort
chronologically.

## Renaming existing folders (issue #1589)

Fourteen folders were renamed in this commit to add the missing `HHMMSS`
component.  The mapping is:

| Old name | New name |
|---|---|
| 20260530_add_escrow_deadlock_prevention | 20260530100000_add_escrow_deadlock_prevention |
| 20260530_add_soroban_sequence_management | 20260530110000_add_soroban_sequence_management |
| 20260624_add_messages_fts | 20260624090000_add_messages_fts |
| 20260624_add_skill_taxonomy | 20260624100000_add_skill_taxonomy |
| 20260624_add_testimonials | 20260624110000_add_testimonials |
| 20260625_add_bounty_templates_gdpr | 20260625090000_add_bounty_templates_gdpr |
| 20260625_add_stellar_corridor_analytics | 20260625100000_add_stellar_corridor_analytics |
| 20260625_add_verification_tiers_feature_flags | 20260625110000_add_verification_tiers_feature_flags |
| 20260626_add_user_suspension_tracking | 20260626090000_add_user_suspension_tracking |
| 20260630_bounty_search_view | 20260630090000_bounty_search_view |
| 20260723_add_kyc_submission | 20260723090000_add_kyc_submission |
| 20260930_add_project_rich_text | 20260930090000_add_project_rich_text |
| 20261002_balance_user_unique | 20261002090000_balance_user_unique |
| 20261002_transaction_status | 20261002100000_transaction_status |

## Updating an existing database after the rename

Prisma tracks applied migrations by folder name in the `_prisma_migrations`
table.  Run the provided script **once** after deploying this branch to any
existing database:

```bash
# Requires DATABASE_URL to be set
node scripts/rename-migrations-db.mjs
```

The script is idempotent — running it twice is safe.

## CI drift check (issue #1588)

The `prisma-migrations` job in `.github/workflows/ci.yml` runs
`prisma migrate diff` to ensure `schema.prisma` is always in sync with the
migrations folder.  If you edit `schema.prisma` without creating a migration,
CI will fail with a readable diff.

To check locally:

```bash
# Requires a running Postgres with DATABASE_URL set
pnpm exec prisma migrate deploy
pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

A zero exit code means no drift.
