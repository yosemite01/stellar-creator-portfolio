'use client';

import { StarIcon, UserCircleIcon } from 'lucide-react';
import type { PublicReview } from '@/lib/api-models';
import { Card } from '@/components/ui/card';

function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };

  for (const [name, secondsInInterval] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInInterval);
    if (interval >= 1) {
      return interval === 1 ? `${interval} ${name} ago` : `${interval} ${name}s ago`;
    }
  }

  return 'just now';
}

interface ReviewListProps {
  reviews: PublicReview[];
  creatorName?: string;
}

function ReviewStars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon
          key={i}
          className={`w-4 h-4 ${
            i < rating ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground/30'
          }`}
        />
      ))}
    </div>
  );
}

export function ReviewList({ reviews, creatorName = 'Creator' }: ReviewListProps) {
  if (!reviews || reviews.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No reviews yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Reviews ({reviews.length})</h3>
      </div>
      <div className="space-y-3">
        {reviews.map((review) => {
          const createdDate = new Date(review.createdAt);
          const timeAgo = formatDistanceToNow(createdDate);

          return (
            <Card key={review.id} className="p-4 hover:shadow-md transition-shadow">
              <div className="flex gap-3">
                {/* Reviewer Avatar */}
                <div className="flex-shrink-0">
                  <UserCircleIcon className="w-10 h-10 text-muted-foreground" />
                </div>

                {/* Review Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="font-semibold text-sm">{review.reviewerName}</p>
                      <ReviewStars rating={review.rating} />
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo}</p>
                  </div>

                  <p className="font-medium text-sm mb-1">{review.title}</p>
                  <p className="text-sm text-muted-foreground line-clamp-3">{review.body}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
