-- Additive migration for IPFS pin redundancy health monitoring (#1769)
-- and adaptive HLS media transcoding pipeline (#1770).

CREATE TABLE IF NOT EXISTS "IpfsPinReplica" (
  "id" TEXT NOT NULL,
  "cid" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerPinId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PINNED',
  "lastCheckedAt" TIMESTAMP(3),
  "lastHealthyAt" TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastLatencyMs" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IpfsPinReplica_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IpfsPinReplica_cid_provider_key" ON "IpfsPinReplica"("cid", "provider");
CREATE INDEX IF NOT EXISTS "IpfsPinReplica_cid_idx" ON "IpfsPinReplica"("cid");
CREATE INDEX IF NOT EXISTS "IpfsPinReplica_status_idx" ON "IpfsPinReplica"("status");
CREATE INDEX IF NOT EXISTS "IpfsPinReplica_lastCheckedAt_idx" ON "IpfsPinReplica"("lastCheckedAt");

CREATE TABLE IF NOT EXISTS "MediaAsset" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "durationSeconds" DOUBLE PRECISION,
  "width" INTEGER,
  "height" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "backend" TEXT NOT NULL DEFAULT 'ffmpeg',
  "externalJobId" TEXT,
  "masterPlaylistKey" TEXT,
  "renditions" JSONB,
  "posterKey" TEXT,
  "thumbnailKeys" JSONB,
  "thumbnailsVttKey" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MediaAsset_ownerId_idx" ON "MediaAsset"("ownerId");
CREATE INDEX IF NOT EXISTS "MediaAsset_status_idx" ON "MediaAsset"("status");
CREATE INDEX IF NOT EXISTS "MediaAsset_externalJobId_idx" ON "MediaAsset"("externalJobId");
