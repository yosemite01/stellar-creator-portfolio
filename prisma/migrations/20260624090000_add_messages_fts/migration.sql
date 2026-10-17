-- Migration: Add full-text search support to the messages table
-- Issue #822 — Message search with full-text indexing
--
-- What this migration does:
--   1. Adds a plain_text column to store decrypted message body server-side
--      (populated by the application layer when a message is stored).
--   2. Adds a tsvector column (search_vector) derived from plain_text.
--   3. Creates a GIN index on search_vector for fast FTS queries.
--   4. Installs a trigger that keeps search_vector in sync whenever
--      plain_text is inserted or updated.
--   5. Adds a composite index on (thread_id, created_at DESC) to support
--      efficient conversation-scoped searches without a full table scan.
--   6. Adds an index on sender_id for address-based filtering.

-- No migration creates the messages table (the messages API currently keeps
-- conversations in memory), so on a database built from migrations this
-- whole step is skipped instead of failing with 'relation "messages" does
-- not exist'. Where the table has been created out of band, it runs as
-- before.
DO $$
BEGIN
  IF to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'messages table not present; skipping full-text search setup';
    RETURN;
  END IF;

  -- ── 1. Add plain_text column (nullable; encryption keeps ciphertext primary) ──
  ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS plain_text TEXT;

  -- ── 2. Add the tsvector column ────────────────────────────────────────────────
  ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

  -- ── 3. Backfill search_vector for any existing rows that have plain_text ──────
  UPDATE messages
  SET search_vector = to_tsvector('english', COALESCE(plain_text, ''))
  WHERE plain_text IS NOT NULL;

  -- ── 4. GIN index for fast FTS lookups ─────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_messages_search_vector
    ON messages USING GIN (search_vector);

  -- ── 5. Trigger function: auto-update search_vector on INSERT/UPDATE ────────────
  CREATE OR REPLACE FUNCTION messages_search_vector_update()
  RETURNS TRIGGER AS $fn$
  BEGIN
    NEW.search_vector := to_tsvector('english', COALESCE(NEW.plain_text, ''));
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;

  -- Drop trigger first so this migration is idempotent (re-runnable in dev).
  DROP TRIGGER IF EXISTS trig_messages_search_vector ON messages;

  CREATE TRIGGER trig_messages_search_vector
    BEFORE INSERT OR UPDATE OF plain_text
    ON messages
    FOR EACH ROW
    EXECUTE FUNCTION messages_search_vector_update();

  -- ── 6. Composite index for conversation-scoped search ─────────────────────────
  -- Supports: WHERE thread_id = $1 AND search_vector @@ query ORDER BY created_at DESC
  CREATE INDEX IF NOT EXISTS idx_messages_thread_created
    ON messages (thread_id, created_at DESC);

  -- ── 7. Index on sender_id for address-based filtering ─────────────────────────
  CREATE INDEX IF NOT EXISTS idx_messages_sender
    ON messages (sender_id);
END
$$;

-- ── Example query (not executed — for documentation) ──────────────────────────
--
-- Full-text search across all conversations:
--   SELECT id, thread_id, sender_id, created_at,
--          ts_headline('english', plain_text, q, 'MaxWords=20, MinWords=5') AS snippet
--   FROM messages, plainto_tsquery('english', $1) q
--   WHERE search_vector @@ q
--   ORDER BY ts_rank(search_vector, q) DESC, created_at DESC
--   LIMIT 50;
--
-- Conversation-scoped search:
--   ... WHERE thread_id = $2 AND search_vector @@ q ...
