-- AlterTable
ALTER TABLE "CreatorProfile" ADD COLUMN "completionScore" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "CreatorProfile_completionScore_idx" ON "CreatorProfile"("completionScore");
