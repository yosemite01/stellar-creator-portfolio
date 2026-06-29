'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { Creator } from '@/lib/services/creators-data';

interface ComparisonContextType {
  selectedCreators: Creator[];
  addCreator: (creator: Creator) => void;
  removeCreator: (creatorId: string) => void;
  clearComparison: () => void;
  isSelected: (creatorId: string) => boolean;
  canAddMore: () => boolean;
}

const ComparisonContext = createContext<ComparisonContextType | undefined>(undefined);

export function ComparisonProvider({ children }: { children: React.ReactNode }) {
  const [selectedCreators, setSelectedCreators] = useState<Creator[]>([]);

  const addCreator = useCallback((creator: Creator) => {
    setSelectedCreators((prev) => {
      if (prev.length >= 3 || prev.some((c) => c.id === creator.id)) {
        return prev;
      }
      return [...prev, creator];
    });
  }, []);

  const removeCreator = useCallback((creatorId: string) => {
    setSelectedCreators((prev) => prev.filter((c) => c.id !== creatorId));
  }, []);

  const clearComparison = useCallback(() => {
    setSelectedCreators([]);
  }, []);

  const isSelected = useCallback(
    (creatorId: string) => selectedCreators.some((c) => c.id === creatorId),
    [selectedCreators]
  );

  const canAddMore = useCallback(
    () => selectedCreators.length < 3,
    [selectedCreators.length]
  );

  return (
    <ComparisonContext.Provider
      value={{
        selectedCreators,
        addCreator,
        removeCreator,
        clearComparison,
        isSelected,
        canAddMore,
      }}
    >
      {children}
    </ComparisonContext.Provider>
  );
}

export function useComparison() {
  const context = useContext(ComparisonContext);
  if (!context) {
    throw new Error('useComparison must be used within ComparisonProvider');
  }
  return context;
}
