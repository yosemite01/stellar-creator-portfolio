# Backend Migrations Deprecation Notice (#1754)

> **IMPORTANT**: Direct DDL migrations via `sqlx` in this directory are deprecated.

Per Architecture Decision Record `#1754` (`docs/SYSTEM_OF_RECORD.md`), **Prisma ORM** (`prisma/schema.prisma`) is the canonical System of Record and single migration authority for the PostgreSQL database.

All new schema changes must be added to `prisma/schema.prisma` and generated using Prisma migrations. Rust microservices access tables as read-only consumers or via domain APIs.
