CREATE TABLE IF NOT EXISTS used_refresh_tokens (
    token_hash BYTEA PRIMARY KEY,
    user_id TEXT NOT NULL,
    family_id UUID NOT NULL,
    used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_used_refresh_tokens_user_id
    ON used_refresh_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_used_refresh_tokens_family_id
    ON used_refresh_tokens (family_id);
