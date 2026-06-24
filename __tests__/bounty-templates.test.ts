import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  SEED_TEMPLATES,
  getSeedTemplates,
  getTemplatesByCategory,
  getTemplateCategories,
  getTemplateById,
  loadCustomTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  type CustomTemplate,
} from '@/lib/bounty-templates'

describe('bounty-templates', () => {
  describe('seed templates', () => {
    it('has exactly 20 seed templates', () => {
      expect(SEED_TEMPLATES).toHaveLength(20)
    })

    it('every template has required fields', () => {
      for (const tpl of SEED_TEMPLATES) {
        expect(tpl.id).toBeTruthy()
        expect(tpl.category).toBeTruthy()
        expect(tpl.title).toBeTruthy()
        expect(tpl.description).toBeTruthy()
        expect(tpl.suggestedBudget).toBeGreaterThan(0)
        expect(tpl.suggestedTimeline).toBeGreaterThan(0)
        expect(tpl.requiredSkills.length).toBeGreaterThan(0)
        expect(tpl.difficulty).toMatch(/^(beginner|intermediate|advanced|expert)$/)
        expect(tpl.tags.length).toBeGreaterThan(0)
        expect(tpl.deliverables).toBeTruthy()
      }
    })

    it('has unique IDs across all templates', () => {
      const ids = SEED_TEMPLATES.map((t) => t.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('covers at least 6 categories', () => {
      const categories = new Set(SEED_TEMPLATES.map((t) => t.category))
      expect(categories.size).toBeGreaterThanOrEqual(6)
    })

    it('includes Design, Writing, Development, and Marketing categories', () => {
      const categories = new Set(SEED_TEMPLATES.map((t) => t.category))
      expect(categories.has('Design')).toBe(true)
      expect(categories.has('Writing')).toBe(true)
      expect(categories.has('Development')).toBe(true)
      expect(categories.has('Marketing')).toBe(true)
    })
  })

  describe('getSeedTemplates', () => {
    it('returns a copy of the seed templates array', () => {
      const result = getSeedTemplates()
      expect(result).toHaveLength(20)
      expect(result).not.toBe(SEED_TEMPLATES)
    })
  })

  describe('getTemplatesByCategory', () => {
    it('returns all templates when category is All', () => {
      const result = getTemplatesByCategory('All')
      expect(result).toHaveLength(20)
    })

    it('filters templates by category', () => {
      const designTemplates = getTemplatesByCategory('Design')
      expect(designTemplates.length).toBeGreaterThan(0)
      expect(designTemplates.every((t) => t.category === 'Design')).toBe(true)
    })

    it('returns empty array for non-existent category', () => {
      const result = getTemplatesByCategory('NonExistent')
      expect(result).toHaveLength(0)
    })
  })

  describe('getTemplateCategories', () => {
    it('returns All plus all unique categories', () => {
      const categories = getTemplateCategories()
      expect(categories[0]).toBe('All')
      expect(categories.length).toBeGreaterThanOrEqual(7) // All + 6+ categories
    })

    it('returns sorted categories', () => {
      const categories = getTemplateCategories()
      const sorted = [...categories].sort()
      expect(categories).toEqual(sorted)
    })
  })

  describe('getTemplateById', () => {
    it('finds a template by its ID', () => {
      const tpl = getTemplateById('tpl-logo-design')
      expect(tpl).toBeDefined()
      expect(tpl?.title).toBe('Logo Design')
    })

    it('returns undefined for non-existent ID', () => {
      expect(getTemplateById('non-existent')).toBeUndefined()
    })
  })

  describe('custom templates (localStorage)', () => {
    beforeEach(() => {
      // Clear localStorage before each test
      if (typeof window !== 'undefined') {
        window.localStorage.clear()
      }
    })

    it('returns empty array when no custom templates exist', () => {
      const result = loadCustomTemplates()
      expect(result).toEqual([])
    })

    it('saves and loads custom templates', () => {
      const custom: CustomTemplate = {
        id: 'custom-1',
        category: 'Design',
        title: 'My Custom Template',
        description: 'A custom template',
        suggestedBudget: 500,
        suggestedTimeline: 5,
        requiredSkills: ['Figma'],
        difficulty: 'beginner',
        tags: ['Custom'],
        deliverables: 'Deliverables',
        userId: 'user-1',
        createdAt: new Date().toISOString(),
      }

      const result = saveCustomTemplate(custom)
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('My Custom Template')

      const loaded = loadCustomTemplates()
      expect(loaded).toHaveLength(1)
      expect(loaded[0].id).toBe('custom-1')
    })

    it('deletes custom templates by ID', () => {
      const custom: CustomTemplate = {
        id: 'custom-2',
        category: 'Writing',
        title: 'To Delete',
        description: 'Temp',
        suggestedBudget: 100,
        suggestedTimeline: 1,
        requiredSkills: ['Writing'],
        difficulty: 'beginner',
        tags: ['Temp'],
        deliverables: 'None',
        userId: 'user-1',
        createdAt: new Date().toISOString(),
      }

      saveCustomTemplate(custom)
      expect(loadCustomTemplates()).toHaveLength(1)

      const remaining = deleteCustomTemplate('custom-2')
      expect(remaining).toHaveLength(0)
      expect(loadCustomTemplates()).toHaveLength(0)
    })

    it('handles corrupted localStorage gracefully', () => {
      window.localStorage.setItem('stellar-custom-templates', 'not-json')
      const result = loadCustomTemplates()
      expect(result).toEqual([])
    })
  })
})
