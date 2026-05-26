/**
 * Hook to initialize and manage error tracking
 * Automatically initializes error tracking on app load
 * Provides utilities for capturing errors and setting user context
 */

import { useEffect } from 'react';
import { errorTracker, initializeErrorTracking } from '@/lib/error-tracking';

/**
 * Initialize error tracking on app load
 */
export function useInitializeErrorTracking() {
  useEffect(() => {
    initializeErrorTracking().catch((error) => {
      console.error('Failed to initialize error tracking:', error);
    });
  }, []);
}

/**
 * Set user context for error tracking
 */
export function useSetErrorTrackingUser(userId?: string, userEmail?: string) {
  useEffect(() => {
    if (userId) {
      errorTracker.setUserContext(userId, userEmail);
    } else {
      errorTracker.clearUserContext();
    }
  }, [userId, userEmail]);
}

/**
 * Capture an error with context
 */
export function useCaptureError() {
  return (error: Error | string, context?: any) => {
    return errorTracker.captureError(error, context);
  };
}

/**
 * Add breadcrumb for error tracking
 */
export function useAddBreadcrumb() {
  return (message: string, category?: string, level?: 'info' | 'warning' | 'error') => {
    errorTracker.addBreadcrumb(message, category, level);
  };
}
