-- AlterTable BountyTemplate
-- Adds versioning, moderation status, and review audit tracking (Issue #1821).

DO $$ BEGIN
    CREATE TYPE "TemplateStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "BountyTemplate"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "status" "TemplateStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "BountyTemplate_status_idx" ON "BountyTemplate"("status");

-- AlterTable Bounty
-- Links bounties to their source template and the immutable template version at creation time.
ALTER TABLE "Bounty"
  ADD COLUMN IF NOT EXISTS "templateId" TEXT,
  ADD COLUMN IF NOT EXISTS "templateVersion" INTEGER;

DO $$ BEGIN
  ALTER TABLE "Bounty"
    ADD CONSTRAINT "Bounty_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "BountyTemplate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Bounty_templateId_idx" ON "Bounty"("templateId");

-- CreateTable BountyTemplateVersion
-- Historical version log for templates so live bounties reference an immutable snapshot.
CREATE TABLE IF NOT EXISTS "BountyTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggestedBudget" INTEGER NOT NULL,
    "suggestedTimeline" INTEGER NOT NULL,
    "requiredSkills" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BountyTemplateVersion_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "BountyTemplateVersion"
    ADD CONSTRAINT "BountyTemplateVersion_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "BountyTemplate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "BountyTemplateVersion_templateId_version_key" ON "BountyTemplateVersion"("templateId", "version");
CREATE INDEX IF NOT EXISTS "BountyTemplateVersion_templateId_idx" ON "BountyTemplateVersion"("templateId");
