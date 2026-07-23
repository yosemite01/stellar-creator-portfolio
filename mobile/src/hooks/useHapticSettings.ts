/**
 * useHapticSettings — Issue #812
 * Settings toggle to disable haptics entirely.
 * Persists preference via AsyncStorage.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setHapticsEnabled, isHapticsEnabled } from '../haptics/HapticEngine';

const STORAGE_KEY = '@stellar/haptics_enabled';

export function useHapticSettings() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      const parsed = val === null ? true : val === 'true';
      setEnabled(parsed);
      setHapticsEnabled(parsed);
    });
  }, []);

  const toggle = useCallback(async (value: boolean) => {
    setEnabled(value);
    setHapticsEnabled(value);
    await AsyncStorage.setItem(STORAGE_KEY, String(value));
  }, []);

  return { enabled, toggle };
}
