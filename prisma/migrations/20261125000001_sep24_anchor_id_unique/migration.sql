-- Sep24Transaction drift fixes.
--
-- 1. anchorId is declared @unique and looked up with findUnique (callback
--    route, getSep24TransactionByAnchorId), but 20261119000000 only created a
--    plain index, so duplicate anchor ids could be inserted and findUnique
--    has no unique constraint backing it.
CREATE UNIQUE INDEX IF NOT EXISTS "Sep24Transaction_anchorId_key" ON "Sep24Transaction"("anchorId");

-- 2. startedAt is required in the schema (and always defaulted to NOW()),
--    but the column was created nullable. Backfill any gaps from createdAt
--    before enforcing it; the default means older releases never write NULL.
UPDATE "Sep24Transaction" SET "startedAt" = "createdAt" WHERE "startedAt" IS NULL;
-- migration-safety: contract (backfilled above; column already defaults to NOW())
ALTER TABLE "Sep24Transaction" ALTER COLUMN "startedAt" SET NOT NULL;
