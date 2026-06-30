-- Materialized view for bounty search — issue #744.
--
-- Pre-computes search-friendly columns so GET /search/hybrid queries never
-- touch the primary write database with full-table scans.
-- The view is refreshed asynchronously by the CQRS event projector whenever
-- a BountyCreated or bounty-mutating event is processed.

CREATE MATERIALIZED VIEW IF NOT EXISTS bounty_search_view AS
SELECT
  b.id,
  b."creatorId",
  b.title,
  b.description,
  b.budget,
  b.deadline,
  b.status,
  b.category,
  b.tags,
  b."createdAt",
  b."updatedAt",
  -- Pre-computed full-text search vector (title weighted higher than description)
  setweight(to_tsvector('english', coalesce(b.title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(b.description, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(b.category, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(array_to_string(b.tags, ' '), '')), 'A')
    AS search_vector,
  -- Denormalised skill tokens for exact-match filtering
  array_to_string(b.tags, ' ') AS skill_tokens
FROM "Bounty" b
WHERE b.status != 'CANCELLED';

-- Unique index required for concurrent refresh (no table lock during refresh)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bounty_search_view_id
  ON bounty_search_view (id);

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_bounty_search_view_fts
  ON bounty_search_view USING GIN (search_vector);

-- GIN index for tag array containment queries (@>)
CREATE INDEX IF NOT EXISTS idx_bounty_search_view_tags
  ON bounty_search_view USING GIN (tags);

-- B-tree indexes for budget range and status filters
CREATE INDEX IF NOT EXISTS idx_bounty_search_view_budget
  ON bounty_search_view (budget);

CREATE INDEX IF NOT EXISTS idx_bounty_search_view_status
  ON bounty_search_view (status);
