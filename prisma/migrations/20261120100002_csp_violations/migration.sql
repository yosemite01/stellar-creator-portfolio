-- CSP violation reports (app/api/csp-report).
CREATE TABLE IF NOT EXISTS "CSPViolation" (
    "id" TEXT NOT NULL,
    "directive" TEXT NOT NULL,
    "blocked" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CSPViolation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CSPViolation_createdAt_idx" ON "CSPViolation"("createdAt");
CREATE INDEX IF NOT EXISTS "CSPViolation_directive_idx" ON "CSPViolation"("directive");
