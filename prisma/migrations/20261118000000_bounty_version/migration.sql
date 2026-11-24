-- #1810: optimistic-concurrency version for bounty status transitions.
ALTER TABLE "Bounty" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
