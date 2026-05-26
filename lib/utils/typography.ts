/**
 * ISSUE #18: Documentation - Typography & Spacing System
 * * This system uses CSS clamp() to provide fluid scaling.
 * formula: clamp(min, preferred, max)
 * * Scale is calculated to grow proportionally between:
 * - Minimum Viewport: 320px (Mobile)
 * - Maximum Viewport: 1440px (Desktop)
 */

export const typography = {
  fontSize: {
    xs: "var(--text-xs)",     // Helper text
    sm: "var(--text-sm)",     // Small body
    base: "var(--text-base)", // Standard body
    lg: "var(--text-lg)",     // Sub-headers
    xl: "var(--text-xl)",     // H3
    "2xl": "var(--text-2xl)", // H2
    "3xl": "var(--text-3xl)", // H1 / Hero
  },
  lineHeight: {
    tight: "var(--leading-tight)",
    normal: "var(--leading-normal)",
    relaxed: "var(--leading-relaxed)",
  },
  letterSpacing: {
    tight: "var(--tracking-tight)",
    normal: "var(--tracking-normal)",
    wide: "var(--tracking-wide)",
  },
} as const;

export const spacing = {
  1: "var(--space-1)",
  2: "var(--space-2)",
  4: "var(--space-4)",
  6: "var(--space-6)",
  8: "var(--space-8)",
  12: "var(--space-12)",
} as const;

export type TypographySystem = typeof typography;
export type SpacingSystem = typeof spacing;