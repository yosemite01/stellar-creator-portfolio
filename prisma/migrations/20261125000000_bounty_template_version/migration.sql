-- #1821: revision counter for bounty templates, bumped on every edit.
ALTER TABLE "BountyTemplate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
