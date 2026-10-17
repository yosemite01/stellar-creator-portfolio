-- Migration: add testimonials table
-- Issue #819: testimonials and case studies with real client data

CREATE TABLE IF NOT EXISTS testimonials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT NOT NULL,
  creator_id    TEXT NOT NULL,
  bounty_id     TEXT,
  quote         TEXT NOT NULL,
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  featured      BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  video_url     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_testimonials_featured ON testimonials (featured, status);
CREATE INDEX IF NOT EXISTS idx_testimonials_creator  ON testimonials (creator_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_client   ON testimonials (client_id);
