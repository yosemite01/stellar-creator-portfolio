-- Postgres full-text search for creator discovery.
-- Issue #776: Add full-text search indexes for creators in Postgres so the
-- hybrid search endpoint can serve relevant, typo-tolerant results without
-- Elasticsearch.

-- pg_trgm powers similarity()/fuzzy matching for typo tolerance.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated tsvector column keeps the search document in sync automatically on
-- every INSERT/UPDATE. English stemming handles plurals and stop-words.
-- Weights: name + discipline (A), bio + skills (B).
ALTER TABLE "CreatorProfile"
  ADD COLUMN IF NOT EXISTS "fts" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("displayName", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("discipline", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("bio", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string("skills", ' '), '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS "CreatorProfile_fts_idx"
  ON "CreatorProfile" USING GIN ("fts");

-- Trigram index for typo-tolerant prefix matching on display names.
CREATE INDEX IF NOT EXISTS "CreatorProfile_displayName_trgm_idx"
  ON "CreatorProfile" USING GIN ("displayName" gin_trgm_ops);
