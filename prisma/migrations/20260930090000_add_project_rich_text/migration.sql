-- Issue #1337: persist sanitized rich-text project details

CREATE TABLE "Project" (
  "id"          TEXT         NOT NULL,
  "creatorId"   TEXT         NOT NULL,
  "title"       TEXT         NOT NULL,
  "category"    TEXT         NOT NULL,
  "description" TEXT         NOT NULL,
  "tags"        TEXT[],
  "year"        INTEGER      NOT NULL,
  "link"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Project_creatorId_idx" ON "Project"("creatorId");
CREATE INDEX "Project_category_idx" ON "Project"("category");

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
