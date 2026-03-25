import { describe, it, expect } from 'vitest'

/**
 * Dark mode contrast & CSS variable tests.
 * These verify the semantic token values meet WCAG AA/AAA contrast requirements.
 *
 * OKLCH contrast is approximated via relative luminance from L channel.
 * L=0 is black, L=1 is white. WCAG contrast ratio = (L1+0.05)/(L2+0.05).
 */

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// CSS variable values extracted from globals.css (dark mode)
const darkTokens = {
  background: 0.12,
  foreground: 0.95,
  card: 0.18,
  cardForeground: 0.95,
  mutedForeground: 0.65,
  primary: 0.65,
  primaryForeground: 0.12,
  accent: 0.7,
  accentForeground: 0.12,
  destructive: 0.55,
  destructiveForeground: 0.9,
  // Badge tokens (dark)
  badgeBeginnerBg: 0.25,
  badgeBeginnerText: 0.82,
  badgeIntermediateBg: 0.26,
  badgeIntermediateText: 0.88,
  badgeAdvancedBg: 0.26,
  badgeAdvancedText: 0.88,
  badgeExpertBg: 0.25,
  badgeExpertText: 0.88,
}

// CSS variable values extracted from globals.css (light mode)
const lightTokens = {
  background: 0.98,
  foreground: 0.15,
  card: 1.0,
  cardForeground: 0.15,
  mutedForeground: 0.5,
  primary: 0.35,
  primaryForeground: 0.98,
  accent: 0.6,
  accentForeground: 1.0,
  destructive: 0.577,
  destructiveForeground: 1.0,
  // Badge tokens (light)
  badgeBeginnerBg: 0.92,
  badgeBeginnerText: 0.28,
  badgeIntermediateBg: 0.93,
  badgeIntermediateText: 0.32,
  badgeAdvancedBg: 0.92,
  badgeAdvancedText: 0.32,
  badgeExpertBg: 0.92,
  badgeExpertText: 0.32,
}

const WCAG_AA = 4.5
const WCAG_AAA = 7.0

describe('dark mode CSS variable contrast ratios', () => {
  it('foreground on background meets WCAG AAA (>7:1)', () => {
    const ratio = contrastRatio(darkTokens.foreground, darkTokens.background)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA)
  })

  it('card foreground on card meets WCAG AAA', () => {
    const ratio = contrastRatio(darkTokens.cardForeground, darkTokens.card)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA)
  })

  it('primary foreground on primary meets WCAG AA', () => {
    const ratio = contrastRatio(darkTokens.primaryForeground, darkTokens.primary)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })

  it('accent foreground on accent meets WCAG AA', () => {
    const ratio = contrastRatio(darkTokens.accentForeground, darkTokens.accent)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })

  it('destructive foreground on destructive meets WCAG AA', () => {
    const ratio = contrastRatio(darkTokens.destructiveForeground, darkTokens.destructive)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })

  it('muted foreground on background meets WCAG AA', () => {
    const ratio = contrastRatio(darkTokens.mutedForeground, darkTokens.background)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })
})

describe('dark mode difficulty badge contrast ratios', () => {
  it('beginner badge text on bg meets WCAG AAA', () => {
    const ratio = contrastRatio(darkTokens.badgeBeginnerText, darkTokens.badgeBeginnerBg)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA)
  })

  it('intermediate badge text on bg meets WCAG AAA', () => {
    const ratio = contrastRatio(darkTokens.badgeIntermediateText, darkTokens.badgeIntermediateBg)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA)
  })

  it('advanced badge text on bg meets WCAG AAA', () => {
    const ratio = contrastRatio(darkTokens.badgeAdvancedText, darkTokens.badgeAdvancedBg)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA)
  })

  it('expert badge text on bg meets WCAG AAA', () => {
    const ratio = contrastRatio(darkTokens.badgeExpertText, darkTokens.badgeExpertBg)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA)
  })
})

describe('light mode CSS variable contrast ratios', () => {
  it('foreground on background meets WCAG AAA', () => {
    const ratio = contrastRatio(lightTokens.foreground, lightTokens.background)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AAA)
  })

  it('primary foreground on primary meets WCAG AA', () => {
    const ratio = contrastRatio(lightTokens.primaryForeground, lightTokens.primary)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })

  it('accent foreground on accent meets WCAG AA', () => {
    const ratio = contrastRatio(lightTokens.accentForeground, lightTokens.accent)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })
})

describe('light mode difficulty badge contrast ratios', () => {
  it('beginner badge text on bg meets WCAG AA', () => {
    const ratio = contrastRatio(lightTokens.badgeBeginnerText, lightTokens.badgeBeginnerBg)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })

  it('intermediate badge text on bg meets WCAG AA', () => {
    const ratio = contrastRatio(lightTokens.badgeIntermediateText, lightTokens.badgeIntermediateBg)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })

  it('advanced badge text on bg meets WCAG AA', () => {
    const ratio = contrastRatio(lightTokens.badgeAdvancedText, lightTokens.badgeAdvancedBg)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })

  it('expert badge text on bg meets WCAG AA', () => {
    const ratio = contrastRatio(lightTokens.badgeExpertText, lightTokens.badgeExpertBg)
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA)
  })
})
