import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreatorReputation } from './creator-reputation';
import { apiSuccess, apiFailure } from '@/lib/api-models';
import type { FilteredCreatorReputationPayload } from '@/lib/api-models';

const mockPayload: FilteredCreatorReputationPayload = {
  creatorId: 'alex-studio',
  aggregation: {
    averageRating: 4.67,
    totalReviews: 3,
    stars5: 2,
    stars4: 1,
    stars3: 0,
    stars2: 0,
    stars1: 0,
    isVerified: true,
  },
  reviews: {
    reviews: [
      {
        id: 'r-1',
        rating: 5,
        title: 'Exceptional design partner',
        body: 'Delivered a full design system on time.',
        reviewerName: 'Sam K.',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
    totalCount: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
  appliedFilters: {},
};

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('CreatorReputation', () => {
  it('renders nothing while loading (no reviews yet)', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { container } = render(<CreatorReputation creatorId="alex-studio" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders aggregation and reviews on success', async () => {
    mockFetch(apiSuccess(mockPayload));
    render(<CreatorReputation creatorId="alex-studio" />);
    expect(await screen.findByText('Client reviews')).toBeInTheDocument();
    expect(await screen.findByText('4.67')).toBeInTheDocument();
    expect(await screen.findByText('Exceptional design partner')).toBeInTheDocument();
  });

  it('renders rating breakdown histogram', async () => {
    mockFetch(apiSuccess(mockPayload));
    render(<CreatorReputation creatorId="alex-studio" />);
    expect(await screen.findByLabelText('Rating distribution')).toBeInTheDocument();
  });

  it('shows error alert on fetch failure', async () => {
    mockFetch({}, false, 500);
    render(<CreatorReputation creatorId="alex-studio" />);
    expect(await screen.findByText('Failed to load reviews')).toBeInTheDocument();
  });

  it('shows error alert on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network')));
    render(<CreatorReputation creatorId="alex-studio" />);
    expect(await screen.findByText('Failed to load reviews')).toBeInTheDocument();
  });

  it('renders nothing when totalReviews is 0', async () => {
    const emptyPayload: FilteredCreatorReputationPayload = {
      ...mockPayload,
      aggregation: { ...mockPayload.aggregation, totalReviews: 0, averageRating: 0 },
      reviews: {
        reviews: [],
        totalCount: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    };
    mockFetch(apiSuccess(emptyPayload));
    const { container } = render(<CreatorReputation creatorId="alex-studio" />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('dismisses error alert when onDismiss is called', async () => {
    mockFetch({}, false, 500);
    render(<CreatorReputation creatorId="alex-studio" />);
    const dismissBtn = await screen.findByRole('button', { name: /dismiss error/i });
    await userEvent.click(dismissBtn);
    await waitFor(() => {
      expect(screen.queryByText('Failed to load reviews')).not.toBeInTheDocument();
    });
  });

  it('shows review count in summary text', async () => {
    mockFetch(apiSuccess(mockPayload));
    render(<CreatorReputation creatorId="alex-studio" />);
    expect(await screen.findByText(/Based on 3 reviews/)).toBeInTheDocument();
  });

  it('uses singular "review" for count of 1', async () => {
    const singleReview: FilteredCreatorReputationPayload = {
      ...mockPayload,
      aggregation: { ...mockPayload.aggregation, totalReviews: 1 },
    };
    mockFetch(apiSuccess(singleReview));
    render(<CreatorReputation creatorId="alex-studio" />);
    expect(await screen.findByText(/Based on 1 review/)).toBeInTheDocument();
  });
});
