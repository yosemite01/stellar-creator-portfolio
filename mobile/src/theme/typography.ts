/**
 * Typography scale for the design system.
 *
 * Each variant is a fully-resolved text style (font size, line height, and
 * weight). Consume these via the {@link TypographyVariant} type and the
 * `Text` component rather than hardcoding font sizes in screens.
 */
import type { TextStyle } from 'react-native';

/**
 * Named font-scale variants. Values are `as const` so each variant's
 * `fontWeight` is a literal compatible with React Native's `TextStyle`.
 */
export const typography = {
  displayLarge: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  displayMedium: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
  headingLarge: { fontSize: 24, lineHeight: 32, fontWeight: '600' },
  headingMedium: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  headingSmall: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  bodySmall: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  caption: { fontSize: 11, lineHeight: 16, fontWeight: '400' },
} as const satisfies Record<string, TextStyle>;

/** Union of every available typography variant name. */
export type TypographyVariant = keyof typeof typography;
