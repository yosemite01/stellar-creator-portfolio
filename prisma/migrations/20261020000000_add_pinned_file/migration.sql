-- Pin registry for /api/ipfs/pin (issue #1507)

CREATE TABLE IF NOT EXISTS "PinnedFile" (
  "id"        TEXT NOT NULL,
  "cid"       TEXT NOT NULL,
  "sha256"    TEXT NOT NULL,
  "size"      INTEGER NOT NULL,
  "ownerId"   TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PinnedFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PinnedFile_cid_key" ON "PinnedFile"("cid");
CREATE INDEX IF NOT EXISTS "PinnedFile_ownerId_idx" ON "PinnedFile"("ownerId");
CREATE INDEX IF NOT EXISTS "PinnedFile_sha256_idx" ON "PinnedFile"("sha256");

DO $$ BEGIN
  ALTER TABLE "PinnedFile"
    ADD CONSTRAINT "PinnedFile_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
