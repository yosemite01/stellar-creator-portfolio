-- Create refresh_tokens table for JWT refresh token management
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA256 hash of the actual token
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for token management queries
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at) WHERE revoked = FALSE;
CREATE INDEX idx_refresh_tokens_user_active ON refresh_tokens(user_id, revoked) WHERE revoked = FALSE;

COMMENT ON TABLE refresh_tokens IS 'Refresh tokens for JWT-based authentication';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'SHA256 hash of the actual refresh token - never store plaintext tokens';
