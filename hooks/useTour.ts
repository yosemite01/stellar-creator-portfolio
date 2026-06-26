'use client';

import { useEffect, useState, useCallback } from 'react';
import { TOUR_STEPS } from '@/lib/tour-steps';

interface TourState {
  isOpen: boolean;
  currentStep: number;
  isCompleted: boolean;
}

export function useTour() {
  const [state, setState] = useState<TourState>({
    isOpen: false,
    currentStep: 0,
    isCompleted: false,
  });

  // Load tour state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('tour_completed');
    if (saved === 'true') {
      setState((prev) => ({ ...prev, isCompleted: true, isOpen: false }));
    } else {
      // Start tour on first visit
      setState((prev) => ({ ...prev, isOpen: true, currentStep: 0 }));
    }
  }, []);

  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step < TOUR_STEPS.length) {
      setState((prev) => ({ ...prev, currentStep: step }));
    }
  }, []);

  const next = useCallback(() => {
    setState((prev) => {
      if (prev.currentStep < TOUR_STEPS.length - 1) {
        return { ...prev, currentStep: prev.currentStep + 1 };
      }
      return prev;
    });
  }, []);

  const previous = useCallback(() => {
    setState((prev) => {
      if (prev.currentStep > 0) {
        return { ...prev, currentStep: prev.currentStep - 1 };
      }
      return prev;
    });
  }, []);

  const skip = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
    localStorage.setItem('tour_completed', 'true');
  }, []);

  const complete = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      isCompleted: true,
    }));
    localStorage.setItem('tour_completed', 'true');

    // Track completion in analytics
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'tour_completed', {
        event_category: 'engagement',
        event_label: 'onboarding_tour',
      });
    }
  }, []);

  const resume = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: true, isCompleted: false }));
    localStorage.setItem('tour_completed', 'false');
  }, []);

  const currentStepData = TOUR_STEPS[state.currentStep];

  return {
    ...state,
    currentStepData,
    goToStep,
    next,
    previous,
    skip,
    complete,
    resume,
    totalSteps: TOUR_STEPS.length,
  };
}
