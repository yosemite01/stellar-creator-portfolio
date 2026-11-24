-- CreateTable
CREATE TABLE "revoked_tokens" (
    "jti" UUID NOT NULL,
    "exp" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "idx_revoked_tokens_exp" ON "revoked_tokens"("exp");
