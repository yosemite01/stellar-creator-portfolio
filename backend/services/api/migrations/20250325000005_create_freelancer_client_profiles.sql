-- Create freelancer_profiles table for extended creator/creator profile data
CREATE TABLE IF NOT EXISTS freelancer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    portfolio_urls TEXT[],  -- Array of portfolio website/project URLs
    linkedin_url TEXT,
    twitter_handle VARCHAR(15),
    availability_status VARCHAR(20) DEFAULT 'AVAILABLE' CHECK (availability_status IN ('AVAILABLE', 'BUSY', 'NOT_AVAILABLE')),
    hourly_rate BIGINT,  -- in stroops, optional
    preferred_payment_method VARCHAR(20) DEFAULT 'STELLAR' CHECK (preferred_payment_method IN ('STELLAR', 'USDC', 'XRP')),
    preferred_budget_min BIGINT,  -- Minimum preferred bounty budget in stroops
    preferred_budget_max BIGINT,  -- Maximum preferred bounty budget in stroops
    total_earnings BIGINT DEFAULT 0,  -- Lifetime earnings in stroops
    success_rate DECIMAL(5,2) DEFAULT 0.00,  -- Percentage of completed bounties
    response_time_hours INTEGER,  -- Average response time
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create client_profiles table for client/employer profile data
CREATE TABLE IF NOT EXISTS client_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(255),
    company_website TEXT,
    linkedin_url TEXT,
    verified_company BOOLEAN DEFAULT FALSE,
    total_spent BIGINT DEFAULT 0,  -- Lifetime spending in stroops
    total_bounties_posted INTEGER DEFAULT 0,
    total_bounties_completed INTEGER DEFAULT 0,
    avg_rating DECIMAL(3,2) DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for profile queries
CREATE INDEX idx_freelancer_user_id ON freelancer_profiles(user_id);
CREATE INDEX idx_freelancer_availability ON freelancer_profiles(availability_status);
CREATE INDEX idx_freelancer_budget_range ON freelancer_profiles(preferred_budget_min, preferred_budget_max) 
    WHERE preferred_budget_min IS NOT NULL AND preferred_budget_max IS NOT NULL;

CREATE INDEX idx_client_user_id ON client_profiles(user_id);
CREATE INDEX idx_client_verified ON client_profiles(verified_company);

COMMENT ON TABLE freelancer_profiles IS 'Extended profile data for freelancers/creators on Stellar Platform';
COMMENT ON TABLE client_profiles IS 'Extended profile data for clients/employers on Stellar Platform';
