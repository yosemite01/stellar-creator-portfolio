//! Reputation and review aggregation for creators.
//!
//! Reviews are sourced from an in-memory seed list (replace with DB in production).
//! Aggregation computes average rating, totals, per-star counts, and a recent slice.

use serde::{Deserialize, Serialize};

/// Internal review row (includes `creator_id` for filtering).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Review {
    pub id: String,
    pub creator_id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    pub reviewer_name: String,
    pub created_at: String,
}

/// Public review without `creator_id` (returned to clients).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicReview {
    pub id: String,
    pub rating: u8,
    pub title: String,
    pub body: String,
    pub reviewer_name: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReputationAggregation {
    pub average_rating: f64,
    pub total_reviews: u32,
    pub stars_5: u32,
    pub stars_4: u32,
    pub stars_3: u32,
    pub stars_2: u32,
    pub stars_1: u32,
    pub is_verified: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorReputationPayload {
    pub creator_id: String,
    pub aggregation: ReputationAggregation,
    pub recent_reviews: Vec<PublicReview>,
}

/// Filter seed reviews for one creator.
pub fn reviews_for_creator(creator_id: &str) -> Vec<Review> {
    seed_reviews()
        .into_iter()
        .filter(|r| r.creator_id == creator_id)
        .collect()
}

/// Aggregate ratings: average (2 decimal places), counts per star (1–5). Ignores invalid ratings.
pub fn aggregate_reviews(reviews: &[Review]) -> ReputationAggregation {
    let mut stars = [0u32; 5];
    let mut sum: u64 = 0;
    let mut count: u32 = 0;

    for r in reviews {
        let b = r.rating;
        if !(1..=5).contains(&b) {
            continue;
        }
        sum += u64::from(b);
        count += 1;
        stars[usize::from(b - 1)] += 1;
    }

    let average_rating = if count == 0 {
        0.0
    } else {
        let raw = sum as f64 / f64::from(count);
        (raw * 100.0).round() / 100.0
    };

    let is_verified = count >= 3 && average_rating >= 4.5;

    ReputationAggregation {
        average_rating,
        total_reviews: count,
        stars_5: stars[4],
        stars_4: stars[3],
        stars_3: stars[2],
        stars_2: stars[1],
        stars_1: stars[0],
        is_verified,
    }
}

pub fn to_public_review(r: &Review) -> PublicReview {
    PublicReview {
        id: r.id.clone(),
        rating: r.rating,
        title: r.title.clone(),
        body: r.body.clone(),
        reviewer_name: r.reviewer_name.clone(),
        created_at: r.created_at.clone(),
    }
}

/// Most recent reviews (lexicographic `created_at` desc), capped.
pub fn recent_reviews(reviews: &[Review], limit: usize) -> Vec<PublicReview> {
    let mut owned: Vec<Review> = reviews.to_vec();
    owned.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    owned.into_iter().take(limit).map(|r| to_public_review(&r)).collect()
}

fn seed_reviews() -> Vec<Review> {
    vec![
        Review {
            id: "r-alex-1".into(),
            creator_id: "alex-studio".into(),
            rating: 5,
            title: "Exceptional design partner".into(),
            body: "Delivered a full design system on time; communication was clear throughout.".into(),
            reviewer_name: "Sam K.".into(),
            created_at: "2025-08-12".into(),
        },
        Review {
            id: "r-alex-2".into(),
            creator_id: "alex-studio".into(),
            rating: 5,
            title: "Would hire again".into(),
            body: "Thoughtful UX and polished handoff files.".into(),
            reviewer_name: "River Corp".into(),
            created_at: "2025-06-01".into(),
        },
        Review {
            id: "r-alex-3".into(),
            creator_id: "alex-studio".into(),
            rating: 4,
            title: "Strong work".into(),
            body: "Minor iteration rounds but outcome exceeded expectations.".into(),
            reviewer_name: "Jamie L.".into(),
            created_at: "2024-11-20".into(),
        },
        Review {
            id: "r-maya-1".into(),
            creator_id: "maya-writes".into(),
            rating: 5,
            title: "Brilliant strategist".into(),
            body: "Content calendar and tone guide were exactly what we needed.".into(),
            reviewer_name: "Northwind".into(),
            created_at: "2025-09-05".into(),
        },
        Review {
            id: "r-maya-2".into(),
            creator_id: "maya-writes".into(),
            rating: 4,
            title: "Great collaborator".into(),
            body: "Fast turnaround on technical docs.".into(),
            reviewer_name: "DevTools Inc".into(),
            created_at: "2025-03-18".into(),
        },
        Review {
            id: "r-jordan-1".into(),
            creator_id: "jordan-creative".into(),
            rating: 5,
            title: "Campaign crushed metrics".into(),
            body: "Video series drove 2x engagement vs prior quarter.".into(),
            reviewer_name: "Pulse Media".into(),
            created_at: "2025-07-22".into(),
        },
        Review {
            id: "r-jordan-2".into(),
            creator_id: "jordan-creative".into(),
            rating: 3,
            title: "Good creative, tight deadlines".into(),
            body: "Quality was high; a few deliverables needed small revisions.".into(),
            reviewer_name: "Studio 9".into(),
            created_at: "2024-12-10".into(),
        },
        Review {
            id: "r-sophia-1".into(),
            creator_id: "sophia-ux".into(),
            rating: 5,
            title: "Research excellence".into(),
            body: "Usability study findings directly shaped our roadmap.".into(),
            reviewer_name: "HealthApp".into(),
            created_at: "2025-10-01".into(),
        },
        Review {
            id: "r-sophia-2".into(),
            creator_id: "sophia-ux".into(),
            rating: 5,
            title: "Accessibility champion".into(),
            body: "WCAG remediation plan was thorough and actionable.".into(),
            reviewer_name: "OpenGov".into(),
            created_at: "2025-01-15".into(),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_reviews() -> Vec<Review> {
        vec![
            Review {
                id: "a".into(),
                creator_id: "c1".into(),
                rating: 5,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-02".into(),
            },
            Review {
                id: "b".into(),
                creator_id: "c1".into(),
                rating: 4,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2025-01-01".into(),
            },
            Review {
                id: "c".into(),
                creator_id: "c1".into(),
                rating: 0,
                title: "".into(),
                body: "".into(),
                reviewer_name: "".into(),
                created_at: "2024-01-01".into(),
            },
        ]
    }

    #[test]
    fn aggregate_empty() {
        let agg = aggregate_reviews(&[]);
        assert_eq!(agg.total_reviews, 0);
        assert_eq!(agg.average_rating, 0.0);
        assert_eq!(agg.stars_5, 0);
    }

    #[test]
    fn aggregate_skips_invalid_and_histogram() {
        let agg = aggregate_reviews(&sample_reviews());
        assert_eq!(agg.total_reviews, 2);
        assert_eq!(agg.average_rating, 4.5);
        assert_eq!(agg.stars_5, 1);
        assert_eq!(agg.stars_4, 1);
        assert_eq!(agg.stars_3, 0);
        assert_eq!(agg.is_verified, false, "need at least 3 reviews");
    }

    #[test]
    fn aggregate_verified_threshold() {
        let mut revs = sample_reviews();
        // Add a third valid high-rating review
        revs.push(Review {
            id: "d".into(),
            creator_id: "c1".into(),
            rating: 5,
            title: "".into(),
            body: "".into(),
            reviewer_name: "".into(),
            created_at: "2025-01-03".into(),
        });
        let agg = aggregate_reviews(&revs);
        assert_eq!(agg.total_reviews, 3);
        assert!(agg.average_rating >= 4.5);
        assert_eq!(agg.is_verified, true);
    }

    #[test]
    fn recent_reviews_sorted_newest_first() {
        let revs = sample_reviews();
        let recent = recent_reviews(&revs, 2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, "a");
        assert_eq!(recent[1].id, "b");
    }

    #[test]
    fn seed_covers_profile_creator_ids() {
        let ids = ["alex-studio", "maya-writes", "jordan-creative", "sophia-ux"];
        for id in ids {
            assert!(
                !reviews_for_creator(id).is_empty(),
                "expected seed reviews for {id}"
            );
        }
    }
}
