-- Columns and indexes the schema (and the application) rely on that no
-- earlier migration added. Databases created with `prisma db push` already
-- have them; on a database built from migrations alone, onboarding, bounty
-- difficulty filters, profile links and email-bounce handling all failed
-- with "column does not exist".
--
-- Every statement is idempotent, so this is a no-op where the columns exist.

DO $$ BEGIN
  CREATE TYPE "BountyDifficulty" AS ENUM ('beginner', 'intermediate', 'advanced', 'expert');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Bounty"
  ADD COLUMN IF NOT EXISTS "difficulty" "BountyDifficulty" NOT NULL DEFAULT 'beginner';
CREATE INDEX IF NOT EXISTS "Bounty_difficulty_idx" ON "Bounty"("difficulty");

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "onboardingStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "onboardingData" JSONB,
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailBounced" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CreatorProfile"
  ADD COLUMN IF NOT EXISTS "githubUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "figmaUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT;

ALTER TABLE "ClientProfile"
  ADD COLUMN IF NOT EXISTS "budgetRange" TEXT,
  ADD COLUMN IF NOT EXISTS "projectType" TEXT,
  ADD COLUMN IF NOT EXISTS "githubUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "figmaUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT;

-- NextAuth looks verification tokens up by token alone.
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_token_key" ON "VerificationToken"("token");
