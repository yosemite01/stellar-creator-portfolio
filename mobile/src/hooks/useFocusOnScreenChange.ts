import { useEffect } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { RefObject } from 'react';

/**
 * Hook that focuses a given ref when the screen gains focus.
 * This helps with screen reader traversal by ensuring the focus is set to a logical starting point.
 * @param ref - The ref to focus when the screen gains focus
 * @param enabled - Whether the hook is active (default: true)
 */
export function useFocusOnScreenChange(
  ref: RefObject<HTMLElement>,
  enabled: boolean = true
) {
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused && enabled && ref.current) {
      ref.current.focus();
    }
  }, [isFocused, enabled, ref]);

  // Alternatively, use useFocusEffect for more control
  // useFocusEffect(() => {
  //   if (enabled && ref.current) {
  //     ref.current.focus();
  //   }
  // }, [enabled, ref]);
}