-- Create escrow_accounts table for secure payment handling
CREATE TABLE IF NOT EXISTS escrow_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bounty_id UUID NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
    application_id UUID REFERENCES bounty_applications(id) ON DELETE SET NULL,
    client_wallet VARCHAR(56) NOT NULL,  -- Stellar public key
    freelancer_wallet VARCHAR(56),          -- Stellar public key (set after acceptance)
    total_amount BIGINT NOT NULL CHECK (total_amount > 0),  -- in stroops
    released_amount BIGINT NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'FUNDED' CHECK (status IN ('FUNDED', 'PARTIALLY_RELEASED', 'RELEASED', 'REFUNDED', 'DISPUTED')),
    stellar_escrow_account VARCHAR(56),  -- The escrow account public key on Stellar
    milestones JSONB DEFAULT '[]',  -- Array of milestone objects: [{amount, description, released}]
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT released_not_exceed_total CHECK (released_amount <= total_amount)
);

-- Indexes for escrow queries
CREATE INDEX idx_escrow_bounty_id ON escrow_accounts(bounty_id);
CREATE INDEX idx_escrow_application_id ON escrow_accounts(application_id) WHERE application_id IS NOT NULL;
CREATE INDEX idx_escrow_client_wallet ON escrow_accounts(client_wallet);
CREATE INDEX idx_escrow_freelancer_wallet ON escrow_accounts(freelancer_wallet) WHERE freelancer_wallet IS NOT NULL;
CREATE INDEX idx_escrow_status ON escrow_accounts(status);
CREATE INDEX idx_escrow_stellar_account ON escrow_accounts(stellar_escrow_account) WHERE stellar_escrow_account IS NOT NULL;

COMMENT ON TABLE escrow_accounts IS 'Escrow accounts for secure bounty payment handling';
COMMENT ON COLUMN escrow_accounts.total_amount IS 'Total escrow amount in stroops';
COMMENT ON COLUMN escrow_accounts.released_amount IS 'Amount already released to freelancer in stroops';
COMMENT ON COLUMN escrow_accounts.milestones IS 'JSON array of milestone objects with amount, description, and released flag';
