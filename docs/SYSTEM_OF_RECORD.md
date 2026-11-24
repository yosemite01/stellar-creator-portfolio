# System of Record & Schema Ownership Architecture (#1754)

## Architecture Decision Record

### Context
Prior to this decision, PostgreSQL tables were dual-managed by both Prisma ORM (`prisma/schema.prisma`) and Rust `sqlx` migrations (`backend/migrations/`, `backend/services/api/migrations/`). This caused schema drift, conflicting indices, column type mismatches, and migration lockups in CI and production.

### Canonical Decision
**Prisma ORM is designated as the sole, authoritative System of Record and single migration runner for the entire PostgreSQL database.**

1. **Single Source of Truth**:
   - `prisma/schema.prisma` is the canonical schema definition.
   - All schema modifications (tables, columns, indexes, enums, relations) must be made via Prisma migrations (`prisma migrate dev`).
   - Production CI runs `pnpm prisma migrate deploy` exclusively.

2. **Table Ownership Matrix**:
   | Domain | Primary Owner | Access Mode for Rust Backend |
   |---|---|---|
   | Users, Auth, Sessions | Prisma (NextAuth) | Read-only SQL / Internal API |
   | Creator & Client Profiles | Prisma | Read-only SQL / Internal API |
   | Bounties & Applications | Prisma | Read-only SQL / Domain Event Bus |
   | Escrow & Payments | Prisma / Soroban Events | Read-only SQL / Contract Events |
   | Reviews & Endorsements | Prisma | Read-only SQL |
   | Notifications & Outbox | Prisma | Shared Read/Write via Outbox |

3. **Rust Services Data Access**:
   - Rust services must not run DDL migrations against tables defined in `prisma/schema.prisma`.
   - Microservices interact with core entities via internal HTTP endpoints, domain events, or read-only sqlx queries aligned with the Prisma schema.

4. **Zero-Downtime Migration Policy (Expand / Contract)**:
   - **Step 1 (Expand)**: Add new nullable columns or tables; deploy application code that writes to both old and new.
   - **Step 2 (Backfill)**: Run background backfill scripts for historical rows.
   - **Step 3 (Contract)**: Cut over reads to new columns, remove deprecated code, and drop old columns in a follow-up migration.
