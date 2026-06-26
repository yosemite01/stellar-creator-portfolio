'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

interface TourTooltipProps {
  title: string;
  description: string;
  step: number;
  totalSteps: number;
  targetRect: DOMRect | null;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

export function TourTooltip({
  title,
  description,
  step,
  totalSteps,
  targetRect,
  onNext,
  onPrevious,
  onSkip,
  onComplete,
}: TourTooltipProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!targetRect) return;

    const padding = 16;
    const tooltipHeight = 200;
    const tooltipWidth = 300;

    let top = targetRect.bottom + padding;
    let left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;

    // Adjust if tooltip goes off-screen
    if (left < padding) {
      left = padding;
    } else if (left + tooltipWidth > window.innerWidth - padding) {
      left = window.innerWidth - tooltipWidth - padding;
    }

    if (top + tooltipHeight > window.innerHeight) {
      top = targetRect.top - tooltipHeight - padding;
    }

    setPosition({ top, left });
  }, [targetRect]);

  if (!targetRect) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={`tooltip-${step}`}
        initial={{ opacity: 0, scale: 0.9, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -10 }}
        transition={{ duration: 0.2 }}
        className="fixed z-50 bg-background border border-border rounded-lg shadow-lg p-4 w-80 pointer-events-auto"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </div>
          <button
            onClick={onSkip}
            className="ml-2 p-1 hover:bg-secondary rounded transition-colors flex-shrink-0"
            aria-label="Close tour"
          >
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>

        {/* Step Counter */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-xs font-semibold text-muted-foreground">
              {step} of {totalSteps}
            </div>
          </div>
          <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${(step / totalSteps) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {step > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onPrevious}
              className="gap-1 flex-1"
            >
              <ChevronLeft size={14} />
              Previous
            </Button>
          )}

          <Button
            size="sm"
            variant={step === totalSteps ? 'default' : 'ghost'}
            onClick={step === totalSteps ? onComplete : onNext}
            className="gap-1 flex-1"
          >
            {step === totalSteps ? 'Done' : 'Next'}
            {step < totalSteps && <ChevronRight size={14} />}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={onSkip}
            className="flex-1"
          >
            Skip
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
