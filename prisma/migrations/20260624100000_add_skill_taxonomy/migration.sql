-- Migration: Add skill taxonomy table and skill_ids columns
-- Issue #828: Skills taxonomy and auto-suggest system

CREATE TABLE IF NOT EXISTS skill_taxonomy (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  category    TEXT NOT NULL,
  parent_id   TEXT REFERENCES skill_taxonomy(id)
);

CREATE INDEX IF NOT EXISTS idx_skill_taxonomy_name
  ON skill_taxonomy USING gin(to_tsvector('english', name));

CREATE INDEX IF NOT EXISTS idx_skill_taxonomy_category
  ON skill_taxonomy (category);

-- Add canonical skill_ids arrays to bounties and profiles
-- These store taxonomy IDs (or 'custom:<value>' for unrecognised skills)
ALTER TABLE IF EXISTS bounties
  ADD COLUMN IF NOT EXISTS skill_ids TEXT[] DEFAULT '{}';

ALTER TABLE IF EXISTS profiles
  ADD COLUMN IF NOT EXISTS skill_ids TEXT[] DEFAULT '{}';

-- Index for matching engine lookups (array containment @> operator).
-- Guarded like the ALTERs above: the snake_case bounties/profiles tables
-- only exist where they were created outside these migrations.
DO $$
BEGIN
  IF to_regclass('public.bounties') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_bounties_skill_ids
      ON bounties USING gin(skill_ids);
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_profiles_skill_ids
      ON profiles USING gin(skill_ids);
  END IF;
END
$$;
