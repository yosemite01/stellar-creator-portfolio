'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StarRating } from '@/components/widgets/rating-display';
import { cn } from '@/lib/utils';
import type { Review } from '@/lib/services/review-service';

interface ReviewCardProps {
  review: Review;
  currentUserId?: string;
  userVote?: 'helpful' | 'not_helpful' | null;
  onVote?: (reviewId: string, vote: 'helpful' | 'not_helpful') => void;
}

export function ReviewCard({ review, currentUserId, userVote, onVote }: ReviewCardProps) {
  const [optimisticVote, setOptimisticVote] = useState<'helpful' | 'not_helpful' | null>(
    userVote ?? null
  );
  const [helpfulCount, setHelpfulCount] = useState(review.helpfulCount);
  const [notHelpfulCount, setNotHelpfulCount] = useState(review.notHelpfulCount);

  const handleVote = (vote: 'helpful' | 'not_helpful') => {
    if (!currentUserId || !onVote) return;

    // Optimistic update
    const prev = optimisticVote;
    if (prev === vote) {
      // Toggle off
      setOptimisticVote(null);
      if (vote === 'helpful') setHelpfulCount((c) => Math.max(0, c - 1));
      else setNotHelpfulCount((c) => Math.max(0, c - 1));
    } else {
      // Undo previous
      if (prev === 'helpful') setHelpfulCount((c) => Math.max(0, c - 1));
      if (prev === 'not_helpful') setNotHelpfulCount((c) => Math.max(0, c - 1));
      // Apply new
      setOptimisticVote(vote);
      if (vote === 'helpful') setHelpfulCount((c) => c + 1);
      else setNotHelpfulCount((c) => c + 1);
    }

    onVote(review.id, vote);
  };

  const formattedDate = new Date(review.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <article className="bg-card border border-border rounded-lg p-5 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
            {review.reviewerName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-sm text-foreground">{review.reviewerName}</span>
              {review.isVerifiedPurchase && (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  <ShieldCheck size={12} />
                  Verified
                </span>
              )}
            </div>
            <time className="text-xs text-muted-foreground">{formattedDate}</time>
          </div>
        </div>
        <StarRating value={review.rating} size="sm" />
      </div>

      {/* Content */}
      <div>
        <h4 className="font-semibold text-foreground mb-1">{review.title}</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">{review.body}</p>
      </div>

      {/* Helpful voting */}
      <div className="flex items-center gap-3 pt-1 border-t border-border">
        <span className="text-xs text-muted-foreground">Helpful?</span>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 px-2 gap-1.5 text-xs',
            optimisticVote === 'helpful' && 'text-primary bg-primary/10'
          )}
          onClick={() => handleVote('helpful')}
          disabled={!currentUserId}
          aria-pressed={optimisticVote === 'helpful'}
        >
          <ThumbsUp size={13} />
          {helpfulCount > 0 && <span>{helpfulCount}</span>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 px-2 gap-1.5 text-xs',
            optimisticVote === 'not_helpful' && 'text-destructive bg-destructive/10'
          )}
          onClick={() => handleVote('not_helpful')}
          disabled={!currentUserId}
          aria-pressed={optimisticVote === 'not_helpful'}
        >
          <ThumbsDown size={13} />
          {notHelpfulCount > 0 && <span>{notHelpfulCount}</span>}
        </Button>
        {!currentUserId && (
          <span className="text-xs text-muted-foreground ml-auto">Sign in to vote</span>
        )}
      </div>
    </article>
  );
}
