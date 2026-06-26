'use client';

import { TourOverlay } from '@/components/TourOverlay';
import { useTour } from '@/hooks/useTour';

export function OnboardingTour() {
  const {
    isOpen,
    currentStep,
    currentStepData,
    next,
    previous,
    skip,
    complete,
    totalSteps,
  } = useTour();

  if (!currentStepData || !isOpen) {
    return null;
  }

  return (
    <TourOverlay
      isOpen={isOpen}
      targetSelector={currentStepData.targetSelector}
      title={currentStepData.title}
      description={currentStepData.description}
      step={currentStep + 1}
      totalSteps={totalSteps}
      onNext={next}
      onPrevious={previous}
      onSkip={skip}
      onComplete={complete}
    />
  );
}
