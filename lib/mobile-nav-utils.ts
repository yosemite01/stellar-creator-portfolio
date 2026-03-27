/** Minimum touch target per WCAG / Apple HIG (44 CSS pixels). */
export const MIN_TOUCH_TARGET_PX = 44

/** Horizontal swipe distance (px) to close the drawer when swiping toward the edge. */
export const SWIPE_CLOSE_THRESHOLD_PX = 56

export function shouldCloseMenuOnHorizontalSwipe(
  deltaX: number,
  threshold: number = SWIPE_CLOSE_THRESHOLD_PX,
): boolean {
  return deltaX >= threshold
}

/**
 * Circular index step for roving focus (arrow up/down).
 */
export function nextFocusIndex(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1
  let next = current + delta
  if (next < 0) next = length - 1
  if (next >= length) next = 0
  return next
}

export function collectFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  const selector =
    'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((el) => {
    if (el.closest('[hidden], [inert]')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    if (el.offsetParent !== null) return true
    if (el.getClientRects().length > 0) return true
    // JSDOM has no layout; still collect connected nodes for unit tests / focus roving.
    return import.meta.env.MODE === 'test' && el.isConnected
  })
}
