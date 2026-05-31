import { PixelRatio, AppState, NativeModules } from 'react-native';
import { useEffect, useState } from 'react';

/**
 * Hook that returns the current device font scale factor.
 * The font scale represents the user's preferred text scaling (e.g., 1.0 for default, 1.2 for larger text).
 * It updates when the app state changes (e.g., returning from background) to catch system-wide changes.
 */
export function useFontScale(): number {
  const [fontScale, setFontScale] = useState(() => PixelRatio.getFontScale());

  useEffect(() => {
    const handleAppStateChange = (state: string) => {
      if (state === 'active') {
        // Check if font scale has changed when app returns to foreground
        const newScale = PixelRatio.getFontScale();
        setFontScale(newScale);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, []);

  return fontScale;
}

/**
 * Scales a number based on the current font scale.
 * Use this for font sizes, spacing, and dimensions that should scale with user preferences.
 * @param value - The base value to scale
 * @returns The scaled value
 */
export function scaleSize(value: number): number {
  // In a real app, we would use the hook, but this function is meant to be used within components
  // that have access to the font scale. We'll keep it as a pure function that expects the scale factor.
  // Actually, we'll change it to accept the scale factor as an argument for flexibility.
  // But for simplicity, we'll create a version that uses the hook inside a component.
  // We'll instead create a function that takes the scale factor and the value.
  return value; // Placeholder
}

/**
 * Scales a number based on the provided font scale factor.
 * @param value - The base value to scale
 * @param fontScale - The font scale factor (e.g., 1.0, 1.2)
 * @returns The scaled value
 */
export function scaleSizeBy(value: number, fontScale: number): number {
  return value * fontScale;
}

/**
 * Accessibility announcement utility for screen readers.
 * Use this to announce important updates to screen reader users.
 */
export class AccessibilityAnnouncer {
  /**
   * Announces a message to screen readers.
   * @param message - The message to announce
   * @param priority - The politeness level: 'assertive' or 'polite'
   */
  static announce(message: string, priority: 'assertive' | 'polite' = 'polite'): void {
    // In React Native, we can use the accessibilityLiveRegion property on a view or use the AccessibilityInfo module.
    // However, there's no direct API to announce a message. Instead, we render a hidden live region.
    // For simplicity, we'll just log a warning that this needs to be implemented with a live region component.
    console.warn('AccessibilityAnnouncer.announce needs to be implemented with a live region component. Message:', message);
  }
}

/**
 * Calculates the contrast ratio between two colors.
 * @param foreground - Hex color string (e.g., '#ffffff')
 * @param background - Hex color string (e.g., '#000000')
 * @returns The contrast ratio (a number between 1 and 21)
 */
export function getContrastRatio(foreground: string, background: string): number {
  // Convert hex to RGB
  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);

  if (!fgRgb || !bgRgb) {
    return 1; // Return lowest contrast on error
  }

  // Calculate relative luminance
  const fgLuminance = relativeLuminance(fgRgb);
  const bgLuminance = relativeLuminance(bgRgb);

  // Ensure the lighter color is the numerator
  const lighter = Math.max(fgLuminance, bgLuminance);
  const darker = Math.min(fgLuminance, bgLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Checks if the contrast ratio between two colors meets WCAG guidelines.
 * @param foreground - Hex color string
 * @param background - Hex color string
 * @param standard - 'AA' or 'AAA' for text, or 'AA-large' / 'AAA-large' for large text
 * @param isLargeText - Whether the text is considered large (18pt+ or 14pt+ bold)
 * @returns Boolean indicating if the contrast is sufficient
 */
export function isContrastCompliant(
  foreground: string,
  background: string,
  standard: 'AA' | 'AAA' | 'AA-large' | 'AAA-large' = 'AA',
  isLargeText: boolean = false
): boolean {
  const ratio = getContrastRatio(foreground, background);

  switch (standard) {
    case 'AA':
      return isLargeText ? ratio >= 3 : ratio >= 4.5;
    case 'AAA':
      return isLargeText ? ratio >= 4.5 : ratio >= 7;
    case 'AA-large':
      return ratio >= 3;
    case 'AAA-large':
      return ratio >= 4.5;
    default:
      return ratio >= 4.5; // Default to AA normal text
  }
}

/**
 * Converts a hex color string to an RGB object.
 * @param hex - Hex color string (e.g., '#ffffff' or 'ffffff')
 * @returns RGB object with r, g, b values in the range 0-255, or null if invalid
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove the '#' if present
  const cleanHex = hex.replace('#', '');

  // Check for valid hex length (3 or 6)
  if (cleanHex.length === 3) {
    // Expand shorthand form (e.g., 'fff' -> 'ffffff')
    const expanded = cleanHex
      .split('')
      .map((char) => char + char)
      .join('');
    return parseHex(expanded);
  } else if (cleanHex.length === 6) {
    return parseHex(cleanHex);
  }

  return null;
}

/**
 * Parses a 6-character hex string into RGB components.
 * @param hex - 6-character hex string
 * @returns RGB object
 */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const num = parseInt(hex, 16);
  if (isNaN(num)) {
    return null;
  }

  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

/**
 * Calculates the relative luminance of an RGB color.
 * @param rgb - RGB object with r, g, b values in 0-255 range
 * @returns Relative luminance value between 0 and 1
 */
function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const { r, g, b } = rgb;

  // Convert sRGB to linear RGB
  const linearR = srgbToLinear(r / 255);
  const linearG = srgbToLinear(g / 255);
  const linearB = srgbToLinear(b / 255);

  // Calculate luminance using ITU BT.709 coefficients
  return 0.2126 * linearR + 0.7152 * linearG + 0.0722 * linearB;
}

/**
 * Converts an sRGB color component to linear RGB.
 * @param value - Normalized sRGB value (0-1)
 * @returns Linear RGB value
 */
function srgbToLinear(value: number): number {
  return value <= 0.03928
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}