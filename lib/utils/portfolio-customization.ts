/**
 * Portfolio customization - types, defaults, validation, and persistence.
 * Uses localStorage for client-side persistence (swap for DB in production).
 */

export type LayoutOption = 'grid' | 'masonry' | 'carousel'

export type ThemeId =
  | 'default'
  | 'midnight'
  | 'ocean'
  | 'forest'
  | 'sunset'
  | 'monochrome'

export interface PortfolioTheme {
  id: ThemeId
  name: string
  description: string
  preview: string // CSS gradient for preview swatch
  vars: {
    primary: string
    accent: string
    background: string
    card: string
    foreground: string
  }
}

export interface CustomSection {
  id: string
  type: 'text' | 'skills' | 'services' | 'testimonial' | 'cta'
  title: string
  content: string
  visible: boolean
  order: number
}

export interface PortfolioCustomization {
  creatorId: string
  themeId: ThemeId
  layout: LayoutOption
  accentColor: string // hex override, empty = use theme default
  sections: CustomSection[]
  showStats: boolean
  showReviews: boolean
  showServices: boolean
  heroStyle: 'cover' | 'minimal' | 'centered'
  updatedAt: string
}

export const THEMES: PortfolioTheme[] = [
  {
    id: 'default',
    name: 'Stellar',
    description: 'The classic Stellar look',
    preview: 'linear-gradient(135deg, oklch(0.35 0.15 250), oklch(0.6 0.15 200))',
    vars: {
      primary: 'oklch(0.35 0.15 250)',
      accent: 'oklch(0.6 0.15 200)',
      background: 'oklch(0.98 0 0)',
      card: 'oklch(1 0 0)',
      foreground: 'oklch(0.15 0 0)',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark, bold, and dramatic',
    preview: 'linear-gradient(135deg, #1a1a2e, #16213e)',
    vars: {
      primary: 'oklch(0.7 0.2 270)',
      accent: 'oklch(0.75 0.18 310)',
      background: 'oklch(0.1 0.02 260)',
      card: 'oklch(0.15 0.02 260)',
      foreground: 'oklch(0.95 0 0)',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Cool blues and teals',
    preview: 'linear-gradient(135deg, #0077b6, #00b4d8)',
    vars: {
      primary: 'oklch(0.45 0.18 220)',
      accent: 'oklch(0.65 0.16 195)',
      background: 'oklch(0.97 0.01 220)',
      card: 'oklch(1 0 0)',
      foreground: 'oklch(0.12 0.02 220)',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Earthy greens and naturals',
    preview: 'linear-gradient(135deg, #2d6a4f, #52b788)',
    vars: {
      primary: 'oklch(0.38 0.12 155)',
      accent: 'oklch(0.6 0.14 145)',
      background: 'oklch(0.97 0.01 145)',
      card: 'oklch(1 0 0)',
      foreground: 'oklch(0.12 0.02 145)',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm oranges and purples',
    preview: 'linear-gradient(135deg, #f77f00, #d62828)',
    vars: {
      primary: 'oklch(0.55 0.2 40)',
      accent: 'oklch(0.6 0.22 25)',
      background: 'oklch(0.98 0.01 40)',
      card: 'oklch(1 0 0)',
      foreground: 'oklch(0.12 0.02 30)',
    },
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    description: 'Clean black and white',
    preview: 'linear-gradient(135deg, #1a1a1a, #555)',
    vars: {
      primary: 'oklch(0.2 0 0)',
      accent: 'oklch(0.5 0 0)',
      background: 'oklch(0.98 0 0)',
      card: 'oklch(1 0 0)',
      foreground: 'oklch(0.1 0 0)',
    },
  },
]

export const DEFAULT_SECTIONS: CustomSection[] = [
  { id: 'bio', type: 'text', title: 'About Me', content: '', visible: true, order: 0 },
  { id: 'skills', type: 'skills', title: 'Skills & Expertise', content: '', visible: true, order: 1 },
  { id: 'services', type: 'services', title: 'Services', content: '', visible: true, order: 2 },
  { id: 'testimonial', type: 'testimonial', title: 'Testimonial', content: '', visible: false, order: 3 },
  { id: 'cta', type: 'cta', title: 'Call to Action', content: "Let's work together", visible: true, order: 4 },
]

export function getDefaultCustomization(creatorId: string): PortfolioCustomization {
  return {
    creatorId,
    themeId: 'default',
    layout: 'grid',
    accentColor: '',
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
    showStats: true,
    showReviews: true,
    showServices: true,
    heroStyle: 'cover',
    updatedAt: new Date().toISOString(),
  }
}

const STORAGE_KEY = (id: string) => `portfolio_customization_${id}`

export function loadCustomization(creatorId: string): PortfolioCustomization {
  if (typeof window === 'undefined') return getDefaultCustomization(creatorId)
  try {
    const raw = localStorage.getItem(STORAGE_KEY(creatorId))
    if (!raw) return getDefaultCustomization(creatorId)
    return { ...getDefaultCustomization(creatorId), ...JSON.parse(raw) }
  } catch {
    return getDefaultCustomization(creatorId)
  }
}

export function saveCustomization(config: PortfolioCustomization): void {
  if (typeof window === 'undefined') return
  const toSave = { ...config, updatedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY(config.creatorId), JSON.stringify(toSave))
}

export function validateCustomization(config: Partial<PortfolioCustomization>): string[] {
  const errors: string[] = []
  if (config.themeId && !THEMES.find((t) => t.id === config.themeId)) {
    errors.push(`Invalid theme: ${config.themeId}`)
  }
  if (config.layout && !['grid', 'masonry', 'carousel'].includes(config.layout)) {
    errors.push(`Invalid layout: ${config.layout}`)
  }
  if (config.accentColor && !/^(#[0-9a-fA-F]{3,8}|)$/.test(config.accentColor)) {
    errors.push('Invalid accent color format')
  }
  if (config.sections) {
    for (const s of config.sections) {
      // XSS prevention: strip script tags from custom content
      if (/<script/i.test(s.content) || /javascript:/i.test(s.content)) {
        errors.push(`Section "${s.title}" contains disallowed content`)
      }
      if (s.title.length > 80) {
        errors.push(`Section title "${s.title}" exceeds 80 characters`)
      }
      if (s.content.length > 2000) {
        errors.push(`Section "${s.title}" content exceeds 2000 characters`)
      }
    }
  }
  return errors
}

export function applyThemeVars(themeId: ThemeId, accentOverride?: string): void {
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]
  const root = document.documentElement
  root.style.setProperty('--primary', theme.vars.primary)
  root.style.setProperty('--accent', accentOverride || theme.vars.accent)
  root.style.setProperty('--background', theme.vars.background)
  root.style.setProperty('--card', theme.vars.card)
  root.style.setProperty('--foreground', theme.vars.foreground)
}

export function resetThemeVars(): void {
  const root = document.documentElement
  ;['--primary', '--accent', '--background', '--card', '--foreground'].forEach((v) =>
    root.style.removeProperty(v)
  )
}
