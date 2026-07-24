-- Issue #782: OCR-based KYC Document Verification

ALTER TABLE "User" ADD COLUMN "walletAddress" TEXT;
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

CREATE TYPE "KYCDocumentType" AS ENUM ('PASSPORT', 'DRIVER_LICENSE', 'NATIONAL_ID');
CREATE TYPE "KYCStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "KYCSubmission" (
  "id"                String          NOT NULL,
  "userId"            String          NOT NULL,
  "documentType"      "KYCDocumentType" NOT NULL,
  "uploadedAt"        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  "expiresAt"         TIMESTAMPTZ     NOT NULL,
  "encryptedName"     TEXT            NOT NULL,
  "encryptedDOB"      TEXT            NOT NULL,
  "encryptedIdNumber" TEXT            NOT NULL,
  "status"            "KYCStatus"     NOT NULL DEFAULT 'PENDING',
  "adminReviewedBy"   TEXT,
  "adminReviewedAt"   TIMESTAMPTZ,
  "rejectionReason"   TEXT,
  "verifiedOnChain"   BOOLEAN         NOT NULL DEFAULT false,
  "txHash"            TEXT,

  CONSTRAINT "KYCSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KYCSubmission_userId_key" ON "KYCSubmission"("userId");
CREATE UNIQUE INDEX "KYCSubmission_txHash_key" ON "KYCSubmission"("txHash");
CREATE INDEX "KYCSubmission_userId_idx" ON "KYCSubmission"("userId");
CREATE INDEX "KYCSubmission_status_idx" ON "KYCSubmission"("status");
CREATE INDEX "KYCSubmission_expiresAt_idx" ON "KYCSubmission"("expiresAt");

ALTER TABLE "KYCSubmission"
  ADD CONSTRAINT "KYCSubmission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
