import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ReviewAnalytics } from '@/components/review-analytics';
import * as apiClient from '@/lib/api-client';

// Mock the API client
vi.mock('@/lib/api-client');
const mockFetchAllReviews = apiClient.fetchAllReviews as ReturnType<typeof vi.fn>;

const mockReviewData = {
  reviews: {
    reviews: [
      {
        id: 'r1',
        rating: 5,
        title: 'Excellent work',
        body: 'Great collaboration',
        reviewerName: 'John Doe',
        createdAt: '2025-01-15'
      },
      {
        id: 'r2',
        rating: 4,
        title: 'Good job',
        body: 'Solid delivery',
        reviewerName: 'Jane Smith',
        createdAt: '2025-01-10'
      }
    ],
    totalCount: 2,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNext: false,
    hasPrev: false
  },
  overallAggregation: {
    totalReviews: 2,
    averageRating: 4.5,
    stars5: 1,
    stars4: 1,
    stars3: 0,
    stars2: 0,
    stars1: 0,
    isVerified: true
  },
  appliedFilters: {}
};

describe('ReviewAnalytics', () => {
  beforeEach(() => {
    mockFetchAllReviews.mockClear();
  });

  it('renders loading state initially', () => {
    mockFetchAllReviews.mockImplementation(() => new Promise(() => {})); // Never resolves

    render(<ReviewAnalytics />);

    expect(screen.getByText('Review Analytics')).toBeInTheDocument();
    expect(screen.getByText('Comprehensive overview of all reviews across the platform')).toBeInTheDocument();
  });

  it('displays review statistics when data loads', async () => {
    mockFetchAllReviews.mockResolvedValue(mockReviewData);

    render(<ReviewAnalytics />);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument(); // Total reviews
      expect(screen.getByText('4.50')).toBeInTheDocument(); // Average rating
      expect(screen.getByText('100.0%')).toBeInTheDocument(); // Quality score (both reviews are 4+)
    });
  });

  it('shows rating distribution chart', async () => {
    mockFetchAllReviews.mockResolvedValue(mockReviewData);

    render(<ReviewAnalytics />);

    await waitFor(() => {
      expect(screen.getByText('Rating Distribution')).toBeInTheDocument();
      expect(screen.getByText('5★')).toBeInTheDocument();
      expect(screen.getByText('4★')).toBeInTheDocument();
    });
  });

  it('displays review insights with percentages', async () => {
    mockFetchAllReviews.mockResolvedValue(mockReviewData);

    render(<ReviewAnalytics />);

    await waitFor(() => {
      expect(screen.getByText('Review Insights')).toBeInTheDocument();
      expect(screen.getByText('Excellent (5★)')).toBeInTheDocument();
      expect(screen.getByText('Good (4★)')).toBeInTheDocument();
      expect(screen.getAllByText('50.0%')).toHaveLength(2); // Both 5-star and 4-star are 50% each
    });
  });

  it('shows recent reviews list', async () => {
    mockFetchAllReviews.mockResolvedValue(mockReviewData);

    render(<ReviewAnalytics />);

    await waitFor(() => {
      expect(screen.getByText('Recent Reviews')).toBeInTheDocument();
      expect(screen.getByText('Excellent work')).toBeInTheDocument();
      expect(screen.getByText('Good job')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
  });

  it('handles API errors gracefully', async () => {
    const errorMessage = 'Failed to load reviews';
    mockFetchAllReviews.mockRejectedValue(new Error(errorMessage));

    render(<ReviewAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('shows filtered view indicator when filters are applied', async () => {
    const filteredData = {
      ...mockReviewData,
      filteredAggregation: {
        totalReviews: 1,
        averageRating: 5.0,
        stars5: 1,
        stars4: 0,
        stars3: 0,
        stars2: 0,
        stars1: 0,
        isVerified: true
      }
    };

    mockFetchAllReviews.mockResolvedValue(filteredData);

    render(<ReviewAnalytics />);

    await waitFor(() => {
      expect(screen.getByText(/filtered view/)).toBeInTheDocument();
      expect(screen.getByText('Filtered: 2 of 2')).toBeInTheDocument();
    });
  });

  it('calculates quality metrics correctly', async () => {
    const dataWithMixedRatings = {
      ...mockReviewData,
      overallAggregation: {
        totalReviews: 5,
        averageRating: 3.4,
        stars5: 1,
        stars4: 1,
        stars3: 1,
        stars2: 1,
        stars1: 1,
        isVerified: false
      }
    };

    mockFetchAllReviews.mockResolvedValue(dataWithMixedRatings);

    render(<ReviewAnalytics />);

    await waitFor(() => {
      expect(screen.getAllByText('40.0%')[0]).toBeInTheDocument(); // Quality score in main metrics
      expect(screen.getByText('3.40')).toBeInTheDocument(); // Average rating
    });
  });
});