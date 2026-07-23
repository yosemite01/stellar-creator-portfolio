-- Migration: 20260625_add_stellar_corridor_analytics
-- Issue: #785 (Stellar Corridor Charts API with PathPayment indexing)

-- ── CorridorPayment ────────────────────────────────────────────────────────
-- Cross-border payment corridor analytics for Stellar PathPayment operations.
-- Raw events are aggregated every 5 minutes into period buckets.
CREATE TABLE "CorridorPayment" (
    "id"               TEXT NOT NULL,
    "sourceCurrency"   TEXT NOT NULL,
    "destCurrency"     TEXT NOT NULL,
    "volume"           BIGINT NOT NULL,
    "transactionCount" INTEGER NOT NULL,
    "periodBucket"     TIMESTAMP(3) NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorridorPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CorridorPayment_sourceCurrency_destCurrency_periodBucket_key"
    ON "CorridorPayment"("sourceCurrency", "destCurrency", "periodBucket");

CREATE INDEX "CorridorPayment_sourceCurrency_idx" ON "CorridorPayment"("sourceCurrency");
CREATE INDEX "CorridorPayment_destCurrency_idx" ON "CorridorPayment"("destCurrency");
CREATE INDEX "CorridorPayment_periodBucket_idx" ON "CorridorPayment"("periodBucket");
CREATE INDEX "CorridorPayment_sourceCurrency_destCurrency_idx" ON "CorridorPayment"("sourceCurrency", "destCurrency");
