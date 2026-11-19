-- Migration: Escrow event projection columns (#1736)
--
-- Adds the columns used by lib/escrow/event-projection.ts so on-chain events
-- can be upserted idempotently into the Escrow table as the single source of
-- truth.  All new columns are nullable so existing rows are unaffected.
--
-- chainEscrowId  — the integer ID emitted by the Soroban contract; used as the
--                  conflict target for upserts (ON CONFLICT ("chainEscrowId")).
-- eventId        — the last Soroban event ID that wrote this row; allows the
--                  UI / API to tell whether a row reflects optimistic or
--                  confirmed on-chain state.
-- ledger         — the ledger sequence of the last event that touched this row;
--                  used by the reorg rollback query to delete stale rows.
-- token          — the SAC contract address of the token held in escrow;
--                  present in escrow_deposited but absent from Stripe escrows.

ALTER TABLE "Escrow"
  ADD COLUMN IF NOT EXISTS "chainEscrowId" BIGINT,
  ADD COLUMN IF NOT EXISTS "eventId"       TEXT,
  ADD COLUMN IF NOT EXISTS "ledger"        BIGINT,
  ADD COLUMN IF NOT EXISTS "token"         TEXT;

-- Unique constraint required for the ON CONFLICT upsert in event-projection.ts
CREATE UNIQUE INDEX IF NOT EXISTS "Escrow_chainEscrowId_key"
  ON "Escrow" ("chainEscrowId")
  WHERE "chainEscrowId" IS NOT NULL;

-- Index for the reorg rollback: DELETE FROM "Escrow" WHERE ledger >= $1
CREATE INDEX IF NOT EXISTS "Escrow_ledger_idx"
  ON "Escrow" ("ledger")
  WHERE "ledger" IS NOT NULL;

-- Ensure the indexer_cursors table exists on the Next.js DB side as well
-- (the Rust indexer creates it on its own connection; this covers the case
-- where the Next.js app calls saveCursor / loadCursor directly).
CREATE TABLE IF NOT EXISTS indexer_cursors (
  key        TEXT PRIMARY KEY,
  ledger_seq BIGINT NOT NULL DEFAULT 0
);
