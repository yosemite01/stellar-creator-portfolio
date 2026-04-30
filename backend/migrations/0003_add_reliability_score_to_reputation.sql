-- Add reliability_score to creator_reputation table
ALTER TABLE creator_reputation ADD COLUMN IF NOT EXISTS reliability_score DECIMAL(4,2) NOT NULL DEFAULT 0.00;

-- Update the update_creator_reputation function to maintain the reliability_score
-- Note: The complex time-decay calculation is handled in the application layer (Rust)
-- but we provide this column to store the calculated value.
CREATE OR REPLACE FUNCTION update_creator_reputation(p_creator_id VARCHAR(255), p_reliability_score DECIMAL(4,2) DEFAULT NULL)
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
        is_verified, reliability_score, updated_at
    ) VALUES (
        p_creator_id, v_avg_rating, v_total_reviews,
        v_stars_5, v_stars_4, v_stars_3, v_stars_2, v_stars_1,
        v_is_verified, COALESCE(p_reliability_score, 0.00), NOW()
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
        reliability_score = COALESCE(p_reliability_score, creator_reputation.reliability_score),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
