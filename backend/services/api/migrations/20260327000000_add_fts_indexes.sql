-- Full-text search indexes for bounties and freelancers.
--
-- We use generated tsvector columns (stored) so that the document is kept
-- up-to-date automatically on INSERT/UPDATE and the index never falls behind.
-- english stemming handles plurals, stop-words, etc.

-- ── Bounties ──────────────────────────────────────────────────────────────────

ALTER TABLE bounties
    ADD COLUMN IF NOT EXISTS fts tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(status, '')), 'C')
        ) STORED;

CREATE INDEX IF NOT EXISTS idx_bounties_fts ON bounties USING GIN (fts);

-- ── Freelancers ───────────────────────────────────────────────────────────────

ALTER TABLE freelancers
    ADD COLUMN IF NOT EXISTS fts tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(discipline, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(bio, '')), 'B')
        ) STORED;

CREATE INDEX IF NOT EXISTS idx_freelancers_fts ON freelancers USING GIN (fts);