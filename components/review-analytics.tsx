'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReviewFilters, type ReviewFilterOptions } from '@/components/review-filters';
import { ReviewList } from '@/components/review-list';
import { ErrorAlert } from '@/components/error-alert';
import { fetchAllReviews } from '@/lib/api-client';
import { TrendingUp, Users, Star, Award, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PublicReview, ReputationAggregation } from '@/lib/api-models';

interface ReviewAnalyticsData {
  reviews: {
    reviews: PublicReview[];
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  overallAggregation: ReputationAggregation;
  filteredAggregation?: ReputationAggregation;
  appliedFilters: any;
}

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  trend 
}: { 
  title: string; 
  value: string | number; 
  subtitle: string; 
  icon: any; 
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className={`p-3 rounded-full ${
          trend === 'up' ? 'bg-green-100 text-green-600' :
          trend === 'down' ? 'bg-red-100 text-red-600' :
          'bg-blue-100 text-blue-600'
        }`}>
          <Icon size={20} />
        </div>
      </div>
    </Card>
  );
}

function RatingDistribution({ aggregation }: { aggregation: ReputationAggregation }) {
  const total = aggregation.totalReviews;
  if (total === 0) return null;

  const ratings = [
    { stars: 5, count: aggregation.stars5, color: 'bg-green-500' },
    { stars: 4, count: aggregation.stars4, color: 'bg-lime-500' },
    { stars: 3, count: aggregation.stars3, color: 'bg-yellow-500' },
    { stars: 2, count: aggregation.stars2, color: 'bg-orange-500' },
    { stars: 1, count: aggregation.stars1, color: 'bg-red-500' },
  ];

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Rating Distribution</h3>
      <div className="space-y-3">
        {ratings.map(({ stars, count, color }) => {
          const percentage = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={stars} className="flex items-center gap-3">
              <span className="text-sm font-medium w-8">{stars}★</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className={`h-full ${color} transition-all duration-300`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <span className="text-sm text-muted-foreground w-12 text-right">
                {count}
              </span>
              <span className="text-xs text-muted-foreground w-12 text-right">
                {percentage.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function ReviewAnalytics() {
  const [data, setData] = useState<ReviewAnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFilters] = useState<ReviewFilterOptions>({
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc'
  });

  const loadData = async (newFilters: ReviewFilterOptions) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await fetchAllReviews(newFilters);
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load review data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(filters);
  }, [filters]);

  const handleFiltersChange = (newFilters: ReviewFilterOptions) => {
    setFilters(newFilters);
  };

  const handlePageChange = (newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }));
  };

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ErrorAlert message={error} onDismiss={() => setError(null)} />
      </div>
    );
  }

  if (!data && !isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center text-muted-foreground">
          No review data available
        </div>
      </div>
    );
  }

  const { overallAggregation, filteredAggregation, reviews } = data || {
    overallAggregation: { totalReviews: 0, averageRating: 0, stars1: 0, stars2: 0, stars3: 0, stars4: 0, stars5: 0, isVerified: false },
    reviews: { reviews: [], totalCount: 0, page: 1, limit: 20, totalPages: 0, hasNext: false, hasPrev: false }
  };

  const displayAggregation = filteredAggregation || overallAggregation;
  const hasFilters = filteredAggregation !== undefined;

  // Calculate quality metrics
  const highQualityReviews = displayAggregation.stars4 + displayAggregation.stars5;
  const qualityPercentage = displayAggregation.totalReviews > 0 
    ? ((highQualityReviews / displayAggregation.totalReviews) * 100).toFixed(1)
    : '0';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">Review Analytics</h1>
        <p className="text-muted-foreground">
          Comprehensive overview of all reviews across the platform
          {hasFilters && ' (filtered view)'}
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Total Reviews"
          value={displayAggregation.totalReviews.toLocaleString()}
          subtitle={hasFilters ? `of ${overallAggregation.totalReviews} total` : 'All time'}
          icon={Users}
          trend="neutral"
        />
        <StatCard
          title="Average Rating"
          value={displayAggregation.averageRating.toFixed(2)}
          subtitle="out of 5.0"
          icon={Star}
          trend={displayAggregation.averageRating >= 4.0 ? 'up' : displayAggregation.averageRating >= 3.0 ? 'neutral' : 'down'}
        />
        <StatCard
          title="Quality Score"
          value={`${qualityPercentage}%`}
          subtitle="4+ star reviews"
          icon={Award}
          trend={parseFloat(qualityPercentage) >= 80 ? 'up' : parseFloat(qualityPercentage) >= 60 ? 'neutral' : 'down'}
        />
        <StatCard
          title="Verified Creators"
          value={overallAggregation.isVerified ? '1+' : '0'}
          subtitle="High-quality profiles"
          icon={TrendingUp}
          trend="neutral"
        />
      </div>

      {/* Rating Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <RatingDistribution aggregation={displayAggregation} />
        
        {/* Additional Stats */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Review Insights</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Excellent (5★)</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">{displayAggregation.stars5}</span>
                <Badge variant="outline" className="text-green-600 border-green-200">
                  {displayAggregation.totalReviews > 0 
                    ? ((displayAggregation.stars5 / displayAggregation.totalReviews) * 100).toFixed(1)
                    : '0'}%
                </Badge>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Good (4★)</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">{displayAggregation.stars4}</span>
                <Badge variant="outline" className="text-lime-600 border-lime-200">
                  {displayAggregation.totalReviews > 0 
                    ? ((displayAggregation.stars4 / displayAggregation.totalReviews) * 100).toFixed(1)
                    : '0'}%
                </Badge>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Average (3★)</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">{displayAggregation.stars3}</span>
                <Badge variant="outline" className="text-yellow-600 border-yellow-200">
                  {displayAggregation.totalReviews > 0 
                    ? ((displayAggregation.stars3 / displayAggregation.totalReviews) * 100).toFixed(1)
                    : '0'}%
                </Badge>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Below Average (1-2★)</span>
              <div className="flex items-center gap-2">
                <span className="font-medium">{displayAggregation.stars1 + displayAggregation.stars2}</span>
                <Badge variant="outline" className="text-red-600 border-red-200">
                  {displayAggregation.totalReviews > 0 
                    ? (((displayAggregation.stars1 + displayAggregation.stars2) / displayAggregation.totalReviews) * 100).toFixed(1)
                    : '0'}%
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters and Reviews */}
      <div className="space-y-6">
        <ReviewFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          totalReviews={reviews.totalCount}
          isLoading={isLoading}
        />

        {/* Reviews List */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold">Recent Reviews</h3>
            {hasFilters && (
              <Badge variant="secondary">
                Filtered: {reviews.totalCount} of {overallAggregation.totalReviews}
              </Badge>
            )}
          </div>
          
          <ReviewList reviews={reviews.reviews} />
          
          {/* Pagination */}
          {reviews.totalPages > 1 && (
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
        </Card>
      </div>
    </div>
  );
}