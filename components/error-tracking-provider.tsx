/**
 * Error Tracking Provider
 * Initializes centralized error tracking on app load
 * Wraps the entire application to capture all errors
 */

'use client';

import { useInitializeErrorTracking } from '@/hooks/useErrorTracking';

export function ErrorTrackingProvider({ children }: { children: React.ReactNode }) {
  // Initialize error tracking on app load
  useInitializeErrorTracking();

  return <>{children}</>;
}
