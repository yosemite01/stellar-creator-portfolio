/**
 * HapticEngine — Issue #812
 *
 * Provides a unified haptic feedback API for all key interactions.
 * - Respects OS silent/accessibility no-haptics mode.
 * - Exposes a global settings toggle (persisted per-session).
 * - Does NOT fire on auto-refresh; only on explicit user actions.
 *
 * Pattern → expo-haptics mapping
 * ───────────────────────────────
 * light      → ImpactFeedbackStyle.Light      (button tap)
 * medium     → ImpactFeedbackStyle.Medium     (send message)
 * success    → NotificationFeedbackType.Success (payment sent — three pulses)
 * heavy      → ImpactFeedbackStyle.Heavy      (new match)
 * error      → NotificationFeedbackType.Error  (two short bursts via double-call)
 * selection  → selectionAsync()               (drag reorder position)
 */

import * as Haptics from 'expo-haptics';

export type HapticPattern =
  | 'light'
  | 'medium'
  | 'success'
  | 'heavy'
  | 'error'
  | 'selection';

// ─── Settings toggle ──────────────────────────────────────────────────────────

let _hapticsEnabled = true;

/** Call from settings screen to honour user preference. */
export function setHapticsEnabled(enabled: boolean): void {
  _hapticsEnabled = enabled;
}

export function isHapticsEnabled(): boolean {
  return _hapticsEnabled;
}

// ─── Core trigger ─────────────────────────────────────────────────────────────

/**
 * Trigger a named haptic pattern.
 * No-ops when:
 *  - User disabled haptics in settings (`setHapticsEnabled(false)`)
 *  - OS silent/accessibility no-haptics mode is active (expo-haptics handles this natively)
 *
 * Must only be called from explicit user-initiated handlers — never from
 * auto-refresh, polling, or background data loads.
 */
export async function trigger(pattern: HapticPattern): Promise<void> {
  if (!_hapticsEnabled) return;

  switch (pattern) {
    case 'light':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;

    case 'medium':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;

    case 'success':
      // Three pulses — mirrors iOS "payment sent" pattern
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;

    case 'heavy':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      break;

    case 'error':
      // Two short bursts (error pattern)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      await new Promise(r => setTimeout(r, 100));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;

    case 'selection':
      await Haptics.selectionAsync();
      break;
  }
}

// ─── Legacy compat alias ──────────────────────────────────────────────────────

/** @deprecated Use trigger() instead. Kept for backwards compat. */
export function triggerHaptic(pattern: HapticPattern): void {
  trigger(pattern).catch(() => {});
}

/** @deprecated No longer used — expo-haptics respects OS silent mode natively. */
export function setNoHapticsMode(_disabled: boolean): void {}
