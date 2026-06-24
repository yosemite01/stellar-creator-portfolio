import { Platform } from 'react-native';
import * as Application from 'expo-application';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppIconName = 'default' | 'light' | 'aurora' | 'midnight' | 'forest' | 'dark' | 'halloween';

// ─── Icon registry ────────────────────────────────────────────────────────────

const ICON_NAME_BY_KEY: Record<AppIconName, string | null> = {
  default:   null,
  light:     null,           // alias for default
  aurora:    'AuroraIcon',
  midnight:  'MidnightIcon',
  forest:    'ForestIcon',
  dark:      'DarkIcon',
  halloween: 'HalloweenIcon',
};

// ─── Android stub ─────────────────────────────────────────────────────────────

function warnAndroidNotSupported(fn: string): void {
  console.warn(
    `[AppIconService] ${fn}: Dynamic app icon switching on Android requires a ` +
      'native module (e.g. react-native-change-icon). Install and link it to enable this feature.',
  );
}

// ─── Core API ─────────────────────────────────────────────────────────────────

export async function supportsAppIconChangeAsync(): Promise<boolean> {
  if (Platform.OS === 'android') {
    return false; // requires native module — see warnAndroidNotSupported
  }
  if (Platform.OS !== 'ios' || typeof Application.supportsAlternateIconsAsync !== 'function') {
    return false;
  }
  return Application.supportsAlternateIconsAsync();
}

export async function getCurrentAppIconAsync(): Promise<AppIconName> {
  if (Platform.OS === 'android') {
    return 'default';
  }
  if (Platform.OS === 'ios' && typeof Application.getAlternateIconNameAsync === 'function') {
    const current = await Application.getAlternateIconNameAsync();
    return (
      (Object.keys(ICON_NAME_BY_KEY) as AppIconName[]).find(
        (key) => ICON_NAME_BY_KEY[key] === current,
      ) ?? 'default'
    );
  }
  return 'default';
}

export async function setAppIconAsync(icon: AppIconName): Promise<void> {
  if (Platform.OS === 'android') {
    warnAndroidNotSupported('setAppIconAsync');
    return;
  }

  if (Platform.OS !== 'ios' || typeof Application.supportsAlternateIconsAsync !== 'function') {
    return;
  }

  const supported = await supportsAppIconChangeAsync();
  if (!supported) {
    return;
  }

  // 'light' is an alias for 'default'
  const resolvedIcon: AppIconName = icon === 'light' ? 'default' : icon;
  const iconName = ICON_NAME_BY_KEY[resolvedIcon];

  if (typeof Application.setAlternateIconNameAsync === 'function') {
    await Application.setAlternateIconNameAsync(iconName);
  }
}

// ─── Theme-aware auto-switch ──────────────────────────────────────────────────

/**
 * Auto-sets the app icon to match the active colour scheme.
 * Call this from a `useColorScheme` listener in the root component.
 */
export async function autoSetIconForTheme(colorScheme: 'light' | 'dark'): Promise<void> {
  if (Platform.OS === 'android') {
    warnAndroidNotSupported('autoSetIconForTheme');
    return;
  }
  await setAppIconAsync(colorScheme === 'dark' ? 'dark' : 'default');
}

// ─── Seasonal auto-switch ─────────────────────────────────────────────────────

/** Returns true during October (Halloween season). */
export function isHalloweenSeason(): boolean {
  return new Date().getMonth() === 9; // month is 0-indexed; 9 = October
}

/**
 * Sets the Halloween icon if the current month is October.
 * Safe to call on app launch — no-ops outside October.
 */
export async function autoSetIconForSeason(): Promise<void> {
  if (Platform.OS === 'android') {
    warnAndroidNotSupported('autoSetIconForSeason');
    return;
  }
  if (isHalloweenSeason()) {
    await setAppIconAsync('halloween');
  }
}
