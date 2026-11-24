-- Create enums for cross-chain swap state machine
CREATE TYPE "SwapStatus" AS ENUM (
  'initiated',
  'source_lock',
  'destination_claim',
  'completed',
  'refund_requested',
  'refunded',
  'error',
  'failed'
);

CREATE TYPE "SwapPhase" AS ENUM (
  'initiated',
  'source_lock',
  'destination_claim',
  'completed',
  'refund_requested',
  'refunded',
  'error'
);

-- Cross-chain swap session with crash recovery and refund handling
CREATE TABLE "SwapSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fromChain" TEXT NOT NULL,
  "toChain" TEXT NOT NULL,
  "fromAmount" TEXT NOT NULL,
  "toAmount" TEXT NOT NULL,
  "minOut" TEXT NOT NULL,
  "quoteExpiry" TIMESTAMPTZ(6) NOT NULL,
  
  -- Route info
  "routeId" TEXT NOT NULL,
  "hops" JSONB NOT NULL,
  
  -- HTLC state
  "htlcHash" TEXT,
  "htlcSecret" TEXT,
  "htlcLocktime" INTEGER,
  
  -- State machine
  "status" "SwapStatus" NOT NULL DEFAULT 'initiated',
  "phase" "SwapPhase" NOT NULL DEFAULT 'initiated',
  
  -- Refund tracking
  "refundTxId" TEXT,
  "refundedAt" TIMESTAMPTZ(6),
  
  -- Timing
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "completedAt" TIMESTAMPTZ(6),
  
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "SwapSession_pkey" PRIMARY KEY ("id")
);

-- Indexes for common queries
CREATE INDEX "SwapSession_userId_status_idx" ON "SwapSession"("userId", "status");
CREATE INDEX "SwapSession_status_phase_idx" ON "SwapSession"("status", "phase");
CREATE INDEX "SwapSession_quoteExpiry_status_idx" ON "SwapSession"("quoteExpiry", "status");
CREATE INDEX "SwapSession_htlcHash_idx" ON "SwapSession"("htlcHash");

-- Foreign key
ALTER TABLE "SwapSession" ADD CONSTRAINT "SwapSession_userId_fkey" 
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for swap session updates
CREATE TRIGGER set_swap_session_updated_at
  BEFORE UPDATE ON "SwapSession"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();