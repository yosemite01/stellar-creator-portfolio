'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RatingStarsProps {
  value?: number;
  max?: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  size?: number;
  className?: string;
}

export function RatingStars({
  value = 0,
  max = 5,
  onChange,
  readOnly = false,
  size = 20,
  className,
}: RatingStarsProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const active = hovered ?? value;

  return (
    <div
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={`Rating: ${value} out of ${max}`}
      className={cn('flex items-center gap-0.5', className)}
    >
      {Array.from({ length: max }, (_, i) => {
        const star = i + 1;
        const filled = star <= active;
        return (
          <button
            key={star}
            type="button"
            role={readOnly ? undefined : 'radio'}
            aria-checked={readOnly ? undefined : star === value}
            aria-label={`${star} star${star !== 1 ? 's' : ''}`}
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(star)}
            onMouseEnter={() => !readOnly && setHovered(star)}
            onMouseLeave={() => !readOnly && setHovered(null)}
            className={cn(
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm',
              readOnly ? 'cursor-default' : 'cursor-pointer'
            )}
          >
            <Star
              size={size}
              className={cn(
                'transition-colors',
                filled
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'fill-transparent text-muted-foreground'
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
