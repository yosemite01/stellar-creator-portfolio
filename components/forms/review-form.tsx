'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { StarRating } from '@/components/widgets/rating-display';
import { cn } from '@/lib/utils';

interface ReviewFormProps {
  creatorId: string;
  creatorName: string;
  onSubmit: (data: { rating: number; title: string; body: string }) => Promise<void>;
  onCancel?: () => void;
  className?: string;
}

export function ReviewForm({ creatorId: _creatorId, creatorName, onSubmit, onCancel, className }: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = rating > 0 && title.trim().length > 0 && body.trim().length >= 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ rating, title: title.trim(), body: body.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('bg-card border border-border rounded-lg p-6 space-y-5', className)}
      aria-label={`Write a review for ${creatorName}`}
    >
      <h3 className="text-lg font-semibold text-foreground">Write a Review</h3>

      {/* Star rating picker */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          Your Rating <span className="text-destructive">*</span>
        </label>
        <StarRating value={rating} interactive onChange={setRating} size="lg" />
        {rating > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {['', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating]}
          </p>
        )}
      </div>

      {/* Title */}
      <div>
        <label htmlFor="review-title" className="block text-sm font-medium text-foreground mb-1.5">
          Review Title <span className="text-destructive">*</span>
        </label>
        <input
          id="review-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Summarize your experience"
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
          required
        />
      </div>

      {/* Body */}
      <div>
        <label htmlFor="review-body" className="block text-sm font-medium text-foreground mb-1.5">
          Your Review <span className="text-destructive">*</span>
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Share details about your experience working with this creator..."
          className="w-full px-3 py-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground resize-none"
          required
        />
        <p className="text-xs text-muted-foreground mt-1 text-right">{body.length}/2000</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!isValid || submitting}>
          {submitting ? 'Submitting...' : 'Submit Review'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Reviews are moderated before being published. Your review will appear once approved.
      </p>
    </form>
  );
}
