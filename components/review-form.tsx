'use client';

import { useState } from 'react';
import { Star, Loader, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { z } from 'zod';

const reviewSchema = z.object({
  rating: z.number().min(1).max(5),
  text: z.string().min(20, 'Review must be at least 20 characters').max(500),
});

type ReviewFormData = z.infer<typeof reviewSchema>;

interface ReviewFormProps {
  creatorId: string;
  onClose: () => void;
  onSubmit: (review: any) => void;
}

export function ReviewForm({ creatorId, onClose, onSubmit }: ReviewFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<ReviewFormData>({
    rating: 5,
    text: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const validated = reviewSchema.parse(formData);

      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId,
          ...validated,
        }),
      });

      if (!response.ok) throw new Error('Failed to submit review');

      const review = await response.json();
      onSubmit(review);
    } catch (err) {
      if (err instanceof z.ZodError) {
        setError(err.errors[0].message);
      } else {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { validateReview, type ReviewSubmission, type FieldError } from '@/lib/api-models';
import { submitReview, ApiClientError } from '@/lib/api-client';

// ── Star picker ───────────────────────────────────────────────────────────────

interface StarPickerProps {
  value: number;
  onChange: (rating: number) => void;
  error?: boolean;
}

function StarPicker({ value, onChange, error }: StarPickerProps) {
  const [hovered, setHovered] = useState(0);
  const active = hovered || value;

  return (
    <div
      className="flex gap-1"
      role="radiogroup"
      aria-label="Star rating"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          className={cn(
            'p-0.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            error && value === 0 && 'text-destructive',
          )}
        >
          <Star
            size={28}
            className={cn(
              'transition-colors',
              star <= active ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40',
            )}
          />
        </button>
      ))}
    </div>
  );
}

// ── Field error helper ────────────────────────────────────────────────────────

function fieldError(errors: FieldError[], field: string): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}

// ── ReviewForm ────────────────────────────────────────────────────────────────

export interface ReviewFormProps {
  bountyId: string;
  creatorId: string;
  creatorName: string;
  /** Called after a successful submission. */
  onSuccess?: () => void;
  /** Called when form is cancelled. */
  onCancel?: () => void;
  /** Show as modal or inline form */
  variant?: 'modal' | 'inline';
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function ReviewForm({ 
  bountyId, 
  creatorId, 
  creatorName, 
  onSuccess, 
  onCancel,
  variant = 'inline' 
}: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formState, setFormState] = useState<FormState>('idle');
  const [apiError, setApiError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    const data: Partial<ReviewSubmission> = { bountyId, creatorId, rating, title, body, reviewerName };
    const errors = validateReview(data);
    if (errors) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors([]);
    setFormState('submitting');

    try {
      await submitReview(data as ReviewSubmission);
      setFormState('success');
      onSuccess?.();
    } catch (err) {
      setFormState('error');
      setApiError(
        err instanceof ApiClientError
          ? err.message
          : 'Something went wrong. Please try again.',
      );
    }
  }

  if (formState === 'success') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-border bg-card p-8 text-center space-y-3"
      >
        <div className="text-4xl">🎉</div>
        <h3 className="text-lg font-semibold text-foreground">Review submitted!</h3>
        <p className="text-sm text-muted-foreground">
          Thanks for sharing your feedback on working with {creatorName}.
        </p>
      </div>
    );
  }

  const ratingError = fieldError(fieldErrors, 'rating');
  const titleError = fieldError(fieldErrors, 'title');
  const bodyError = fieldError(fieldErrors, 'body');
  const nameError = fieldError(fieldErrors, 'reviewerName');

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-card border border-border rounded-lg p-6 mb-6"
    >
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-semibold text-foreground">Leave a Review</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {error && (
        <div className="bg-destructive/20 border border-destructive rounded p-3 mb-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-foreground mb-2">
          Rating
        </label>
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setFormData((prev) => ({ ...prev, rating: i + 1 }))}
              className="transition-transform hover:scale-110"
            >
              <Star
                size={28}
                className={
                  i < formData.rating
                    ? 'fill-accent text-accent'
                    : 'text-muted-foreground'
                }
              />
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-foreground mb-2">
          Your Review
        </label>
        <textarea
          value={formData.text}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, text: e.target.value }))
          }
          placeholder="Share your experience working with this creator..."
          rows={4}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {formData.text.length}/500 characters
        </p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isLoading} className="flex-1">
          {isLoading && <Loader size={16} className="mr-2 animate-spin" />}
          {isLoading ? 'Submitting...' : 'Submit Review'}
        </Button>
        <Button
          type="button"
          onClick={onClose}
          variant="outline"
          className="flex-1"
        >
          Cancel
        </Button>
      </div>
      noValidate
      aria-label="Submit a review"
      className="rounded-xl border border-border bg-card p-6 sm:p-8 space-y-6"
    >
      <div>
        <h2 className="text-xl font-bold text-foreground">Leave a review</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Share your experience working with {creatorName}.
        </p>
      </div>

      {/* Star rating */}
      <div className="space-y-1.5">
        <Label>
          Rating <span aria-hidden>*</span>
        </Label>
        <StarPicker value={rating} onChange={setRating} error={!!ratingError} />
        {ratingError && (
          <p role="alert" className="text-xs text-destructive">
            {ratingError}
          </p>
        )}
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="review-title">
          Title <span aria-hidden>*</span>
        </Label>
        <Input
          id="review-title"
          placeholder="Summarise your experience"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!titleError}
          aria-describedby={titleError ? 'review-title-error' : undefined}
          maxLength={120}
        />
        {titleError && (
          <p id="review-title-error" role="alert" className="text-xs text-destructive">
            {titleError}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="space-y-1.5">
        <Label htmlFor="review-body">
          Feedback <span aria-hidden>*</span>
        </Label>
        <Textarea
          id="review-body"
          placeholder="Describe the quality of work, communication, and overall experience…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={!!bodyError}
          aria-describedby={bodyError ? 'review-body-error' : undefined}
          rows={4}
          maxLength={1000}
        />
        <div className="flex justify-between items-start">
          {bodyError ? (
            <p id="review-body-error" role="alert" className="text-xs text-destructive">
              {bodyError}
            </p>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground tabular-nums">{body.length}/1000</span>
        </div>
      </div>

      {/* Reviewer name */}
      <div className="space-y-1.5">
        <Label htmlFor="reviewer-name">
          Your name <span aria-hidden>*</span>
        </Label>
        <Input
          id="reviewer-name"
          placeholder="e.g. Jane D."
          value={reviewerName}
          onChange={(e) => setReviewerName(e.target.value)}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? 'reviewer-name-error' : undefined}
          maxLength={80}
        />
        {nameError && (
          <p id="reviewer-name-error" role="alert" className="text-xs text-destructive">
            {nameError}
          </p>
        )}
      </div>

      {/* API-level error */}
      {apiError && (
        <p role="alert" className="text-sm text-destructive">
          {apiError}
        </p>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={formState === 'submitting'}
        aria-busy={formState === 'submitting'}
      >
        {formState === 'submitting' ? 'Submitting…' : 'Submit review'}
      </Button>

      {variant === 'modal' && onCancel && (
        <Button
          type="button"
          variant="outline"
          className="w-full mt-2"
          onClick={onCancel}
          disabled={formState === 'submitting'}
        >
          Cancel
        </Button>
      )}
    </form>
  );
}
