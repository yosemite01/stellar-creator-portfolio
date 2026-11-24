import React from 'react';

// Accessibility utilities and helpers for WCAG 2.2 AA compliance (Issue #1773)

export const A11Y_LABELS = {
  // Navigation
  toggleMenu: 'Toggle navigation menu',
  toggleTheme: 'Toggle dark/light theme',
  closeMenu: 'Close navigation menu',
  closeDialog: 'Close dialog',

  // Forms
  search: 'Search creators and bounties',
  filterBy: 'Filter results',
  submit: 'Submit form',

  // Interactive
  viewProfile: 'View creator profile',
  applyBounty: 'Apply for this bounty',
  leaveReview: 'Leave a review',
  readMore: 'Read more',

  // Wallet & Payments
  connectWallet: 'Connect Stellar wallet',
  disconnectWallet: 'Disconnect Stellar wallet',
  walletModal: 'Connect a Stellar wallet',
  swapModal: 'Cross-chain atomic swap',
  txStatus: 'Transaction status update',
  paymentError: 'Payment error',

  // Status
  loading: 'Loading...',
  error: 'Error occurred',
  success: 'Success',
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Collect visible, enabled focusable elements within `container`.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('[aria-hidden="true"], [hidden]')) return false;
    return true;
  });
}

/**
 * Returns a keydown handler for arrow-key/enter navigation between sibling
 * DOM elements (e.g. a listbox, radiogroup, or toolbar). Arrow keys move focus
 * to the next/previous sibling of `document.activeElement`; Enter/Space calls
 * `onSelect` with the currently focused element.
 */
export function useKeyboardNavigation(
  items: HTMLElement[],
  onSelect?: (item: HTMLElement) => void,
) {
  return (event: React.KeyboardEvent) => {
    const { key } = event;

    if (key === 'ArrowDown' || key === 'ArrowRight') {
      event.preventDefault();
      if (items.length > 0) {
        const idx = items.indexOf(document.activeElement as HTMLElement);
        const next = items[(idx + 1) % items.length];
        next?.focus();
      } else {
        const next = document.activeElement?.nextElementSibling as HTMLElement | null;
        next?.focus();
      }
    } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
      event.preventDefault();
      if (items.length > 0) {
        const idx = items.indexOf(document.activeElement as HTMLElement);
        const prev = items[(idx - 1 + items.length) % items.length];
        prev?.focus();
      } else {
        const prev = document.activeElement?.previousElementSibling as HTMLElement | null;
        prev?.focus();
      }
    } else if (key === 'Home' && items.length > 0) {
      event.preventDefault();
      items[0]?.focus();
    } else if (key === 'End' && items.length > 0) {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      onSelect?.(document.activeElement as HTMLElement);
    }
  };
}

export interface FocusTrapOptions {
  /** Activate or deactivate the focus trap (default `true`). */
  enabled?: boolean;
  /** Called when the user presses Escape while focus is trapped. */
  onEscape?: () => void;
  /** Explicit element to focus when the trap activates. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Restore focus to the element that was focused before activation (default `true`). */
  restoreFocus?: boolean;
}

/**
 * Traps Tab/Shift+Tab focus cycling within `elementRef`'s subtree (e.g. for a
 * modal dialog), moves initial focus into the container, handles Escape
 * dismissal, and restores focus to the trigger element on close.
 */
export function useFocusTrap(
  elementRef: React.RefObject<HTMLElement | null>,
  options: FocusTrapOptions = {},
) {
  const { enabled = true, onEscape, initialFocusRef, restoreFocus = true } = options;
  const onEscapeRef = React.useRef(onEscape);

  React.useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  React.useEffect(() => {
    if (!enabled) return;
    const element = elementRef.current;
    if (!element) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move initial focus inside the dialog container
    const focusInitial = () => {
      if (initialFocusRef?.current && element.contains(initialFocusRef.current)) {
        initialFocusRef.current.focus();
        return;
      }
      const autoFocusTarget = element.querySelector<HTMLElement>('[data-autofocus]');
      if (autoFocusTarget) {
        autoFocusTarget.focus();
        return;
      }
      const focusables = getFocusableElements(element);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        if (!element.hasAttribute('tabindex')) {
          element.setAttribute('tabindex', '-1');
        }
        element.focus();
      }
    };

    focusInitial();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onEscapeRef.current) {
          e.preventDefault();
          e.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }

      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements(element);
      if (focusableElements.length === 0) {
        e.preventDefault();
        element.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!active || !element.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? lastElement : firstElement).focus();
        return;
      }

      if (e.shiftKey) {
        if (active === firstElement || active === element) {
          e.preventDefault();
          lastElement.focus();
        }
      } else if (active === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [elementRef, enabled, initialFocusRef, restoreFocus]);
}

