'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TourTooltip } from '@/components/TourTooltip';

interface TourOverlayProps {
  isOpen: boolean;
  targetSelector: string;
  title: string;
  description: string;
  step: number;
  totalSteps: number;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

export function TourOverlay({
  isOpen,
  targetSelector,
  title,
  description,
  step,
  totalSteps,
  onNext,
  onPrevious,
  onSkip,
  onComplete,
}: TourOverlayProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setTargetRect(null);
      return;
    }

    const element = document.querySelector(targetSelector);
    if (!element) {
      console.warn(`Tour target not found: ${targetSelector}`);
      return;
    }

    const rect = element.getBoundingClientRect();
    setTargetRect(rect);

    const handleResize = () => {
      const newRect = element.getBoundingClientRect();
      setTargetRect(newRect);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize);
    };
  }, [isOpen, targetSelector]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="tour-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 bg-black/50 z-40 pointer-events-auto"
            onClick={onSkip}
          />

          {/* Spotlight */}
          {targetRect && (
            <motion.div
              key="tour-spotlight"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed z-40 pointer-events-none"
              style={{
                top: targetRect.top - 8,
                left: targetRect.left - 8,
                width: targetRect.width + 16,
                height: targetRect.height + 16,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                borderRadius: 'var(--radius, 8px)',
              }}
            />
          )}

          {/* Tooltip */}
          <div className="fixed z-50 pointer-events-none">
            <TourTooltip
              title={title}
              description={description}
              step={step}
              totalSteps={totalSteps}
              targetRect={targetRect}
              onNext={onNext}
              onPrevious={onPrevious}
              onSkip={onSkip}
              onComplete={onComplete}
            />
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
