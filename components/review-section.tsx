'use client';

import { Star, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { ReviewForm } from './review-form';

interface Review {
  id: string;
  author: string;
  avatar: string;
  rating: number;
  text: string;
  date: string;
  bountyTitle: string;
}

interface ReviewSectionProps {
  creatorId: string;
  reviews: Review[];
  averageRating: number;
  totalReviews: number;
  userCanReview?: boolean;
  onReviewSubmit?: (review: Review) => void;
}

export function ReviewSection({
  creatorId,
  reviews,
  averageRating,
  totalReviews,
  userCanReview = false,
  onReviewSubmit,
}: ReviewSectionProps) {
  const [showReviewForm, setShowReviewForm] = useState(false);

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        size={16}
        className={i < rating ? 'fill-accent text-accent' : 'text-muted-foreground'}
      />
    ));
  };

  return (
    <div className="space-y-6">
      {/* Rating Summary */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-2xl font-bold text-foreground">Reviews & Ratings</h3>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex gap-1">{renderStars(Math.round(averageRating))}</div>
            <span className="text-lg font-semibold text-foreground">
              {averageRating.toFixed(1)}
            </span>
            <span className="text-sm text-muted-foreground">
              ({totalReviews} {totalReviews === 1 ? 'review' : 'reviews'})
            </span>
          </div>
        </div>
        {userCanReview && !showReviewForm && (
          <Button onClick={() => setShowReviewForm(true)} variant="outline">
            <MessageCircle size={16} className="mr-2" />
            Leave a Review
          </Button>
        )}
      </div>

      {/* Review Form */}
      {showReviewForm && (
        <ReviewForm
          creatorId={creatorId}
          onClose={() => setShowReviewForm(false)}
          onSubmit={(review) => {
            onReviewSubmit?.(review);
            setShowReviewForm(false);
          }}
        />
      )}

      {/* Reviews List */}
      <div className="space-y-4">
        {reviews.length === 0 ? (
          <div className="text-center py-8">
            <MessageCircle size={40} className="text-muted-foreground mx-auto mb-2 opacity-50" />
            <p className="text-muted-foreground">No reviews yet. Be the first to review!</p>
          </div>
        ) : (
          reviews.map((review) => (
            <div
              key={review.id}
              className="bg-card border border-border rounded-lg p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <img
                    src={review.avatar}
                    alt={review.author}
                    className="w-10 h-10 rounded-full"
                  />
                  <div>
                    <p className="font-medium text-foreground">{review.author}</p>
                    <p className="text-xs text-muted-foreground">
                      for {review.bountyTitle}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{review.date}</p>
              </div>
              <div className="flex gap-1 mb-2">{renderStars(review.rating)}</div>
              <p className="text-sm text-foreground leading-relaxed">{review.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
