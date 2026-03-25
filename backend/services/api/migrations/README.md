# Database Migrations

This directory contains SQLx migration files for the Stellar Platform backend.

## Running Migrations

### Install sqlx-cli (one-time setup)
```bash
cargo install sqlx-cli --no-default-features --features postgres
```

### Create database (first time only)
```bash
cd services/api
export DATABASE_URL=postgres://stellar:stellar_dev_password@localhost:5432/stellar_db
cargo sqlx database create
```

### Run pending migrations
```bash
cargo sqlx migrate run
```

### Revert last migration
```bash
cargo sqlx migrate revert
```

### Create a new migration
```bash
cargo sqlx migrate add create_users_table
```

## Migration Files

1. `20250325000001_create_users_table.sql` - Core users table with wallet-based auth
2. `20250325000002_create_bounties_table.sql` - Bounty project listings
3. `20250325000003_create_bounty_applications_table.sql` - Freelancer proposals
4. `20250325000004_create_escrow_accounts_table.sql` - Escrow payment accounts
5. `20250325000005_create_freelancer_client_profiles.sql` - Extended profile tables
6. `20250325000006_create_update_timestamp_trigger.sql` - Auto-update triggers

## Offline Build Support

For compile-time query validation without a live database:
```bash
cargo sqlx prepare
```

This generates `sqlx-data.json` for offline query checking.
