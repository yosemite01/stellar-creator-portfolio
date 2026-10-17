-- Migration: Verification Tier System + Feature Flags + Sequence Pool
-- Issue #832 (Tier System), #837 (Feature Flags), #838 (Sequence Collisions)

-- ── 1. VerificationTier enum ─────────────────────────────────────────────────
CREATE TYPE "VerificationTier" AS ENUM ('NONE', 'VERIFIED', 'TRUSTED', 'ELITE');

-- ── 2. Alter CreatorProfile ──────────────────────────────────────────────────
ALTER TABLE "CreatorProfile"
  ADD COLUMN "verificationTier" "VerificationTier" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "firstActiveAt"    TIMESTAMPTZ;

-- Back-fill: creators with verified=true get VERIFIED tier
UPDATE "CreatorProfile"
   SET "verificationTier" = 'VERIFIED'
 WHERE verified = TRUE;

CREATE INDEX "CreatorProfile_verificationTier_idx"
  ON "CreatorProfile"("verificationTier");

-- ── 3. TierHistory ───────────────────────────────────────────────────────────
CREATE TABLE "TierHistory" (
  "id"               TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "creatorProfileId" TEXT        NOT NULL,
  "previousTier"     "VerificationTier" NOT NULL,
  "newTier"          "VerificationTier" NOT NULL,
  "reason"           TEXT,
  "triggeredBy"      TEXT        NOT NULL DEFAULT 'system',
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "TierHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TierHistory_creatorProfileId_createdAt_idx"
  ON "TierHistory"("creatorProfileId", "createdAt");

CREATE INDEX "TierHistory_newTier_idx"
  ON "TierHistory"("newTier");

ALTER TABLE "TierHistory"
  ADD CONSTRAINT "TierHistory_creatorProfileId_fkey"
  FOREIGN KEY ("creatorProfileId")
  REFERENCES "CreatorProfile"("id")
  ON DELETE CASCADE;

-- ── 4. SequencePool (pre-fetched sequences) ──────────────────────────────────
CREATE TABLE "SequencePool" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "accountId"  TEXT        NOT NULL,
  "sequence"   BIGINT      NOT NULL,
  "reserved"   BOOLEAN     NOT NULL DEFAULT FALSE,
  "reservedAt" TIMESTAMPTZ,
  "usedAt"     TIMESTAMPTZ,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "SequencePool_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SequencePool_accountId_reserved_idx"
  ON "SequencePool"("accountId", "reserved");

CREATE INDEX "SequencePool_accountId_sequence_idx"
  ON "SequencePool"("accountId", "sequence");

-- ── 5. Feature Flags ─────────────────────────────────────────────────────────
CREATE TABLE "FeatureFlag" (
  "id"             TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "name"           TEXT        NOT NULL,
  "enabled"        BOOLEAN     NOT NULL DEFAULT FALSE,
  "rolloutPercent" INTEGER     NOT NULL DEFAULT 0,
  "userSegment"    JSONB,
  "description"    TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "FeatureFlag_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "FeatureFlag_name_key" UNIQUE ("name")
);

CREATE INDEX "FeatureFlag_name_idx"    ON "FeatureFlag"("name");
CREATE INDEX "FeatureFlag_enabled_idx" ON "FeatureFlag"("enabled");

-- Seed initial flags
INSERT INTO "FeatureFlag" ("name", "enabled", "rolloutPercent", "description")
VALUES
  ('live_streaming', FALSE,  0,   'Real-time creator live streaming feature'),
  ('ar_portfolio',   FALSE,  0,   'AR portfolio viewer — iOS beta testers only'),
  ('yield_farming',  FALSE, 10,   'DeFi yield farming rewards for creators');

-- ── 6. FeatureFlagEvaluation ─────────────────────────────────────────────────
CREATE TABLE "FeatureFlagEvaluation" (
  "id"        TEXT        NOT NULL DEFAULT gen_random_uuid(),
  "flagId"    TEXT        NOT NULL,
  "userId"    TEXT,
  "result"    BOOLEAN     NOT NULL,
  "context"   JSONB,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "FeatureFlagEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeatureFlagEvaluation_flagId_createdAt_idx"
  ON "FeatureFlagEvaluation"("flagId", "createdAt");

CREATE INDEX "FeatureFlagEvaluation_userId_createdAt_idx"
  ON "FeatureFlagEvaluation"("userId", "createdAt");

ALTER TABLE "FeatureFlagEvaluation"
  ADD CONSTRAINT "FeatureFlagEvaluation_flagId_fkey"
  FOREIGN KEY ("flagId")
  REFERENCES "FeatureFlag"("id")
  ON DELETE CASCADE;
