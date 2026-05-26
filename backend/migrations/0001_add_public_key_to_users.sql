-- Add public_key column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key VARCHAR(64) UNIQUE;
