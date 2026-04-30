'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { ReviewCard } from '@/components/cards/review-card';
import { ReviewForm } from '@/components/forms/review-form';
import { AggregateRatingDisplay } from '@/components/widgets/rating-display';
import { creators } from '@/lib/services/creators-data';
import { ArrowLeft, PenLine } from 'lucide-react';
import type { Review, AggregateRating, ReviewVote } from '@/lib/services/review-service';

type SortOption = 'recent' | 'helpful' | 'rating_high' | 'rating_low';

interface ReviewsPageProps {
  params: { id: string };
}

export default function CreatorReviewsPage({ params }: ReviewsPageProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const creator = creators.find((c) => c.id === params.id);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [aggregate, setAggregate] = useState<AggregateRating>({ average: 0, total: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  const [sort, setSort] = useState<SortOption>('recent');
  const [filterRating, setFilterRating] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [userVotes, setUserVotes] = useState<Record<string, ReviewVote['vote']>>({});

  const fetchReviews = useCallback(async () => {
    if (!creator) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        creatorId: creator.id,
        sort,
        page: String(page),
        limit: '10',
      });
      if (filterRating) params.set('filterRating', String(filterRating));

      const res = await fetch(`/api/reviews?${params}`);
      if (!res.ok) throw new Error('Failed to load reviews');
      const data = await res.json();
      setReviews(data.reviews);
      setAggregate(data.aggregate);
      setTotalPages(data.pagination.totalPages);
    } catch {
      // silently fail - reviews just won't show
    } finally {
      setLoading(false);
    }
  }, [creator, sort, filterRating, page]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  if (!creator) {
    router.replace('/creators');
    return null;
  }

  const handleSubmitReview = async (data: { rating: number; title: string; body: string }) => {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creatorId: creator.id, ...data }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? 'Submission failed');
    }
    setShowForm(false);
    setSubmitted(true);
  };

  const handleVote = async (reviewId: string, vote: 'helpful' | 'not_helpful') => {
    if (!session) return;
    try {
      await fetch('/api/reviews?action=vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, vote }),
      });
      setUserVotes((prev) => {
        const current = prev[reviewId];
        if (current === vote) {
          const next = { ...prev };
          delete next[reviewId];
          return next;
        }
        return { ...prev, [reviewId]: vote };
      });
    } catch {
      // optimistic update already applied in ReviewCard
    }
  };

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: 'recent', label: 'Most Recent' },
    { value: 'helpful', label: 'Most Helpful' },
    { value: 'rating_high', label: 'Highest Rated' },
    { value: 'rating_low', label: 'Lowest Rated' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          {/* Back nav */}
          <Button
            variant="ghost"
            size="sm"
            className="mb-6 gap-2"
            onClick={() => router.push(`/creators/${creator.id}`)}
          >
            <ArrowLeft size={16} />
            Back to {creator.name}
          </Button>

          <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Reviews</h1>
              <p className="text-muted-foreground mt-1">for {creator.name}</p>
            </div>
            {session && !showForm && !submitted && (
              <Button onClick={() => setShowForm(true)} className="gap-2">
                <PenLine size={16} />
                Write a Review
              </Button>
            )}
          </div>

          {/* Aggregate rating */}
          {aggregate.total > 0 && (
            <div className="bg-card border border-border rounded-lg p-6 mb-8">
              <AggregateRatingDisplay aggregate={aggregate} />
            </div>
          )}

          {/* Submission success */}
          {submitted && (
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 mb-6 text-sm text-emerald-700 dark:text-emerald-400">
              Thanks for your review! It will appear once approved by our team.
            </div>
          )}

          {/* Review form */}
          {showForm && (
            <ReviewForm
              creatorId={creator.id}
              creatorName={creator.name}
              onSubmit={handleSubmitReview}
              onCancel={() => setShowForm(false)}
              className="mb-8"
            />
          )}

          {/* Filters & sort */}
          <div className="flex flex-wrap gap-3 mb-6 items-center">
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => { setFilterRating(undefined); setPage(1); }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${!filterRating ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
              >
                All
              </button>
              {([5, 4, 3, 2, 1] as const).map((star) => (
                <button
                  key={star}
                  onClick={() => { setFilterRating(filterRating === star ? undefined : star); setPage(1); }}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${filterRating === star ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                >
                  {star}★
                </button>
              ))}
            </div>

            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value as SortOption); setPage(1); }}
              className="ml-auto px-3 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Sort reviews"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Review list */}
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card border border-border rounded-lg p-5 animate-pulse h-36" />
              ))}
            </div>
          ) : reviews.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-lg font-medium mb-2">No reviews yet</p>
              <p className="text-sm">
                {session
                  ? 'Be the first to leave a review.'
                  : 'Sign in to leave the first review.'}
              </p>
              {session && !showForm && (
                <Button className="mt-4 gap-2" onClick={() => setShowForm(true)}>
                  <PenLine size={16} />
                  Write a Review
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  currentUserId={session?.user?.id}
                  userVote={userVotes[review.id] ?? null}
                  onVote={handleVote}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="flex items-center px-3 text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
