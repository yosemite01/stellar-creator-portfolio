-- One balance row per user. Escrow release/refund upserts on "userId",
-- which requires a unique constraint rather than the plain index added in
-- 20260530_add_escrow_deadlock_prevention.
DROP INDEX IF EXISTS "idx_balance_user_id";
CREATE UNIQUE INDEX IF NOT EXISTS "Balance_userId_key" ON "Balance"("userId");
