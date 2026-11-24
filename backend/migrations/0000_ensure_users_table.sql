-- 0001 alters `users`, which is normally created elsewhere. Create a minimal
-- table when it's missing so migrations also apply to an empty database (CI).
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
