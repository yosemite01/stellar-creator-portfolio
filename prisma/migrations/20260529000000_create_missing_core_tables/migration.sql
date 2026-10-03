-- Creates the tables that schema.prisma declares but no earlier migration
-- ever created. Databases built with `prisma db push` already have them,
-- which is why the gap went unnoticed; a database built only from
-- migrations failed at 20260530_add_escrow_deadlock_prevention ("relation
-- \"Escrow\" does not exist").
--
-- Every statement is idempotent (IF NOT EXISTS, or a duplicate_object guard
-- for enums and foreign keys), so applying this to a database that already
-- has these tables changes nothing. It is dated before 20260530 so that, on
-- a fresh database, the tables exist before the migrations that alter them.
--
-- Tables are created in their current shape. The later migrations that add
-- some of the same columns and indexes (Escrow audit columns,
-- Transaction.status, the unique index on Balance.userId) use IF NOT EXISTS,
-- so they apply cleanly afterwards.

DO $$ BEGIN
  CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'OPENED', 'READ', 'ARCHIVED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AuditStatus" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Availability" (
    "id" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Endorsement" (
    "id" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "giverId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Endorsement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Review" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isVerifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "notHelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReviewVote" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vote" TEXT NOT NULL,

    CONSTRAINT "ReviewVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "channels" TEXT[],
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Escrow" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "disputedAt" TIMESTAMP(3),
    "disputeReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Escrow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Balance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "locked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Balance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "escrowId" TEXT,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Dispute" (
    "id" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT,
    "payload" JSONB,
    "httpMethod" TEXT,
    "requestPath" TEXT,
    "status" "AuditStatus" NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "traceId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "geoCountry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ZKNullifier" (
    "id" TEXT NOT NULL,
    "nullifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZKNullifier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Testimonial" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "bountyId" TEXT,
    "author" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "videoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Availability_creatorProfileId_idx" ON "Availability"("creatorProfileId");

CREATE INDEX IF NOT EXISTS "Endorsement_creatorProfileId_idx" ON "Endorsement"("creatorProfileId");

CREATE INDEX IF NOT EXISTS "Endorsement_giverId_idx" ON "Endorsement"("giverId");

CREATE UNIQUE INDEX IF NOT EXISTS "Endorsement_creatorProfileId_giverId_skill_key" ON "Endorsement"("creatorProfileId", "giverId", "skill");

CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId");

CREATE INDEX IF NOT EXISTS "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

CREATE INDEX IF NOT EXISTS "Review_creatorId_idx" ON "Review"("creatorId");

CREATE INDEX IF NOT EXISTS "Review_reviewerId_idx" ON "Review"("reviewerId");

CREATE INDEX IF NOT EXISTS "Review_status_idx" ON "Review"("status");

CREATE INDEX IF NOT EXISTS "ReviewVote_reviewId_idx" ON "ReviewVote"("reviewId");

CREATE UNIQUE INDEX IF NOT EXISTS "ReviewVote_reviewId_userId_key" ON "ReviewVote"("reviewId", "userId");

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_messageId_key" ON "Notification"("messageId");

CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");

CREATE INDEX IF NOT EXISTS "Notification_status_idx" ON "Notification"("status");

CREATE INDEX IF NOT EXISTS "Escrow_creatorId_idx" ON "Escrow"("creatorId");

CREATE INDEX IF NOT EXISTS "Escrow_clientId_idx" ON "Escrow"("clientId");

CREATE INDEX IF NOT EXISTS "Escrow_status_idx" ON "Escrow"("status");

CREATE INDEX IF NOT EXISTS "Escrow_createdAt_idx" ON "Escrow"("createdAt");

CREATE INDEX IF NOT EXISTS "Escrow_creatorId_status_idx" ON "Escrow"("creatorId", "status");

CREATE INDEX IF NOT EXISTS "Escrow_clientId_status_idx" ON "Escrow"("clientId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "Balance_userId_key" ON "Balance"("userId");

CREATE INDEX IF NOT EXISTS "Transaction_userId_idx" ON "Transaction"("userId");

CREATE INDEX IF NOT EXISTS "Transaction_escrowId_idx" ON "Transaction"("escrowId");

CREATE INDEX IF NOT EXISTS "Transaction_type_idx" ON "Transaction"("type");

CREATE INDEX IF NOT EXISTS "Dispute_escrowId_idx" ON "Dispute"("escrowId");

CREATE INDEX IF NOT EXISTS "Dispute_creatorId_idx" ON "Dispute"("creatorId");

CREATE INDEX IF NOT EXISTS "Dispute_clientId_idx" ON "Dispute"("clientId");

CREATE INDEX IF NOT EXISTS "Dispute_status_idx" ON "Dispute"("status");

CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_resource_action_idx" ON "AuditLog"("resource", "action");

CREATE INDEX IF NOT EXISTS "AuditLog_resourceId_idx" ON "AuditLog"("resourceId");

CREATE INDEX IF NOT EXISTS "AuditLog_traceId_idx" ON "AuditLog"("traceId");

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

CREATE INDEX IF NOT EXISTS "AuditLog_status_createdAt_idx" ON "AuditLog"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ZKNullifier_nullifier_key" ON "ZKNullifier"("nullifier");

CREATE INDEX IF NOT EXISTS "ZKNullifier_nullifier_idx" ON "ZKNullifier"("nullifier");

CREATE INDEX IF NOT EXISTS "Testimonial_clientId_idx" ON "Testimonial"("clientId");

CREATE INDEX IF NOT EXISTS "Testimonial_creatorId_idx" ON "Testimonial"("creatorId");

CREATE INDEX IF NOT EXISTS "Testimonial_bountyId_idx" ON "Testimonial"("bountyId");

CREATE INDEX IF NOT EXISTS "Testimonial_featured_idx" ON "Testimonial"("featured");

CREATE INDEX IF NOT EXISTS "Testimonial_createdAt_idx" ON "Testimonial"("createdAt");

DO $$ BEGIN
  ALTER TABLE "Availability" ADD CONSTRAINT "Availability_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Endorsement" ADD CONSTRAINT "Endorsement_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
