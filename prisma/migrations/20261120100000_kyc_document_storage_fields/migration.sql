-- Object-storage fields for KYC documents, used by the upload, cleanup and
-- sanitisation jobs.
ALTER TABLE "KYCSubmission"
  ADD COLUMN IF NOT EXISTS "documentKey" TEXT,
  ADD COLUMN IF NOT EXISTS "documentImageKey" TEXT,
  ADD COLUMN IF NOT EXISTS "encryptedDocumentImage" TEXT,
  ADD COLUMN IF NOT EXISTS "sanitizedAt" TIMESTAMP(3);
