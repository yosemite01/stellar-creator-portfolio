/**
 * Semantic color tokens for light and dark color schemes.
 *
 * Values are derived from the shared brand palette in `tokens.ts` so the
 * typography colors stay in sync with the rest of the design system.
 */
import { DarkColors, LightColors } from './tokens';

/** Semantic text/surface colors keyed by color scheme. */
export const colors = {
  light: {
    textPrimary: LightColors.text,
    textSecondary: LightColors.textSecondary,
    textDisabled: LightColors.textTertiary,
    background: LightColors.background,
    surface: LightColors.surface,
  },
  dark: {
    textPrimary: DarkColors.text,
    textSecondary: DarkColors.textSecondary,
    textDisabled: DarkColors.textTertiary,
    background: DarkColors.background,
    surface: DarkColors.surface,
  },
} as const;

/** Available color scheme keys (`'light' | 'dark'`). */
export type ColorSchemeName = keyof typeof colors;

/** Semantic color token names (`'textPrimary' | 'background' | …`). */
export type SemanticColorToken = keyof typeof colors.light;
