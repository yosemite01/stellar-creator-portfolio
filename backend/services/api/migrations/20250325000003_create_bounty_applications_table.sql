-- Create bounty_applications table for freelancer proposals
CREATE TABLE IF NOT EXISTS bounty_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bounty_id UUID NOT NULL REFERENCES bounties(id) ON DELETE CASCADE,
    applicant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposal TEXT NOT NULL,
    proposed_budget BIGINT NOT NULL CHECK (proposed_budget > 0),
    timeline_days INTEGER NOT NULL CHECK (timeline_days > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_bounty_applicant UNIQUE (bounty_id, applicant_id),
    CONSTRAINT proposal_budget_positive CHECK (proposed_budget > 0),
    CONSTRAINT timeline_positive CHECK (timeline_days > 0)
);

-- Indexes for application queries
CREATE INDEX idx_applications_bounty_id ON bounty_applications(bounty_id);
CREATE INDEX idx_applications_applicant_id ON bounty_applications(applicant_id);
CREATE INDEX idx_applications_status ON bounty_applications(status);
CREATE INDEX idx_applications_created_at ON bounty_applications(created_at DESC);
-- Composite indexes for common queries
CREATE INDEX idx_applications_bounty_status ON bounty_applications(bounty_id, status);
CREATE INDEX idx_applications_applicant_status ON bounty_applications(applicant_id, status);

COMMENT ON TABLE bounty_applications IS 'Freelancer proposals for bounty projects';
COMMENT ON COLUMN bounty_applications.proposed_budget IS 'Proposed budget in stroops';
COMMENT ON COLUMN bounty_applications.timeline_days IS 'Estimated completion time in days';
