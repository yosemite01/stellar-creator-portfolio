-- Add indexes for escrow queries to improve lock performance
CREATE INDEX IF NOT EXISTS "idx_escrow_creator_id" ON "Escrow"("creatorId");
CREATE INDEX IF NOT EXISTS "idx_escrow_client_id" ON "Escrow"("clientId");
CREATE INDEX IF NOT EXISTS "idx_escrow_status" ON "Escrow"("status");
CREATE INDEX IF NOT EXISTS "idx_escrow_created_at" ON "Escrow"("createdAt");

-- Add indexes for balance queries
CREATE INDEX IF NOT EXISTS "idx_balance_user_id" ON "Balance"("userId");

-- Add indexes for transaction queries
CREATE INDEX IF NOT EXISTS "idx_transaction_user_id" ON "Transaction"("userId");
CREATE INDEX IF NOT EXISTS "idx_transaction_escrow_id" ON "Transaction"("escrowId");
CREATE INDEX IF NOT EXISTS "idx_transaction_type" ON "Transaction"("type");

-- Add indexes for dispute queries
CREATE INDEX IF NOT EXISTS "idx_dispute_escrow_id" ON "Dispute"("escrowId");
CREATE INDEX IF NOT EXISTS "idx_dispute_creator_id" ON "Dispute"("creatorId");
CREATE INDEX IF NOT EXISTS "idx_dispute_client_id" ON "Dispute"("clientId");
CREATE INDEX IF NOT EXISTS "idx_dispute_status" ON "Dispute"("status");

-- Add composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS "idx_escrow_creator_status" ON "Escrow"("creatorId", "status");
CREATE INDEX IF NOT EXISTS "idx_escrow_client_status" ON "Escrow"("clientId", "status");

-- Add constraint to prevent invalid status transitions
ALTER TABLE "Escrow" ADD CONSTRAINT "valid_escrow_status" 
  CHECK ("status" IN ('active', 'released', 'refunded', 'disputed'));

-- Add constraint to ensure amounts are positive
ALTER TABLE "Escrow" ADD CONSTRAINT "positive_amount" 
  CHECK ("amount" > 0);

ALTER TABLE "Balance" ADD CONSTRAINT "non_negative_balance" 
  CHECK ("available" >= 0 AND "locked" >= 0);

-- Add audit columns for tracking changes
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3);
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "disputedAt" TIMESTAMP(3);
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "disputeReason" TEXT;

-- Add version column for optimistic locking (optional)
ALTER TABLE "Escrow" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- Create function to update updatedAt timestamp
CREATE OR REPLACE FUNCTION update_escrow_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updatedAt
DROP TRIGGER IF EXISTS update_escrow_timestamp_trigger ON "Escrow";
CREATE TRIGGER update_escrow_timestamp_trigger
BEFORE UPDATE ON "Escrow"
FOR EACH ROW
EXECUTE FUNCTION update_escrow_timestamp();

-- Add comment documenting isolation level requirement
COMMENT ON TABLE "Escrow" IS 'Escrow transactions must use SERIALIZABLE isolation level to prevent deadlocks. See lib/escrow/escrow-transaction-handler.ts';
