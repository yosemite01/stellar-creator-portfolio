/**
 * useAppStateRestoration — Issue #799
 *
 * Handles app state restoration on cold start and saves state on lifecycle changes.
 * Features:
 *   - First-time user detection (OnboardingScreen)
 *   - Automatic navigation state restoration (30-min TTL)
 *   - Filters out sensitive screens (PaymentScreen, AuthScreen, etc.)
 */

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import {
  appStateRestorationService,
  type NavigationState,
} from '../services/AppStateRestorationService';

export interface UseAppStateRestorationOptions {
  navigationRef: React.RefObject<NavigationContainerRef<any>>;
  onRestored?: (state: NavigationState | null) => void;
  onOnboardingRequired?: () => void;
}

/**
 * Hook to manage app state restoration.
 *
 * On cold start:
 *   1. Check if user has completed onboarding
 *   2. If not, navigate to OnboardingScreen
 *   3. If yes, try to restore previous navigation state
 *   4. If no saved state or expired, navigate to HomeScreen
 *
 * During app lifecycle:
 *   1. Save navigation state whenever it changes
 *   2. Clear state on logout/intentional exit
 */
export function useAppStateRestoration({
  navigationRef,
  onRestored,
  onOnboardingRequired,
}: UseAppStateRestorationOptions): void {
  const restoredRef = useRef(false);

  // Initialize on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const initializeApp = async () => {
      try {
        // Check if user is on first launch
        const isOnboarded = await appStateRestorationService.isOnboardingComplete();

        if (!isOnboarded) {
          // First-time user: always show OnboardingScreen
          onOnboardingRequired?.();
          return;
        }

        // User has been onboarded; try to restore navigation state
        const restoredState = await appStateRestorationService.restoreState();

        if (restoredState && navigationRef.current) {
          // Successfully restored; apply state to navigation
          navigationRef.current.resetRoot(restoredState);
          onRestored?.(restoredState);
        } else {
          // No saved state or expired; navigate to HomeScreen
          if (navigationRef.current) {
            navigationRef.current.resetRoot({
              index: 0,
              routes: [{ name: 'HomeScreen' }],
            });
          }
          onRestored?.(null);
        }
      } catch (error) {
        console.error('App initialization error:', error);
        // Fail gracefully; navigation defaults to HomeScreen
      }
    };

    initializeApp();
  }, [navigationRef, onRestored, onOnboardingRequired]);

  // Save state when navigation changes
  useEffect(() => {
    if (!navigationRef.current) return;

    const unsubscribe = navigationRef.current?.addListener('state', ({ data }) => {
      if (data) {
        appStateRestorationService.saveState(data);
      }
    });

    return unsubscribe;
  }, [navigationRef]);

  // Save state on app background
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      async (state: AppStateStatus) => {
        if (state === 'background' || state === 'inactive') {
          if (navigationRef.current?.getRootState()) {
            await appStateRestorationService.saveState(navigationRef.current.getRootState());
          }
        }
      },
    );

    return () => subscription.remove();
  }, [navigationRef]);
}

/**
 * Hook to mark onboarding as complete.
 * Call this when user finishes the onboarding flow.
 */
export function useMarkOnboardingComplete(): () => Promise<void> {
  return () => appStateRestorationService.markOnboardingComplete();
}

/**
 * Hook to clear app state.
 * Call this on logout.
 */
export function useClearAppState(): () => Promise<void> {
  return () => appStateRestorationService.clearState();
}
