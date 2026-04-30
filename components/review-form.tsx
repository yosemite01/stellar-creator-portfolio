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
    </form>
  );
}
