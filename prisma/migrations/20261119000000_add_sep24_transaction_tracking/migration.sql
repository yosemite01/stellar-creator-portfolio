-- Create enums for SEP-24 transaction tracking
CREATE TYPE "Sep24Kind" AS ENUM ('deposit', 'withdrawal');

CREATE TYPE "Sep24Status" AS ENUM (
  'incomplete',
  'pending_user_transfer_start',
  'pending_user_transfer_complete',
  'pending_external',
  'pending_anchor',
  'pending_stellar',
  'pending_trust',
  'pending_user',
  'completed',
  'refunded',
  'expired',
  'no_market',
  'too_small',
  'too_large',
  'error'
);

-- SEP-24 Transaction model with full state persistence
CREATE TABLE "Sep24Transaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "anchorId" TEXT NOT NULL,
  "transferServer" TEXT NOT NULL,
  "kind" "Sep24Kind" NOT NULL,
  "assetCode" TEXT NOT NULL,
  "amountIn" TEXT,
  "amountOut" TEXT,
  "amountFee" TEXT,
  "status" "Sep24Status" NOT NULL DEFAULT 'pending_user_transfer_start',
  "message" TEXT,
  "moreInfoUrl" TEXT,
  "stellarTransactionId" TEXT,
  "externalTransactionId" TEXT,
  "startedAt" TIMESTAMPTZ(6) DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ(6),
  "lastPolledAt" TIMESTAMPTZ(6),
  "pollCount" INTEGER NOT NULL DEFAULT 0,
  "staleAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "Sep24Transaction_pkey" PRIMARY KEY ("id")
);

-- Status history for timeline display
CREATE TABLE "Sep24StatusEntry" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "status" "Sep24Status" NOT NULL,
  "message" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "Sep24StatusEntry_pkey" PRIMARY KEY ("id")
);

-- Indexes for common query patterns
CREATE INDEX "Sep24Transaction_userId_createdAt_idx" ON "Sep24Transaction"("userId", "createdAt" DESC);
CREATE INDEX "Sep24Transaction_anchorId_idx" ON "Sep24Transaction"("anchorId");
CREATE INDEX "Sep24Transaction_status_idx" ON "Sep24Transaction"("status");
CREATE INDEX "Sep24Transaction_status_lastPolledAt_idx" ON "Sep24Transaction"("status", "lastPolledAt" ASC);

CREATE INDEX "Sep24StatusEntry_transactionId_createdAt_idx" ON "Sep24StatusEntry"("transactionId", "createdAt" DESC);

-- Foreign keys
ALTER TABLE "Sep24Transaction" ADD CONSTRAINT "Sep24Transaction_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Sep24StatusEntry" ADD CONSTRAINT "Sep24StatusEntry_transactionId_fkey" 
  FOREIGN KEY ("transactionId") REFERENCES "Sep24Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for SEP-24 transaction updates
CREATE TRIGGER set_sep24_transaction_updated_at
  BEFORE UPDATE ON "Sep24Transaction"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for status entry updates
CREATE TRIGGER set_sep24_status_entry_updated_at
  BEFORE UPDATE ON "Sep24StatusEntry"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();