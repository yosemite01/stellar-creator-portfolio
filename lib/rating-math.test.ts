import { describe, it, expect } from 'vitest';
import { formatRating } from './utils';
import { validateReview, type ReviewSubmission, type FieldError } from './api-models';

describe('Rating Math - Frontend Utilities', () => {
  describe('formatRating', () => {
    it('formats rating with review count', () => {
      expect(formatRating(4.8, 82)).toBe('4.8 / 5 (82)');
    });

    it('formats rating without review count', () => {
      expect(formatRating(4.5)).toBe('4.5 / 5');
    });

    it('returns no ratings message when undefined', () => {
      expect(formatRating(undefined)).toBe('No ratings yet');
    });

    it('formats rating with zero review count', () => {
      expect(formatRating(3.2, 0)).toBe('3.2 / 5 (0)');
    });

    it('formats perfect rating', () => {
      expect(formatRating(5.0, 100)).toBe('5.0 / 5 (100)');
    });

    it('formats minimum rating', () => {
      expect(formatRating(1.0, 5)).toBe('1.0 / 5 (5)');
    });

    it('handles decimal precision correctly', () => {
      expect(formatRating(4.67, 15)).toBe('4.7 / 5 (15)');
    });

    it('handles single review count', () => {
      expect(formatRating(5.0, 1)).toBe('5.0 / 5 (1)');
    });
  });

  describe('validateReview - Rating Validation', () => {
    const validReview: ReviewSubmission = {
      bountyId: 'b-1',
      creatorId: 'c-1',
      rating: 5,
      title: 'Great work',
      body: 'Delivered on time and exceeded expectations.',
      reviewerName: 'Jane D.',
    };

    it('accepts valid rating of 1', () => {
      const review = { ...validReview, rating: 1 };
      expect(validateReview(review)).toBeNull();
    });

    it('accepts valid rating of 5', () => {
      const review = { ...validReview, rating: 5 };
      expect(validateReview(review)).toBeNull();
    });

    it('accepts valid rating of 3', () => {
      const review = { ...validReview, rating: 3 };
      expect(validateReview(review)).toBeNull();
    });

    it('rejects rating of 0', () => {
      const review = { ...validReview, rating: 0 };
      const errors = validateReview(review);
      expect(errors).not.toBeNull();
      expect(errors?.some(e => e.field === 'rating')).toBe(true);
    });

    it('rejects rating of 6', () => {
      const review = { ...validReview, rating: 6 };
      const errors = validateReview(review);
      expect(errors).not.toBeNull();
      expect(errors?.some(e => e.field === 'rating')).toBe(true);
    });

    it('rejects negative rating', () => {
      const review = { ...validReview, rating: -1 };
      const errors = validateReview(review);
      expect(errors).not.toBeNull();
      expect(errors?.some(e => e.field === 'rating')).toBe(true);
    });

    it('rejects rating above maximum', () => {
      const review = { ...validReview, rating: 10 };
      const errors = validateReview(review);
      expect(errors).not.toBeNull();
      expect(errors?.some(e => e.field === 'rating')).toBe(true);
    });

    it('rejects missing rating', () => {
      const review = { ...validReview, rating: undefined as any };
      const errors = validateReview(review);
      expect(errors).not.toBeNull();
      expect(errors?.some(e => e.field === 'rating')).toBe(true);
    });

    it('provides correct error message for invalid rating', () => {
      const review = { ...validReview, rating: 0 };
      const errors = validateReview(review);
      const ratingError = errors?.find(e => e.field === 'rating');
      expect(ratingError?.message).toBe('Rating must be between 1 and 5');
    });
  });
});

