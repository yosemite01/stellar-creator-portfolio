-- Time-correct corridor currency conversion (#1809, server/services/corridor-analytics.ts).
ALTER TABLE "CorridorPayment" ADD COLUMN IF NOT EXISTS "convertedVolume" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "PriceHistory" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DECIMAL(38,18) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PriceHistory_currency_timestamp_key" ON "PriceHistory"("currency", "timestamp");
