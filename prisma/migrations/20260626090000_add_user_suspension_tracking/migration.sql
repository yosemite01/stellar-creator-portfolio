-- Add user suspension/ban tracking fields
-- Issue #784: Admin user management with ban functionality

ALTER TABLE "User"
  ADD COLUMN "suspendedAt"   TIMESTAMPTZ,
  ADD COLUMN "suspensionReason" TEXT;

-- Index for efficient querying of suspended users
CREATE INDEX "User_suspendedAt_idx" ON "User"("suspendedAt");
