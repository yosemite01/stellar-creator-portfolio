-- Add password_hash column to users table for optional email/password auth
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Add index for quick lookup by email (for password auth)
CREATE INDEX IF NOT EXISTS idx_users_email_lookup ON users(email) WHERE email IS NOT NULL;
