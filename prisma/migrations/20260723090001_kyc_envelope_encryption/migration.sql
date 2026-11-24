-- Runs after 20260723090000_add_kyc_submission, which creates the "KYCSubmission" table.
-- Add key version fields to KYCSubmission for envelope encryption
ALTER TABLE "KYCSubmission" 
ADD COLUMN IF NOT EXISTS "key_id" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN IF NOT EXISTS "key_version" TEXT NOT NULL DEFAULT 'v1';

-- Add indexes for key version queries
CREATE INDEX IF NOT EXISTS "idx_kyc_submissions_key_version" ON "KYCSubmission"("key_version");
CREATE INDEX IF NOT EXISTS "idx_kyc_submissions_key_id" ON "KYCSubmission"("key_id");

-- Create table for tracking key rotation history
CREATE TABLE IF NOT EXISTS "kyc_key_rotation_history" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "previous_key_id" TEXT NOT NULL,
    "new_key_id" TEXT NOT NULL,
    "rotated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "rotated_by" TEXT
);

-- Create index for rotation history queries
CREATE INDEX IF NOT EXISTS "idx_kyc_key_rotation_history_rotated_at" ON "kyc_key_rotation_history"("rotated_at");
