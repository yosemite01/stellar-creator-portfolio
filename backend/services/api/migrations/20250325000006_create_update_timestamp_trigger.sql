-- Create updated_at trigger function for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at column
DO $$
DECLARE
    tables_with_updated_at TEXT[] := ARRAY[
        'users',
        'bounties',
        'bounty_applications',
        'escrow_accounts',
        'freelancer_profiles',
        'client_profiles'
    ];
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY tables_with_updated_at
    LOOP
        -- Drop existing trigger if exists
        DROP TRIGGER IF EXISTS update_{tbl}_updated_at ON tbl;
        -- Create trigger
        CREATE TRIGGER update_{tbl}_updated_at
            BEFORE UPDATE ON {tbl}
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create function to update bounties applications_count
CREATE OR REPLACE FUNCTION update_bounty_applications_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'PENDING' THEN
        UPDATE bounties SET applications_count = applications_count + 1 WHERE id = NEW.bounty_id;
    ELSIF TG_OP = 'DELETE' AND OLD.status = 'PENDING' THEN
        UPDATE bounties SET applications_count = GREATEST(applications_count - 1, 0) WHERE id = OLD.bounty_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bounty_applications_count_trigger
    AFTER INSERT OR DELETE ON bounty_applications
    FOR EACH ROW
    EXECUTE FUNCTION update_bounty_applications_count();

-- Create function to update freelancer stats on bounty completion
CREATE OR REPLACE FUNCTION update_freelancer_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'COMPLETED' AND OLD.status = 'IN_PROGRESS' THEN
        UPDATE freelancer_profiles 
        SET 
            completed_projects = completed_projects + 1,
            total_earnings = total_earnings + NEW.released_amount
        WHERE user_id = (
            SELECT applicant_id FROM bounty_applications 
            WHERE id = NEW.application_id
        );
        
        UPDATE users 
        SET rating = (
            SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE creator_id = (
                SELECT applicant_id FROM bounty_applications WHERE id = NEW.application_id
            )
        )
        WHERE id = (
            SELECT applicant_id FROM bounty_applications WHERE id = NEW.application_id
        );
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER escrow_completion_trigger
    AFTER UPDATE ON escrow_accounts
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION update_freelancer_stats();

COMMENT ON FUNCTION update_updated_at_column IS 'Automatically updates the updated_at column on row update';
COMMENT ON FUNCTION update_bounty_applications_count IS 'Keeps bounties.applications_count in sync with actual application count';
COMMENT ON FUNCTION update_freelancer_stats IS 'Updates freelancer statistics when escrow is released';
