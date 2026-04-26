'use client';

import { useEffect, useState } from 'react';
import type { ApiResponse, CreatorReputationPayload, PublicReview, ReputationAggregation } from '@/lib/api-models';
import { isApiSuccess } from '@/lib/api-models';
import { ReviewList } from '@/components/review-list';
import { ReviewFilters, type ReviewFilterOptions } from '@/components/review-filters';
import { ErrorAlert } from '@/components/error-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FilteredReputationPayload {
  creatorId: string;
  aggregation: ReputationAggregation;
  filteredAggregation?: ReputationAggregation;
  reviews: {
    reviews: PublicReview[];
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  appliedFilters: ReviewFilterOptions;
}

function StarRow({ value, max = 5 }: { value: number; max?: number }) {
  const rounded = Math.round(value);
  return (
    <div className="flex gap-0.5" aria-label={`${value.toFixed(2)} out of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={i < rounded ? 'text-amber-500' : 'text-muted-foreground/40'}
          aria-hidden
        >
          ★
        </span>
      ))}
    </div>
  );
}

function Histogram({
  aggregation,
  title = "Rating breakdown"
}: {
  aggregation: ReputationAggregation;
  title?: string;
}) {
  const total = aggregation.totalReviews;
  if (total === 0) return null;

  const rows: { label: string; count: number }[] = [
    { label: '5 stars', count: aggregation.stars5 },
    { label: '4 stars', count: aggregation.stars4 },
    { label: '3 stars', count: aggregation.stars3 },
    { label: '2 stars', count: aggregation.stars2 },
    { label: '1 star', count: aggregation.stars1 },
  ];

  return (
    <div className="space-y-2 mt-6" aria-label="Rating distribution">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {rows.map((row) => {
        const pct = Math.round((row.count / total) * 100);
        return (
          <div key={row.label} className="flex items-center gap-3 text-sm">
            <span className="w-16 text-muted-foreground shrink-0">{row.label}</span>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{row.count}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CreatorReputation({ creatorId }: { creatorId: string }) {
  const [payload, setPayload] = useState<FilteredReputationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFilters] = useState<ReviewFilterOptions>({
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  const loadReviews = async (newFilters: ReviewFilterOptions) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      Object.entries(newFilters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, value.toString());
        }
      });
      
      const queryString = params.toString();
      const url = `${API_BASE}/api/v1/creators/${encodeURIComponent(creatorId)}/reviews${queryString ? `?${queryString}` : ''}`;
      
      const res = await fetch(url, { 
        headers: { Accept: 'application/json' } 
      });
      
      if (!res.ok) {
        setError('Failed to load reviews');
        return;
      }
      
      const body = (await res.json()) as ApiResponse<FilteredReputationPayload>;
      if (isApiSuccess(body)) {
        setPayload(body.data);
        setError(null);
      } else {
        setError(body.error.message || 'Failed to load reviews');
      }
    } catch (err) {
      setError('Failed to load reviews');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReviews(filters);
  }, [creatorId, filters]);

  const handleFiltersChange = (newFilters: ReviewFilterOptions) => {
    setFilters(newFilters);
  };

  const handlePageChange = (newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }));
  };

  if (error) {
    return (
      <section className="border-b border-border bg-muted/20 py-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-foreground mb-8">Client reviews</h2>
          <ErrorAlert message={error} onDismiss={() => setError(null)} />
        </div>
      </section>
    );
  }

  // Return null while loading or if no payload exists
  if (isLoading || !payload) {
    return null;
  }

  const { aggregation, filteredAggregation, reviews } = payload;
  const displayAggregation = filteredAggregation || aggregation;
  const hasFilters = filteredAggregation !== undefined;

  // Return null if there are no reviews at all
  if (aggregation.totalReviews === 0) {
    return null;
  }

  return (
    <section className="border-b border-border bg-muted/20 py-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h2 className="text-2xl font-bold text-foreground">Client reviews</h2>
          {aggregation.isVerified && (
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 px-3 py-1 gap-1.5 rounded-full hover:bg-emerald-500/15 transition-colors">
              <CheckCircle size={14} className="fill-emerald-600/10" />
              Verified Creator
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mb-8">
          Ratings from verified clients who worked with this creator.
        </p>

        <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
            <div className="text-center sm:text-left">
              <div className="text-4xl font-bold text-primary tabular-nums">
                {displayAggregation.averageRating.toFixed(2)}
              </div>
              <div className="text-sm text-muted-foreground">out of 5</div>
            </div>
            <div className="flex flex-col gap-2">
              <StarRow value={displayAggregation.averageRating} />
              <p className="text-sm text-muted-foreground">
                Based on {displayAggregation.totalReviews}{' '}
                {displayAggregation.totalReviews === 1 ? 'review' : 'reviews'}
                {hasFilters && ` (filtered from ${aggregation.totalReviews} total)`}
              </p>
            </div>
          </div>

          <Histogram 
            aggregation={displayAggregation} 
            title={hasFilters ? "Filtered rating breakdown" : "Rating breakdown"}
          />

          {/* Show overall stats when filtered */}
          {hasFilters && (
            <div className="mt-6 p-4 bg-muted/50 rounded-lg">
              <h4 className="text-sm font-semibold mb-2">Overall Statistics</h4>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Total Reviews: {aggregation.totalReviews}</span>
                <span>Overall Rating: {aggregation.averageRating.toFixed(2)}</span>
                <span>Verified: {aggregation.isVerified ? 'Yes' : 'No'}</span>
              </div>
            </div>
          )}

          <div className="mt-10">
            <ReviewFilters
              filters={filters}
              onFiltersChange={handleFiltersChange}
              totalReviews={reviews?.totalCount || 0}
              isLoading={isLoading}
            />
            
            <ReviewList reviews={reviews?.reviews || []} />
            
            {/* Pagination */}
            {reviews && reviews.totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-6 border-t">
                <div className="text-sm text-muted-foreground">
                  Page {reviews.page} of {reviews.totalPages} 
                  ({reviews.totalCount} total reviews)
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(reviews.page - 1)}
                    disabled={!reviews.hasPrev || isLoading}
                  >
                    <ChevronLeft size={16} />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(reviews.page + 1)}
                    disabled={!reviews.hasNext || isLoading}
                  >
                    Next
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
