import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  validateCustomization,
  getDefaultCustomization,
  THEMES,
  loadCustomization,
  saveCustomization,
} from '@/lib/utils/portfolio-customization'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

describe('getDefaultCustomization', () => {
  it('returns a valid default config for a creator', () => {
    const config = getDefaultCustomization('creator-1')
    expect(config.creatorId).toBe('creator-1')
    expect(config.themeId).toBe('default')
    expect(config.layout).toBe('grid')
    expect(config.sections.length).toBeGreaterThan(0)
    expect(config.showStats).toBe(true)
  })
})

describe('validateCustomization', () => {
  it('passes for a valid config', () => {
    const config = getDefaultCustomization('c1')
    const errors = validateCustomization(config)
    expect(errors).toHaveLength(0)
  })

  it('rejects invalid themeId', () => {
    const errors = validateCustomization({ themeId: 'nonexistent' as any })
    expect(errors.some((e) => e.includes('Invalid theme'))).toBe(true)
  })

  it('rejects invalid layout', () => {
    const errors = validateCustomization({ layout: 'waterfall' as any })
    expect(errors.some((e) => e.includes('Invalid layout'))).toBe(true)
  })

  it('rejects invalid hex accent color', () => {
    const errors = validateCustomization({ accentColor: 'not-a-color' })
    expect(errors.some((e) => e.includes('Invalid accent color'))).toBe(true)
  })

  it('accepts empty accent color (use theme default)', () => {
    const errors = validateCustomization({ accentColor: '' })
    expect(errors).toHaveLength(0)
  })

  it('accepts valid hex accent color', () => {
    const errors = validateCustomization({ accentColor: '#3b82f6' })
    expect(errors).toHaveLength(0)
  })

  it('rejects section with script tag (XSS prevention)', () => {
    const config = getDefaultCustomization('c2')
    config.sections[0].content = '<script>alert("xss")</script>'
    const errors = validateCustomization(config)
    expect(errors.some((e) => e.includes('disallowed content'))).toBe(true)
  })

  it('rejects section with javascript: protocol (XSS prevention)', () => {
    const config = getDefaultCustomization('c3')
    config.sections[0].content = 'javascript:alert(1)'
    const errors = validateCustomization(config)
    expect(errors.some((e) => e.includes('disallowed content'))).toBe(true)
  })

  it('rejects section title exceeding 80 chars', () => {
    const config = getDefaultCustomization('c4')
    config.sections[0].title = 'a'.repeat(81)
    const errors = validateCustomization(config)
    expect(errors.some((e) => e.includes('exceeds 80 characters'))).toBe(true)
  })

  it('rejects section content exceeding 2000 chars', () => {
    const config = getDefaultCustomization('c5')
    config.sections[0].content = 'a'.repeat(2001)
    const errors = validateCustomization(config)
    expect(errors.some((e) => e.includes('exceeds 2000 characters'))).toBe(true)
  })
})

describe('THEMES', () => {
  it('contains at least 6 themes', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(6)
  })

  it('each theme has required fields', () => {
    for (const theme of THEMES) {
      expect(theme.id).toBeTruthy()
      expect(theme.name).toBeTruthy()
      expect(theme.vars.primary).toBeTruthy()
      expect(theme.vars.accent).toBeTruthy()
    }
  })

  it('default theme exists', () => {
    expect(THEMES.find((t) => t.id === 'default')).toBeDefined()
  })
})

describe('loadCustomization / saveCustomization', () => {
  beforeEach(() => localStorageMock.clear())

  it('returns default when nothing saved', () => {
    const config = loadCustomization('new-creator')
    expect(config.themeId).toBe('default')
  })

  it('saves and loads back correctly', () => {
    const config = getDefaultCustomization('save-test')
    config.themeId = 'midnight'
    config.layout = 'masonry'
    saveCustomization(config)

    const loaded = loadCustomization('save-test')
    expect(loaded.themeId).toBe('midnight')
    expect(loaded.layout).toBe('masonry')
  })

  it('merges saved config with defaults (forward compat)', () => {
    // Simulate a partial saved config (missing new fields)
    localStorageMock.setItem(
      'portfolio_customization_partial',
      JSON.stringify({ themeId: 'ocean' })
    )
    const loaded = loadCustomization('partial')
    expect(loaded.themeId).toBe('ocean')
    expect(loaded.layout).toBe('grid') // default filled in
  })
})
