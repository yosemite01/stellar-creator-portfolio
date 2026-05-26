-- Create reviews and creator_reputation tables for the reputation system

-- Reviews table to store individual reviews
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id VARCHAR(255) NOT NULL,
    bounty_id VARCHAR(255) NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    reviewer_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Creator reputation aggregation table for performance
CREATE TABLE IF NOT EXISTS creator_reputation (
    creator_id VARCHAR(255) PRIMARY KEY,
    average_rating DECIMAL(4,2) NOT NULL DEFAULT 0.00,
    total_reviews INTEGER NOT NULL DEFAULT 0,
    stars_5 INTEGER NOT NULL DEFAULT 0,
    stars_4 INTEGER NOT NULL DEFAULT 0,
    stars_3 INTEGER NOT NULL DEFAULT 0,
    stars_2 INTEGER NOT NULL DEFAULT 0,
    stars_1 INTEGER NOT NULL DEFAULT 0,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reviews_creator_id ON reviews(creator_id);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_bounty_id ON reviews(bounty_id);

-- Function to update creator reputation when reviews change
CREATE OR REPLACE FUNCTION update_creator_reputation(p_creator_id VARCHAR(255))
RETURNS VOID AS $$
DECLARE
    v_avg_rating DECIMAL(4,2);
    v_total_reviews INTEGER;
    v_stars_5 INTEGER;
    v_stars_4 INTEGER;
    v_stars_3 INTEGER;
    v_stars_2 INTEGER;
    v_stars_1 INTEGER;
    v_is_verified BOOLEAN;
BEGIN
    -- Calculate aggregated statistics
    SELECT 
        COALESCE(ROUND(AVG(rating::DECIMAL), 2), 0.00),
        COUNT(*),
        COUNT(*) FILTER (WHERE rating = 5),
        COUNT(*) FILTER (WHERE rating = 4),
        COUNT(*) FILTER (WHERE rating = 3),
        COUNT(*) FILTER (WHERE rating = 2),
        COUNT(*) FILTER (WHERE rating = 1)
    INTO 
        v_avg_rating,
        v_total_reviews,
        v_stars_5,
        v_stars_4,
        v_stars_3,
        v_stars_2,
        v_stars_1
    FROM reviews 
    WHERE creator_id = p_creator_id;

    -- Determine verification status (≥3 reviews AND ≥4.5 average rating)
    v_is_verified := (v_total_reviews >= 3 AND v_avg_rating >= 4.5);

    -- Insert or update creator reputation
    INSERT INTO creator_reputation (
        creator_id, average_rating, total_reviews, 
        stars_5, stars_4, stars_3, stars_2, stars_1, 
        is_verified, updated_at
    ) VALUES (
        p_creator_id, v_avg_rating, v_total_reviews,
        v_stars_5, v_stars_4, v_stars_3, v_stars_2, v_stars_1,
        v_is_verified, NOW()
    )
    ON CONFLICT (creator_id) 
    DO UPDATE SET
        average_rating = EXCLUDED.average_rating,
        total_reviews = EXCLUDED.total_reviews,
        stars_5 = EXCLUDED.stars_5,
        stars_4 = EXCLUDED.stars_4,
        stars_3 = EXCLUDED.stars_3,
        stars_2 = EXCLUDED.stars_2,
        stars_1 = EXCLUDED.stars_1,
        is_verified = EXCLUDED.is_verified,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update reputation when reviews are inserted/updated/deleted
CREATE OR REPLACE FUNCTION trigger_update_creator_reputation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM update_creator_reputation(OLD.creator_id);
        RETURN OLD;
    ELSE
        PERFORM update_creator_reputation(NEW.creator_id);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS reviews_update_reputation ON reviews;
CREATE TRIGGER reviews_update_reputation
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_creator_reputation();

-- Insert seed data for existing creators (matching the current seed data)
INSERT INTO reviews (id, creator_id, bounty_id, rating, title, body, reviewer_name, created_at) VALUES
    ('550e8400-e29b-41d4-a716-446655440001', 'alex-studio', 'bounty-001', 5, 'Outstanding work!', 'Alex delivered exceptional quality work ahead of schedule. The design was exactly what we needed and the communication was excellent throughout the project.', 'Sarah Chen', '2025-01-15 10:30:00+00'),
    ('550e8400-e29b-41d4-a716-446655440002', 'alex-studio', 'bounty-002', 5, 'Highly recommended', 'Professional, creative, and reliable. Alex understood our requirements perfectly and delivered beyond expectations.', 'Mike Johnson', '2025-01-10 14:20:00+00'),
    ('550e8400-e29b-41d4-a716-446655440003', 'alex-studio', 'bounty-003', 4, 'Great collaboration', 'Solid work with good attention to detail. Minor revisions were needed but Alex was responsive to feedback.', 'Lisa Wang', '2025-01-05 09:15:00+00'),
    ('550e8400-e29b-41d4-a716-446655440004', 'alex-studio', 'bounty-004', 5, 'Excellent designer', 'Top-notch design skills and great project management. Will definitely work with Alex again.', 'David Rodriguez', '2024-12-28 16:45:00+00'),
    ('550e8400-e29b-41d4-a716-446655440005', 'alex-studio', 'bounty-005', 4, 'Good experience', 'Quality work delivered on time. Alex was professional and easy to work with throughout the project.', 'Emma Thompson', '2024-12-20 11:30:00+00'),
    
    ('550e8400-e29b-41d4-a716-446655440006', 'maria-dev', 'bounty-006', 5, 'Exceptional developer', 'Maria is an outstanding developer with deep technical expertise. The code quality was excellent and well-documented.', 'John Smith', '2025-01-12 13:25:00+00'),
    ('550e8400-e29b-41d4-a716-446655440007', 'maria-dev', 'bounty-007', 5, 'Perfect execution', 'Flawless implementation of complex requirements. Maria exceeded all expectations and delivered early.', 'Anna Lee', '2025-01-08 15:40:00+00'),
    ('550e8400-e29b-41d4-a716-446655440008', 'maria-dev', 'bounty-008', 4, 'Solid development', 'Good technical skills and reliable delivery. Communication could be improved but the end result was great.', 'Robert Kim', '2024-12-30 10:20:00+00'),
    
    ('550e8400-e29b-41d4-a716-446655440009', 'james-writer', 'bounty-009', 4, 'Quality content', 'James delivered well-researched and engaging content. The writing style matched our brand voice perfectly.', 'Sophie Martin', '2025-01-14 12:10:00+00'),
    ('550e8400-e29b-41d4-a716-446655440010', 'james-writer', 'bounty-010', 3, 'Decent work', 'The content was acceptable but required more revisions than expected. James was responsive to feedback.', 'Carlos Mendez', '2025-01-06 14:55:00+00'),
    
    ('550e8400-e29b-41d4-a716-446655440011', 'sarah-marketing', 'bounty-011', 5, 'Marketing genius', 'Sarah created an amazing marketing campaign that exceeded our ROI targets. Highly strategic and creative approach.', 'Peter Chang', '2025-01-11 09:30:00+00'),
    ('550e8400-e29b-41d4-a716-446655440012', 'sarah-marketing', 'bounty-012', 4, 'Good results', 'Solid marketing strategy with measurable results. Sarah was professional and delivered on time.', 'Rachel Green', '2025-01-03 16:20:00+00')
ON CONFLICT (id) DO NOTHING;

-- Update reputation for all creators with seed data
SELECT update_creator_reputation('alex-studio');
SELECT update_creator_reputation('maria-dev');
SELECT update_creator_reputation('james-writer');
SELECT update_creator_reputation('sarah-marketing');