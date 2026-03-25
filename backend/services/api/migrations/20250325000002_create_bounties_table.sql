-- Create bounties table for project listings
CREATE TABLE IF NOT EXISTS bounties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    budget BIGINT NOT NULL CHECK (budget > 0),  -- Stored in stroops (1 XLM = 10^7 stroops)
    deadline TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    category VARCHAR(100),
    tags TEXT[],
    applications_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bounty_deadline_future CHECK (deadline > NOW()),
    CONSTRAINT bounty_budget_positive CHECK (budget > 0)
);

-- Indexes for bounty queries
CREATE INDEX idx_bounties_creator_id ON bounties(creator_id);
CREATE INDEX idx_bounties_status ON bounties(status);
CREATE INDEX idx_bounties_category ON bounties(category) WHERE category IS NOT NULL;
CREATE INDEX idx_bounties_deadline ON bounties(deadline);
CREATE INDEX idx_bounties_budget ON bounties(budget);
CREATE INDEX idx_bounties_created_at ON bounties(created_at DESC);
-- Composite index for common filter combinations
CREATE INDEX idx_bounties_status_category ON bounties(status, category) WHERE category IS NOT NULL;
CREATE INDEX idx_bounties_status_open ON bounties(status, created_at DESC) WHERE status = 'OPEN';

COMMENT ON TABLE bounties IS 'Bounty project listings on Stellar Platform';
COMMENT ON COLUMN bounties.budget IS 'Budget in stroops (1 XLM = 10,000,000 stroops)';
