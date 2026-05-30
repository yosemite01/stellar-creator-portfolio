-- Add SequenceLock table for distributed locking
CREATE TABLE IF NOT EXISTS "SequenceLock" (
    "accountId" TEXT NOT NULL PRIMARY KEY,
    "lockedBy" TEXT NOT NULL DEFAULT '',
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sequence" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add index for lock expiration cleanup
CREATE INDEX IF NOT EXISTS "idx_sequence_lock_expires_at" ON "SequenceLock"("expiresAt");

-- Add TransactionQueue table for tracking queued transactions
CREATE TABLE IF NOT EXISTS "TransactionQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sequence" BIGINT,
    "txHash" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for transaction queue queries
CREATE INDEX IF NOT EXISTS "idx_transaction_queue_account_id" ON "TransactionQueue"("accountId");
CREATE INDEX IF NOT EXISTS "idx_transaction_queue_status" ON "TransactionQueue"("status");
CREATE INDEX IF NOT EXISTS "idx_transaction_queue_created_at" ON "TransactionQueue"("createdAt");
CREATE INDEX IF NOT EXISTS "idx_transaction_queue_account_status" ON "TransactionQueue"("accountId", "status");

-- Add SorobanTransaction table for audit trail
CREATE TABLE IF NOT EXISTS "SorobanTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "txHash" TEXT NOT NULL UNIQUE,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "gasUsed" BIGINT,
    "result" JSONB,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for Soroban transaction queries
CREATE INDEX IF NOT EXISTS "idx_soroban_transaction_account_id" ON "SorobanTransaction"("accountId");
CREATE INDEX IF NOT EXISTS "idx_soroban_transaction_tx_hash" ON "SorobanTransaction"("txHash");
CREATE INDEX IF NOT EXISTS "idx_soroban_transaction_status" ON "SorobanTransaction"("status");
CREATE INDEX IF NOT EXISTS "idx_soroban_transaction_sequence" ON "SorobanTransaction"("accountId", "sequence");

-- Add constraint to ensure sequence is unique per account
ALTER TABLE "SorobanTransaction" ADD CONSTRAINT "unique_account_sequence" 
  UNIQUE ("accountId", "sequence");

-- Add function to update updatedAt timestamp
CREATE OR REPLACE FUNCTION update_sequence_lock_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for SequenceLock
DROP TRIGGER IF EXISTS update_sequence_lock_timestamp_trigger ON "SequenceLock";
CREATE TRIGGER update_sequence_lock_timestamp_trigger
BEFORE UPDATE ON "SequenceLock"
FOR EACH ROW
EXECUTE FUNCTION update_sequence_lock_timestamp();

-- Create trigger for TransactionQueue
DROP TRIGGER IF EXISTS update_transaction_queue_timestamp_trigger ON "TransactionQueue";
CREATE TRIGGER update_transaction_queue_timestamp_trigger
BEFORE UPDATE ON "TransactionQueue"
FOR EACH ROW
EXECUTE FUNCTION update_sequence_lock_timestamp();

-- Create trigger for SorobanTransaction
DROP TRIGGER IF EXISTS update_soroban_transaction_timestamp_trigger ON "SorobanTransaction";
CREATE TRIGGER update_soroban_transaction_timestamp_trigger
BEFORE UPDATE ON "SorobanTransaction"
FOR EACH ROW
EXECUTE FUNCTION update_sequence_lock_timestamp();

-- Add comment documenting the sequence management
COMMENT ON TABLE "SequenceLock" IS 'Distributed lock for managing Soroban account sequence numbers. Prevents nonce collisions under concurrent load.';
COMMENT ON TABLE "TransactionQueue" IS 'Queue for pending Soroban transactions. Ensures transactions are submitted in order with correct sequence numbers.';
COMMENT ON TABLE "SorobanTransaction" IS 'Audit trail for all Soroban transactions. Tracks submission, confirmation, and errors.';