/** Visually-hidden-until-focused link that jumps keyboard users past navigation to `#main-content`. */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="absolute -top-14 left-0 bg-primary text-primary-foreground px-4 py-2 rounded focus:top-0 transition-all z-50"
    >
      Skip to main content
    </a>
  );
}

/**
 * Visually-hidden `aria-live` region that announces `message` to screen
 * readers without disrupting sighted layout.
 *
 * - `role="alert"` uses `aria-live="assertive"` for urgent errors/failures.
 * - `role="status"` (default) uses `aria-live="polite"` for progress updates.
 */
export function LiveRegion({
  message,
  role = 'status',
  politeness,
  id,
}: {
  message: string;
  role?: 'status' | 'alert';
  politeness?: 'polite' | 'assertive';
  id?: string;
}) {
  const liveMode = politeness ?? (role === 'alert' ? 'assertive' : 'polite');
  return (
    <div
      id={id}
      role={role}
      aria-live={liveMode}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

/**
 * Accessible inline error alert with stable `id` for `aria-describedby` linking.
 */
export function AccessibleErrorMessage({
  id,
  message,
  className = 'text-xs text-destructive',
}: {
  id?: string;
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} role="alert" aria-live="assertive" className={className}>
      {message}
    </p>
  );
}

function parseRgb(colorStr: string): [number, number, number] | null {
  const match = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Compute WCAG 2.x contrast ratio between two RGB tuples (`1` to `21`). */
export function computeContrastRatio(
  fg: [number, number, number],
  bg: [number, number, number],
): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Static helpers for ad-hoc, in-browser accessibility auditing of a DOM subtree. */
export class AccessibilityChecker {
  /**
   * Computes WCAG 2.2 AA contrast ratio from computed styles when both color
   * and an opaque backgroundColor are available (minimum 4.5:1 for normal text).
   */
  static checkContrast(element: HTMLElement): boolean {
    const computed = window.getComputedStyle(element);
    const fg = parseRgb(computed.color);
    const bg = parseRgb(computed.backgroundColor);
    if (!fg || !bg) return true;
    // Skip transparent backgrounds (`rgba(..., 0)`)
    if (/rgba\([^)]*,\s*0(?:\.0+)?\s*\)/i.test(computed.backgroundColor)) return true;

    const fontSize = parseFloat(computed.fontSize) || 16;
    const fontWeight = parseInt(computed.fontWeight, 10) || 400;
    const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const ratio = computeContrastRatio(fg, bg);
    return ratio >= (isLargeText ? 3.0 : 4.5);
  }

  /**
   * Scans `container` for focusable elements and flags two common issues:
   * interactive elements with neither an `aria-label` nor visible text, and
   * `role="button"` elements missing state attributes.
   */
  static checkKeyboardNavigation(container: HTMLElement): {
    focusableElements: HTMLElement[];
    missingLabels: HTMLElement[];
    missingAria: HTMLElement[];
  } {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea',
    ) as NodeListOf<HTMLElement>;

    const missingLabels = Array.from(focusableElements).filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        const id = el.getAttribute('id');
        if (id && container.querySelector(`label[for="${id}"]`)) return false;
      }
      return !el.textContent?.trim();
    });

    const missingAria = Array.from(focusableElements).filter(
      (el) =>
        el.getAttribute('role') === 'button' &&
        !el.hasAttribute('aria-pressed') &&
        !el.hasAttribute('aria-expanded'),
    );

    return {
      focusableElements: Array.from(focusableElements),
      missingLabels,
      missingAria,
    };
  }

  /**
   * Produces an accessibility report for `container` checking headings, image
   * alt attributes, unlabeled controls, and color contrast.
   */
  static generateAccessibilityReport(container: HTMLElement): {
    score: number;
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) {
      issues.push('No headings found on page');
    }

    const images = container.querySelectorAll('img:not([alt])');
    if (images.length > 0) {
      issues.push(`${images.length} images missing alt text`);
    }

    const navAudit = this.checkKeyboardNavigation(container);
    if (navAudit.missingLabels.length > 0) {
      issues.push(`${navAudit.missingLabels.length} interactive elements missing accessible labels`);
    }

    const elements = container.querySelectorAll('*');
    elements.forEach((el) => {
      if (!this.checkContrast(el as HTMLElement)) {
        warnings.push('Potential contrast issue');
      }
    });

    const score = Math.max(0, 100 - issues.length * 20 - warnings.length * 5);

    return { score, issues, warnings };
  }
}
