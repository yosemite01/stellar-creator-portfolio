"use client";

import React, { createContext, useContext, useMemo } from "react";
import {
  DataLoader,
  createCreatorReviewsLoader,
  createCreatorReputationLoader,
} from "@/lib/dataloader";

interface DataLoaderContextType {
  creatorReviewsLoader: DataLoader<string, any>;
  creatorReputationLoader: DataLoader<string, any>;
}

const DataLoaderContext = createContext<DataLoaderContextType | null>(null);

export function DataLoaderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const loaders = useMemo(
    () => ({
      creatorReviewsLoader: createCreatorReviewsLoader(),
      creatorReputationLoader: createCreatorReputationLoader(),
    }),
    [],
  );

  return (
    <DataLoaderContext.Provider value={loaders}>
      {children}
    </DataLoaderContext.Provider>
  );
}

export function useDataLoaders() {
  const context = useContext(DataLoaderContext);
  if (!context) {
    throw new Error("useDataLoaders must be used within DataLoaderProvider");
  }
  return context;
}
