-- Public key prefix shown in the developer dashboard.
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "prefix" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_prefix_key" ON "ApiKey"("prefix");
