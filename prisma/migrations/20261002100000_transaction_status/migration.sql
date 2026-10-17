-- Ledger rows written by the escrow handler record their outcome.
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'completed';

ALTER TABLE "Transaction" ADD CONSTRAINT "valid_transaction_status"
  CHECK ("status" IN ('pending', 'completed', 'failed'));
