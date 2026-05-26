-- Add ErrorLog model for centralized error tracking
CREATE TABLE IF NOT EXISTS "ErrorLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "level" TEXT NOT NULL DEFAULT 'error',
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "url" TEXT,
  "userAgent" TEXT,
  "environment" TEXT,
  "userId" TEXT,
  "sessionId" TEXT,
  "component" TEXT,
  "action" TEXT,
  "metadata" JSONB,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "ErrorLog_timestamp_idx" ON "ErrorLog"("timestamp" DESC);
CREATE INDEX IF NOT EXISTS "ErrorLog_level_idx" ON "ErrorLog"("level");
CREATE INDEX IF NOT EXISTS "ErrorLog_userId_idx" ON "ErrorLog"("userId");
CREATE INDEX IF NOT EXISTS "ErrorLog_component_idx" ON "ErrorLog"("component");
CREATE INDEX IF NOT EXISTS "ErrorLog_sessionId_idx" ON "ErrorLog"("sessionId");
