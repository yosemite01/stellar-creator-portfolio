import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  queryKeys,
  MUTATION_INVALIDATION_MAP,
  invalidateMutationDependencies,
} from '@/lib/query-invalidation-map';
import { queryClient } from '@/lib/trpc-client';
import { submitReview, releaseEscrow, submitEscrowTransaction } from '@/lib/api-client';

describe('tRPC & REST Unified Cache Invalidation and Retries (Issue #1827)', () => {
  let mockQueryClient: QueryClient;

  beforeEach(() => {
    mockQueryClient = new QueryClient();
    vi.restoreAllMocks();
  });

  describe('MUTATION_INVALIDATION_MAP', () => {
    it('maps bounty.create to bounties and dashboard query keys', () => {
      const keys = MUTATION_INVALIDATION_MAP['bounty.create']();
      expect(keys).toContainEqual(queryKeys.bounties.all);
      expect(keys).toContainEqual(['bounty']);
      expect(keys).toContainEqual(['dashboard']);
    });

    it('maps bounty.update with bountyId to specific detail key', () => {
      const keys = MUTATION_INVALIDATION_MAP['bounty.update']({ bountyId: 'b-99' });
      expect(keys).toContainEqual(queryKeys.bounties.all);
      expect(keys).toContainEqual(queryKeys.bounties.detail('b-99'));
    });

    it('maps review.submit to reviews, creator profile, reputation, and bounty', () => {
      const keys = MUTATION_INVALIDATION_MAP['review.submit']({
        creatorId: 'c-alex',
        bountyId: 'b-100',
      });
      expect(keys).toContainEqual(queryKeys.reviews.all);
      expect(keys).toContainEqual(queryKeys.creators.detail('c-alex'));
      expect(keys).toContainEqual(queryKeys.creators.reputation('c-alex'));
      expect(keys).toContainEqual(queryKeys.creators.reviews('c-alex'));
      expect(keys).toContainEqual(queryKeys.bounties.detail('b-100'));
    });

    it('maps escrow.release to escrow, bounty, and earnings caches', () => {
      const keys = MUTATION_INVALIDATION_MAP['escrow.release']({ escrowId: 'esc-1' });
      expect(keys).toContainEqual(queryKeys.escrow.all);
      expect(keys).toContainEqual(queryKeys.escrow.detail('esc-1'));
      expect(keys).toContainEqual(['bounty']);
      expect(keys).toContainEqual(['earnings']);
    });

    it('maps projects.create to creator profile and bounties', () => {
      const keys = MUTATION_INVALIDATION_MAP['projects.create']({ creatorId: 'c-1' });
      expect(keys).toContainEqual(queryKeys.creators.all);
      expect(keys).toContainEqual(queryKeys.creators.detail('c-1'));
      expect(keys).toContainEqual(queryKeys.bounties.all);
      expect(keys).toContainEqual(['projects']);
    });
  });

  describe('invalidateMutationDependencies', () => {
    it('calls invalidateQueries for all dependent query keys', async () => {
      const invalidateSpy = vi.spyOn(mockQueryClient, 'invalidateQueries').mockResolvedValue();

      await invalidateMutationDependencies(mockQueryClient, 'review.submit', {
        creatorId: 'c-creator',
        bountyId: 'b-bounty',
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.reviews.all, exact: false }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.creators.detail('c-creator'), exact: false }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.bounties.detail('b-bounty'), exact: false }),
      );
    });

    it('handles missing context parameters safely without throwing', async () => {
      const invalidateSpy = vi.spyOn(mockQueryClient, 'invalidateQueries').mockResolvedValue();
      await expect(
        invalidateMutationDependencies(mockQueryClient, 'bounty.update', undefined),
      ).resolves.not.toThrow();
      expect(invalidateSpy).toHaveBeenCalled();
    });
  });

  describe('Retry Policy and Exponential Backoff', () => {
    const defaultQueryOpts = queryClient.getDefaultOptions().queries!;
    const retryFn = defaultQueryOpts.retry as (count: number, err: any) => boolean;
    const retryDelayFn = defaultQueryOpts.retryDelay as (index: number) => number;

    it('does not retry permanent client errors (400, 401, 403, 404, 422)', () => {
      for (const status of [400, 401, 403, 404, 422]) {
        expect(retryFn(0, { data: { httpStatus: status } })).toBe(false);
        expect(retryFn(1, { status })).toBe(false);
      }
    });

    it('retries transient 408 (timeout) and 429 (rate-limited) errors up to 3 times', () => {
      expect(retryFn(0, { status: 408 })).toBe(true);
      expect(retryFn(1, { status: 429 })).toBe(true);
      expect(retryFn(2, { status: 429 })).toBe(true);
      expect(retryFn(3, { status: 429 })).toBe(false);
    });

    it('retries transient 5xx server errors and network errors up to 3 times', () => {
      expect(retryFn(0, new Error('Network timeout'))).toBe(true);
      expect(retryFn(1, { status: 500 })).toBe(true);
      expect(retryFn(2, { status: 503 })).toBe(true);
      expect(retryFn(3, { status: 500 })).toBe(false);
    });

    it('implements exponential backoff delay capped at 30 seconds', () => {
      expect(retryDelayFn(0)).toBe(1000);
      expect(retryDelayFn(1)).toBe(2000);
      expect(retryDelayFn(2)).toBe(4000);
      expect(retryDelayFn(5)).toBe(30000); // capped
    });
  });

  describe('REST Mutations cross-cutting TanStack Query invalidation', () => {
    it('submitReview triggers dependent cache invalidation', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 201,
          json: () => Promise.resolve({ success: true, data: { reviewId: 'r-123' } }),
        }),
      );

      await submitReview({
        bountyId: 'b-99',
        creatorId: 'c-55',
        rating: 5,
        title: 'Superb',
        body: 'Exceeded all expectations.',
        reviewerName: 'Client',
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.reviews.all }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.creators.detail('c-55') }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.bounties.detail('b-99') }),
      );
    });

    it('releaseEscrow triggers dependent escrow and bounty cache invalidation', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { escrowId: 'esc-44', txHash: '0xabc', operation: 'release', status: 'confirmed', timestamp: '' },
            }),
        }),
      );

      await releaseEscrow('esc-44', 'GCLIENT123');

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.escrow.all }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.escrow.detail('esc-44') }),
      );
    });

    it('submitEscrowTransaction triggers dependent escrow and bounty cache invalidation', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { escrowId: 'esc-55', txHash: '0xdef', operation: 'deposit', status: 'confirmed', timestamp: '' },
            }),
        }),
      );

      await submitEscrowTransaction({
        bountyId: 'b-bounty-33',
        operation: 'deposit',
        amount: 500,
        payerAddress: 'GPAYER',
        payeeAddress: 'GPAYEE',
        tokenAddress: 'USDC',
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.escrow.all }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: queryKeys.bounties.detail('b-bounty-33') }),
      );
    });
  });
});
