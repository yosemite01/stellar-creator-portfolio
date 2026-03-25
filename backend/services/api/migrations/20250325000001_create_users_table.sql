-- Create users table for Stellar Platform
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address VARCHAR(56) UNIQUE NOT NULL,  -- Stellar public key format
    email VARCHAR(255) UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'CREATOR', 'CLIENT', 'ADMIN')),
    avatar_url TEXT,
    bio TEXT,
    discipline VARCHAR(100),  -- e.g., 'UI/UX Design', 'Content Writing'
    skills TEXT[],  -- Array of skills
    rating DECIMAL(3,2) DEFAULT 0.00 CHECK (rating >= 0 AND rating <= 5),
    completed_projects INTEGER DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for user queries
CREATE INDEX idx_users_wallet_address ON users(wallet_address);
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_discipline ON users(discipline) WHERE discipline IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_rating ON users(rating DESC);

COMMENT ON TABLE users IS 'Core user accounts for Stellar Platform';
COMMENT ON COLUMN users.wallet_address IS 'Stellar blockchain public key for authentication';
COMMENT ON COLUMN users.discipline IS 'Primary professional discipline';
