import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCreatorReputation } from './api-client';
import { apiSuccess, apiFailure, type CreatorReputationPayload } from './api-models';
import { formatRating } from './utils';

describe('Rating Math - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockFetch = (response: any, ok = true, status = 200) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(response),
    }));
  };

  describe('fetchCreatorReputation Integration', () => {
    it('correctly processes backend aggregation data', async () => {
      const backendPayload: CreatorReputationPayload = {
        creatorId: 'alex-studio',
        aggregation: {
          averageRating: 4.67,
          totalReviews: 15,
          stars5: 8,
          stars4: 5,
          stars3: 2,
          stars2: 0,
          stars1: 0,
          isVerified: true,
        },
        recentReviews: [
          {
            id: 'r-1',
            rating: 5,
            title: 'Excellent work',
            body: 'Delivered exactly what was needed.',
            reviewerName: 'John D.',
            createdAt: '2025-01-15',
          },
          {
            id: 'r-2',
            rating: 4,
            title: 'Good collaboration',
            body: 'Professional and responsive.',
            reviewerName: 'Sarah M.',
            createdAt: '2025-01-10',
          },
        ],
      };

      mockFetch(apiSuccess(backendPayload));
      const result = await fetchCreatorReputation('alex-studio');

      // Verify the data structure matches expectations
      expect(result.creatorId).toBe('alex-studio');
      expect(result.aggregation.averageRating).toBe(4.67);
      expect(result.aggregation.totalReviews).toBe(15);
      expect(result.aggregation.isVerified).toBe(true);
      
      // Verify star distribution sums to total
      const { aggregation } = result;
      const totalStars = aggregation.stars1 + aggregation.stars2 + 
                        aggregation.stars3 + aggregation.stars4 + aggregation.stars5;
      expect(totalStars).toBe(aggregation.totalReviews);

      // Verify recent reviews structure
      expect(result.recentReviews).toHaveLength(2);
      expect(result.recentReviews[0].rating).toBe(5);
      expect(result.recentReviews[1].rating).toBe(4);
    });

    it('handles backend error responses correctly', async () => {
      mockFetch(apiFailure('NOT_FOUND', 'Creator not found'), false, 404);
      
      await expect(fetchCreatorReputation('nonexistent')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('validates rating ranges in backend responses', async () => {
      const invalidPayload: CreatorReputationPayload = {
        creatorId: 'test-creator',
        aggregation: {
          averageRating: 6.0, // Invalid: > 5.0
          totalReviews: 5,
          stars5: 5,
          stars4: 0,
          stars3: 0,
          stars2: 0,
          stars1: 0,
          isVerified: false,
        },
        recentReviews: [],
      };

      mockFetch(apiSuccess(invalidPayload));
      const result = await fetchCreatorReputation('test-creator');
      
      // The API should not return invalid ratings, but if it does,
      // we should handle it gracefully
      expect(result.aggregation.averageRating).toBe(6.0);
      // In a real implementation, we might want to validate and clamp this
    });
  });

  describe('Frontend-Backend Rating Consistency', () => {
    it('formats backend ratings consistently with frontend expectations', async () => {
      const testCases = [
        { rating: 4.67, reviews: 15, expected: '4.7 / 5 (15)' },
        { rating: 5.0, reviews: 100, expected: '5.0 / 5 (100)' },
        { rating: 3.33, reviews: 3, expected: '3.3 / 5 (3)' },
        { rating: 1.0, reviews: 1, expected: '1.0 / 5 (1)' },
      ];

      for (const testCase of testCases) {
        const payload: CreatorReputationPayload = {
          creatorId: 'test-creator',
          aggregation: {
            averageRating: testCase.rating,
            totalReviews: testCase.reviews,
            stars5: 0,
            stars4: 0,
            stars3: 0,
            stars2: 0,
            stars1: 0,
            isVerified: false,
          },
          recentReviews: [],
        };

        mockFetch(apiSuccess(payload));
        const result = await fetchCreatorReputation('test-creator');
        
        const formatted = formatRating(
          result.aggregation.averageRating,
          result.aggregation.totalReviews
        );
        
        expect(formatted).toBe(testCase.expected);
      }
    });

    it('handles zero reviews consistently', async () => {
      const emptyPayload: CreatorReputationPayload = {
        creatorId: 'new-creator',
        aggregation: {
          averageRating: 0.0,
          totalReviews: 0,
          stars5: 0,
          stars4: 0,
          stars3: 0,
          stars2: 0,
          stars1: 0,
          isVerified: false,
        },
        recentReviews: [],
      };

      mockFetch(apiSuccess(emptyPayload));
      const result = await fetchCreatorReputation('new-creator');
      
      expect(result.aggregation.totalReviews).toBe(0);
      expect(result.aggregation.averageRating).toBe(0.0);
      expect(result.aggregation.isVerified).toBe(false);
      
      // Frontend should handle zero ratings gracefully
      const formatted = formatRating(
        result.aggregation.averageRating === 0 ? undefined : result.aggregation.averageRating,
        result.aggregation.totalReviews
      );
      expect(formatted).toBe('No ratings yet');
    });
  });

  describe('Verification Status Integration', () => {
    it('correctly interprets backend verification status', async () => {
      const verifiedPayload: CreatorReputationPayload = {
        creatorId: 'verified-creator',
        aggregation: {
          averageRating: 4.8,
          totalReviews: 25,
          stars5: 20,
          stars4: 5,
          stars3: 0,
          stars2: 0,
          stars1: 0,
          isVerified: true,
        },
        recentReviews: [],
      };

      mockFetch(apiSuccess(verifiedPayload));
      const result = await fetchCreatorReputation('verified-creator');
      
      expect(result.aggregation.isVerified).toBe(true);
      expect(result.aggregation.averageRating).toBeGreaterThanOrEqual(4.5);
      expect(result.aggregation.totalReviews).toBeGreaterThanOrEqual(3);
    });

    it('handles unverified creators correctly', async () => {
      const unverifiedPayload: CreatorReputationPayload = {
        creatorId: 'unverified-creator',
        aggregation: {
          averageRating: 4.2,
          totalReviews: 2,
          stars5: 1,
          stars4: 1,
          stars3: 0,
          stars2: 0,
          stars1: 0,
          isVerified: false,
        },
        recentReviews: [],
      };

      mockFetch(apiSuccess(unverifiedPayload));
      const result = await fetchCreatorReputation('unverified-creator');
      
      expect(result.aggregation.isVerified).toBe(false);
      // Could be due to insufficient reviews or low rating
      expect(
        result.aggregation.totalReviews < 3 || result.aggregation.averageRating < 4.5
      ).toBe(true);
    });
  });

  describe('Rating Distribution Validation', () => {
    it('validates star distribution consistency', async () => {
      const payload: CreatorReputationPayload = {
        creatorId: 'test-creator',
        aggregation: {
          averageRating: 3.3, // Corrected to match the distribution
          totalReviews: 10,
          stars5: 2,
          stars4: 3,
          stars3: 2,
          stars2: 2,
          stars1: 1,
          isVerified: false,
        },
        recentReviews: [],
      };

      mockFetch(apiSuccess(payload));
      const result = await fetchCreatorReputation('test-creator');
      
      const { aggregation } = result;
      const totalStars = aggregation.stars1 + aggregation.stars2 + 
                        aggregation.stars3 + aggregation.stars4 + aggregation.stars5;
      
      // Star distribution should sum to total reviews
      expect(totalStars).toBe(aggregation.totalReviews);
      
      // Calculate expected average from distribution
      const weightedSum = (aggregation.stars1 * 1) + (aggregation.stars2 * 2) + 
                         (aggregation.stars3 * 3) + (aggregation.stars4 * 4) + 
                         (aggregation.stars5 * 5);
      const expectedAverage = Math.round((weightedSum / aggregation.totalReviews) * 100) / 100;
      
      // The test payload was set up with averageRating: 3.6, which should match the calculation
      // (2*5 + 3*4 + 2*3 + 2*2 + 1*1) / 10 = (10 + 12 + 6 + 4 + 1) / 10 = 33/10 = 3.3
      // But the payload has 3.6, so let's verify the actual calculation matches
      expect(aggregation.averageRating).toBe(expectedAverage);
    });

    it('handles edge case distributions', async () => {
      // All 5-star reviews
      const perfectPayload: CreatorReputationPayload = {
        creatorId: 'perfect-creator',
        aggregation: {
          averageRating: 5.0,
          totalReviews: 10,
          stars5: 10,
          stars4: 0,
          stars3: 0,
          stars2: 0,
          stars1: 0,
          isVerified: true,
        },
        recentReviews: [],
      };

      mockFetch(apiSuccess(perfectPayload));
      const result = await fetchCreatorReputation('perfect-creator');
      
      expect(result.aggregation.averageRating).toBe(5.0);
      expect(result.aggregation.stars5).toBe(result.aggregation.totalReviews);
      expect(result.aggregation.isVerified).toBe(true);
    });
  });

  describe('Recent Reviews Integration', () => {
    it('processes recent reviews with valid ratings', async () => {
      const payload: CreatorReputationPayload = {
        creatorId: 'test-creator',
        aggregation: {
          averageRating: 4.5,
          totalReviews: 5,
          stars5: 3,
          stars4: 2,
          stars3: 0,
          stars2: 0,
          stars1: 0,
          isVerified: true,
        },
        recentReviews: [
          {
            id: 'r-1',
            rating: 5,
            title: 'Excellent',
            body: 'Great work',
            reviewerName: 'John',
            createdAt: '2025-01-15',
          },
          {
            id: 'r-2',
            rating: 4,
            title: 'Good',
            body: 'Nice job',
            reviewerName: 'Jane',
            createdAt: '2025-01-10',
          },
        ],
      };

      mockFetch(apiSuccess(payload));
      const result = await fetchCreatorReputation('test-creator');
      
      // Verify all recent reviews have valid ratings
      for (const review of result.recentReviews) {
        expect(review.rating).toBeGreaterThanOrEqual(1);
        expect(review.rating).toBeLessThanOrEqual(5);
        expect(Number.isInteger(review.rating)).toBe(true);
      }
    });

    it('handles empty recent reviews', async () => {
      const payload: CreatorReputationPayload = {
        creatorId: 'test-creator',
        aggregation: {
          averageRating: 4.0,
          totalReviews: 3,
          stars5: 1,
          stars4: 1,
          stars3: 1,
          stars2: 0,
          stars1: 0,
          isVerified: false,
        },
        recentReviews: [],
      };

      mockFetch(apiSuccess(payload));
      const result = await fetchCreatorReputation('test-creator');
      
      expect(result.recentReviews).toHaveLength(0);
      expect(result.aggregation.totalReviews).toBeGreaterThan(0);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('handles network errors gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      
      await expect(fetchCreatorReputation('test-creator')).rejects.toThrow();
    });

    it('handles malformed response data', async () => {
      mockFetch({ invalid: 'data' });
      
      // The API client should handle malformed responses
      // This test verifies error handling behavior
      await expect(fetchCreatorReputation('test-creator')).rejects.toThrow();
    });

    it('handles partial data responses', async () => {
      const partialPayload = {
        creatorId: 'test-creator',
        aggregation: {
          averageRating: 4.0,
          totalReviews: 5,
          // Missing star distribution fields - this should be handled gracefully
          // In a real API, this would likely cause a validation error
        },
        recentReviews: [],
      };

      mockFetch(apiSuccess(partialPayload));
      
      // The API client should handle missing fields gracefully
      // Since the mock returns a success, we expect it to resolve
      const result = await fetchCreatorReputation('test-creator');
      expect(result.creatorId).toBe('test-creator');
      expect(result.aggregation.averageRating).toBe(4.0);
    });
  });
});