describe('Rating Math - Aggregation Logic Tests', () => {
  // These tests mirror the Rust backend logic to ensure consistency
  
  interface Review {
    id: string;
    creator_id: string;
    rating: number;
    title: string;
    body: string;
    reviewer_name: string;
    created_at: string;
  }

  interface ReputationAggregation {
    average_rating: number;
    total_reviews: number;
    stars_5: number;
    stars_4: number;
    stars_3: number;
    stars_2: number;
    stars_1: number;
    is_verified: boolean;
  }

  // JavaScript implementation of the Rust aggregation logic for testing
  function aggregateReviews(reviews: Review[]): ReputationAggregation {
    const stars = [0, 0, 0, 0, 0]; // [1-star, 2-star, 3-star, 4-star, 5-star]
    let sum = 0;
    let count = 0;

    for (const review of reviews) {
      const rating = review.rating;
      if (rating < 1 || rating > 5) {
        continue; // Skip invalid ratings
      }
      sum += rating;
      count += 1;
      stars[rating - 1] += 1;
    }

    const average_rating = count === 0 ? 0.0 : Math.round((sum / count) * 100) / 100;
    const is_verified = count >= 3 && average_rating >= 4.5;

    return {
      average_rating,
      total_reviews: count,
      stars_5: stars[4],
      stars_4: stars[3],
      stars_3: stars[2],
      stars_2: stars[1],
      stars_1: stars[0],
      is_verified,
    };
  }

  const sampleReviews: Review[] = [
    {
      id: 'a',
      creator_id: 'c1',
      rating: 5,
      title: 'Excellent',
      body: 'Great work',
      reviewer_name: 'John',
      created_at: '2025-01-02',
    },
    {
      id: 'b',
      creator_id: 'c1',
      rating: 4,
      title: 'Good',
      body: 'Nice work',
      reviewer_name: 'Jane',
      created_at: '2025-01-01',
    },
    {
      id: 'c',
      creator_id: 'c1',
      rating: 0, // Invalid rating
      title: 'Invalid',
      body: 'Should be ignored',
      reviewer_name: 'Invalid',
      created_at: '2024-01-01',
    },
  ];

  describe('aggregateReviews', () => {
    it('handles empty reviews array', () => {
      const result = aggregateReviews([]);
      expect(result.total_reviews).toBe(0);
      expect(result.average_rating).toBe(0.0);
      expect(result.stars_5).toBe(0);
      expect(result.stars_4).toBe(0);
      expect(result.stars_3).toBe(0);
      expect(result.stars_2).toBe(0);
      expect(result.stars_1).toBe(0);
      expect(result.is_verified).toBe(false);
    });

    it('skips invalid ratings and computes histogram correctly', () => {
      const result = aggregateReviews(sampleReviews);
      expect(result.total_reviews).toBe(2); // Only valid ratings counted
      expect(result.average_rating).toBe(4.5); // (5 + 4) / 2 = 4.5
      expect(result.stars_5).toBe(1);
      expect(result.stars_4).toBe(1);
      expect(result.stars_3).toBe(0);
      expect(result.stars_2).toBe(0);
      expect(result.stars_1).toBe(0);
      expect(result.is_verified).toBe(false); // Need at least 3 reviews
    });

    it('calculates verification status correctly with sufficient reviews', () => {
      const reviews = [
        ...sampleReviews,
        {
          id: 'd',
          creator_id: 'c1',
          rating: 5,
          title: 'Amazing',
          body: 'Perfect work',
          reviewer_name: 'Bob',
          created_at: '2025-01-03',
        },
      ];
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(3);
      expect(result.average_rating).toBeCloseTo(4.67, 2); // (5 + 4 + 5) / 3 ≈ 4.67
      expect(result.is_verified).toBe(true); // >= 3 reviews and >= 4.5 average
    });

    it('does not verify with low average rating', () => {
      const reviews = [
        {
          id: 'a',
          creator_id: 'c1',
          rating: 3,
          title: 'OK',
          body: 'Average work',
          reviewer_name: 'John',
          created_at: '2025-01-01',
        },
        {
          id: 'b',
          creator_id: 'c1',
          rating: 3,
          title: 'OK',
          body: 'Average work',
          reviewer_name: 'Jane',
          created_at: '2025-01-02',
        },
        {
          id: 'c',
          creator_id: 'c1',
          rating: 3,
          title: 'OK',
          body: 'Average work',
          reviewer_name: 'Bob',
          created_at: '2025-01-03',
        },
      ];
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(3);
      expect(result.average_rating).toBe(3.0);
      expect(result.is_verified).toBe(false); // < 4.5 average
    });

    it('handles single review correctly', () => {
      const reviews = [
        {
          id: 'x',
          creator_id: 'c1',
          rating: 3,
          title: 'OK',
          body: 'Average work',
          reviewer_name: 'John',
          created_at: '2025-01-01',
        },
      ];
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(1);
      expect(result.average_rating).toBe(3.0);
      expect(result.stars_3).toBe(1);
      expect(result.stars_5).toBe(0);
      expect(result.is_verified).toBe(false);
    });

    it('rounds average rating to 2 decimal places', () => {
      const reviews = [
        { id: '1', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-01' },
        { id: '2', creator_id: 'c1', rating: 4, title: '', body: '', reviewer_name: '', created_at: '2025-01-02' },
        { id: '3', creator_id: 'c1', rating: 4, title: '', body: '', reviewer_name: '', created_at: '2025-01-03' },
      ];
      const result = aggregateReviews(reviews);
      expect(result.average_rating).toBe(4.33); // (5 + 4 + 4) / 3 = 4.333... → 4.33
    });

    it('ignores ratings outside 1-5 range', () => {
      const reviews = [
        { id: '1', creator_id: 'c1', rating: 0, title: '', body: '', reviewer_name: '', created_at: '2025-01-01' },
        { id: '2', creator_id: 'c1', rating: 6, title: '', body: '', reviewer_name: '', created_at: '2025-01-02' },
        { id: '3', creator_id: 'c1', rating: -1, title: '', body: '', reviewer_name: '', created_at: '2025-01-03' },
        { id: '4', creator_id: 'c1', rating: 10, title: '', body: '', reviewer_name: '', created_at: '2025-01-04' },
        { id: '5', creator_id: 'c1', rating: 4, title: '', body: '', reviewer_name: '', created_at: '2025-01-05' },
      ];
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(1); // Only the rating of 4 is valid
      expect(result.average_rating).toBe(4.0);
      expect(result.stars_4).toBe(1);
    });

    it('handles all 5-star reviews', () => {
      const reviews = Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        creator_id: 'c1',
        rating: 5,
        title: 'Perfect',
        body: 'Amazing work',
        reviewer_name: `Reviewer ${i}`,
        created_at: `2025-01-0${i + 1}`,
      }));
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(5);
      expect(result.average_rating).toBe(5.0);
      expect(result.stars_5).toBe(5);
      expect(result.stars_4).toBe(0);
      expect(result.is_verified).toBe(true);
    });

    it('handles all 1-star reviews', () => {
      const reviews = Array.from({ length: 3 }, (_, i) => ({
        id: `${i}`,
        creator_id: 'c1',
        rating: 1,
        title: 'Poor',
        body: 'Bad work',
        reviewer_name: `Reviewer ${i}`,
        created_at: `2025-01-0${i + 1}`,
      }));
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(3);
      expect(result.average_rating).toBe(1.0);
      expect(result.stars_1).toBe(3);
      expect(result.stars_5).toBe(0);
      expect(result.is_verified).toBe(false); // Low average rating
    });

    it('handles mixed ratings distribution', () => {
      const reviews = [
        { id: '1', creator_id: 'c1', rating: 1, title: '', body: '', reviewer_name: '', created_at: '2025-01-01' },
        { id: '2', creator_id: 'c1', rating: 2, title: '', body: '', reviewer_name: '', created_at: '2025-01-02' },
        { id: '3', creator_id: 'c1', rating: 3, title: '', body: '', reviewer_name: '', created_at: '2025-01-03' },
        { id: '4', creator_id: 'c1', rating: 4, title: '', body: '', reviewer_name: '', created_at: '2025-01-04' },
        { id: '5', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-05' },
      ];
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(5);
      expect(result.average_rating).toBe(3.0); // (1+2+3+4+5)/5 = 3.0
      expect(result.stars_1).toBe(1);
      expect(result.stars_2).toBe(1);
      expect(result.stars_3).toBe(1);
      expect(result.stars_4).toBe(1);
      expect(result.stars_5).toBe(1);
      expect(result.is_verified).toBe(false); // Average < 4.5
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('handles verification threshold exactly at 4.5', () => {
      const reviews = [
        { id: '1', creator_id: 'c1', rating: 4, title: '', body: '', reviewer_name: '', created_at: '2025-01-01' },
        { id: '2', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-02' },
        { id: '3', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-03' },
      ];
      const result = aggregateReviews(reviews);
      expect(result.average_rating).toBeCloseTo(4.67, 2);
      expect(result.is_verified).toBe(true); // >= 4.5 and >= 3 reviews
    });

    it('handles verification threshold just below 4.5', () => {
      const reviews = [
        { id: '1', creator_id: 'c1', rating: 4, title: '', body: '', reviewer_name: '', created_at: '2025-01-01' },
        { id: '2', creator_id: 'c1', rating: 4, title: '', body: '', reviewer_name: '', created_at: '2025-01-02' },
        { id: '3', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-03' },
      ];
      const result = aggregateReviews(reviews);
      expect(result.average_rating).toBeCloseTo(4.33, 2);
      expect(result.is_verified).toBe(false); // < 4.5 average
    });

    it('handles exactly 3 reviews for verification threshold', () => {
      const reviews = [
        { id: '1', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-01' },
        { id: '2', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-02' },
        { id: '3', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-03' },
      ];
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(3);
      expect(result.average_rating).toBe(5.0);
      expect(result.is_verified).toBe(true); // Exactly 3 reviews and perfect rating
    });

    it('handles 2 reviews with perfect rating (should not verify)', () => {
      const reviews = [
        { id: '1', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-01' },
        { id: '2', creator_id: 'c1', rating: 5, title: '', body: '', reviewer_name: '', created_at: '2025-01-02' },
      ];
      const result = aggregateReviews(reviews);
      expect(result.total_reviews).toBe(2);
      expect(result.average_rating).toBe(5.0);
      expect(result.is_verified).toBe(false); // < 3 reviews
    });
  });
});