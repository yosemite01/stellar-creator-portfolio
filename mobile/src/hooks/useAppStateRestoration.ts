/**
 * useAppStateRestoration
 *
 * Wires React Native's AppState lifecycle to AppStateRestorationService so
 * that navigation + form state is persisted on suspension and rehydrated on
 * the next launch.
 *
 * @param getNavState  Callback that returns the current navigation state.
 * @param getFormState Callback that returns the current form snapshots.
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  appStateRestorationService,
  AppStateSnapshot,
  FormSnapshot,
} from '../services/AppStateRestorationService';

interface UseAppStateRestorationOptions {
  getNavState: () => { state: object; activeRoute: string } | null;
  getFormState?: () => FormSnapshot;
  onRestored?: (snapshot: AppStateSnapshot) => void;
}

export function useAppStateRestoration({
  getNavState,
  getFormState,
  onRestored,
}: UseAppStateRestorationOptions) {
  const restoredRef = useRef(false);

  // Attempt restoration once on mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    appStateRestorationService.restore().then((snapshot) => {
      if (snapshot && onRestored) {
        onRestored(snapshot);
      }
    });
  }, [onRestored]);

  const persistNow = useCallback(async () => {
    const nav = getNavState?.();
    if (!nav) return;
    const forms = getFormState?.() ?? {};
    await appStateRestorationService.persist(nav.state, nav.activeRoute, forms);
  }, [getNavState, getFormState]);

  // Persist whenever the app moves to background / inactive.
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'background' || nextState === 'inactive') {
          persistNow();
        }
      },
    );
    return () => subscription.remove();
  }, [persistNow]);

  return { persistNow, clear: appStateRestorationService.clear.bind(appStateRestorationService) };
}
