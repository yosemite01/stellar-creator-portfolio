/**
 * AppStateRestorationService
 *
 * Serializes and rehydrates the full app state (navigation stack + form inputs)
 * so that OS-level process kills don't lose user context.
 *
 * Usage:
 *   - Call `persist(navState, formState)` on AppState 'background'/'inactive'.
 *   - Call `restore()` on app launch to get back the saved snapshot.
 *   - Call `clear()` after a clean exit so stale state isn't restored.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@stellar/app_state_snapshot';
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

export interface NavigationSnapshot {
  /** Serialised react-navigation state (JSON-safe). */
  navState: object;
  /** Active route name at the time of suspension. */
  activeRoute: string;
}

export interface FormSnapshot {
  /** Keyed by screen name → arbitrary form field values. */
  [screenName: string]: Record<string, unknown>;
}

export interface AppStateSnapshot {
  navigation: NavigationSnapshot;
  forms: FormSnapshot;
  /** Unix ms timestamp when the snapshot was taken. */
  savedAt: number;
}

class AppStateRestorationService {
  /**
   * Persist the current navigation + form state to AsyncStorage.
   * Designed to be called synchronously-ish from AppState change handlers.
   */
  async persist(
    navState: object,
    activeRoute: string,
    forms: FormSnapshot = {},
  ): Promise<void> {
    const snapshot: AppStateSnapshot = {
      navigation: { navState, activeRoute },
      forms,
      savedAt: Date.now(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  /**
   * Restore a previously persisted snapshot.
   * Returns `null` if nothing is stored or the snapshot has expired.
   */
  async restore(): Promise<AppStateSnapshot | null> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const snapshot: AppStateSnapshot = JSON.parse(raw);

      // Discard stale snapshots.
      if (Date.now() - snapshot.savedAt > SNAPSHOT_TTL_MS) {
        await this.clear();
        return null;
      }

      return snapshot;
    } catch {
      return null;
    }
  }

  /** Remove the stored snapshot (call on intentional logout / clean exit). */
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }
}

export const appStateRestorationService = new AppStateRestorationService();
