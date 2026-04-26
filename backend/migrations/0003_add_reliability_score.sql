-- Migration: Add reliability_score to creator_reputation and update aggregation function

-- 1. Add reliability_score column
ALTER TABLE creator_reputation ADD COLUMN IF NOT EXISTS reliability_score DECIMAL(4,2) NOT NULL DEFAULT 0.00;

-- 2. Update update_creator_reputation function to include reliability calculation
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
    v_reliability_score DECIMAL(4,2);
BEGIN
    -- Calculate standard aggregated statistics
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

    -- Calculate time-decayed reliability score
    -- Formula: SUM(value * e^(-0.02 * age_days)) / SUM(e^(-0.02 * age_days))
    -- Values: 5★=1.0, 4★=0.8, 3★=0.5, 2★=0.2, others=0.0
    SELECT 
        COALESCE(
            ROUND(
                (SUM(
                    CASE 
                        WHEN rating = 5 THEN 1.0
                        WHEN rating = 4 THEN 0.8
                        WHEN rating = 3 THEN 0.5
                        WHEN rating = 2 THEN 0.2
                        ELSE 0.0
                    END * EXP(-0.02 * GREATEST(0, EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0))
                ) / 
                NULLIF(SUM(EXP(-0.02 * GREATEST(0, EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0))), 0))::DECIMAL,
                2
            ),
            0.00
        )
    INTO v_reliability_score
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
        v_is_verified, v_reliability_score, NOW()
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
        reliability_score = EXCLUDED.reliability_score,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 3. Initial update for all existing creators
SELECT update_creator_reputation(creator_id) FROM (SELECT DISTINCT creator_id FROM reviews) as creators;
