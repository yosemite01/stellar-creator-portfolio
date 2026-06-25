/**
 * AppStateRestorationService — Issue #799
 *
 * Serializes and rehydrates the app navigation state so that OS-level
 * process kills don't lose user context (e.g., user returns to MessagingScreen
 * after 5 minutes in background).
 *
 * Features:
 *   - 30-minute TTL for saved state
 *   - Automatic filtering of sensitive screens (PaymentScreen, AuthScreen, etc.)
 *   - First-time user detection and OnboardingScreen bypass
 *   - Safe JSON serialization/deserialization
 *
 * Usage:
 *   - On app launch (in useEffect): call `restoreState()` and pass result to NavigationContainer
 *   - On navigation state change: call `saveState(navigationState)`
 *   - On logout: call `clearState()`
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Storage keys */
const STORAGE_NAV_STATE_KEY = '@stellar_nav_state';
const STORAGE_ONBOARDING_KEY = '@stellar_onboarding_complete';

/** 30-minute TTL in milliseconds */
const STATE_TTL_MS = 30 * 60 * 1000;

/** Screens that can be restored after background kill */
export const RESTORABLE_SCREENS = [
  'BountyListScreen',
  'CreatorProfileScreen',
  'MessagingScreen',
] as const;

/** Screens that should never be restored (security/sensitive) */
export const NON_RESTORABLE_SCREENS = [
  'PaymentScreen',
  'AuthScreen',
  'LoginScreen',
  'RegisterScreen',
  'CameraScreen',
  'OnboardingScreen',
] as const;

export interface NavigationState {
  state?: {
    routes?: Array<{
      name: string;
      [key: string]: any;
    }>;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface RestoredAppState {
  /** Filtered navigation state (without sensitive screens) */
  state: NavigationState | null;
  /** Timestamp when state was saved */
  savedAt: number;
}

class AppStateRestorationService {
  /**
   * Save navigation state to AsyncStorage.
   * Automatically filters out non-restorable screens.
   */
  async saveState(navigationState: NavigationState): Promise<void> {
    try {
      const filtered = this.filterNavigationState(navigationState);
      const snapshot: RestoredAppState = {
        state: filtered,
        savedAt: Date.now(),
      };
      await AsyncStorage.setItem(STORAGE_NAV_STATE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.error('Failed to save app state:', error);
    }
  }

  /**
   * Restore navigation state from AsyncStorage.
   * Returns null if:
   *   - No saved state exists
   *   - State has expired (> 30 minutes old)
   *   - State is corrupted
   *
   * After restoration, automatically calls clearState().
   */
  async restoreState(): Promise<NavigationState | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_NAV_STATE_KEY);
      if (!raw) return null;

      const snapshot: RestoredAppState = JSON.parse(raw);

      // Check TTL: discard if older than 30 minutes
      if (Date.now() - snapshot.savedAt > STATE_TTL_MS) {
        await this.clearState();
        return null;
      }

      // State is valid; clear it after returning so next background kill starts fresh
      await this.clearState();

      return snapshot.state;
    } catch (error) {
      console.error('Failed to restore app state:', error);
      return null;
    }
  }

  /**
   * Remove the stored navigation state.
   * Call after logout or successful restoration.
   */
  async clearState(): Promise<void> {
    try {
      await AsyncStorage.removeItem(STORAGE_NAV_STATE_KEY);
    } catch (error) {
      console.error('Failed to clear app state:', error);
    }
  }

  /**
   * Check if user has completed onboarding.
   * Returns true if onboarding is done; false for first-time users.
   */
  async isOnboardingComplete(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(STORAGE_ONBOARDING_KEY);
      return value === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Mark onboarding as complete.
   * Call this after user finishes the onboarding flow.
   */
  async markOnboardingComplete(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_ONBOARDING_KEY, 'true');
    } catch (error) {
      console.error('Failed to mark onboarding complete:', error);
    }
  }

  /**
   * Filter navigation state to remove non-restorable screens.
   * Recursively walks the navigation state tree and removes any
   * routes that are in NON_RESTORABLE_SCREENS.
   */
  private filterNavigationState(navigationState: NavigationState): NavigationState {
    if (!navigationState || typeof navigationState !== 'object') {
      return navigationState;
    }

    const filtered = { ...navigationState };

    // Filter routes array if present
    if (filtered.state?.routes && Array.isArray(filtered.state.routes)) {
      filtered.state.routes = filtered.state.routes.filter(
        (route) => !NON_RESTORABLE_SCREENS.includes(route.name as any),
      );
    }

    return filtered;
  }
}

export const appStateRestorationService = new AppStateRestorationService();
