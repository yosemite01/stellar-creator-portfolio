-- Add dispute response deadlines and DisputeEvidence model (issue #1577)

ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "deadline" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Dispute_deadline_idx" ON "Dispute"("deadline");

CREATE TABLE IF NOT EXISTS "DisputeEvidence" (
  "id"           TEXT PRIMARY KEY,
  "disputeId"    TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "fileUrl"      TEXT,
  "fileName"     TEXT,
  "fileSize"     INTEGER,
  "mimeType"     TEXT,
  "message"      TEXT,
  "messageId"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "DisputeEvidence"
    ADD CONSTRAINT "DisputeEvidence_disputeId_fkey"
    FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DisputeEvidence"
    ADD CONSTRAINT "DisputeEvidence_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "DisputeEvidence_disputeId_idx" ON "DisputeEvidence"("disputeId");
CREATE INDEX IF NOT EXISTS "DisputeEvidence_uploadedById_idx" ON "DisputeEvidence"("uploadedById");
