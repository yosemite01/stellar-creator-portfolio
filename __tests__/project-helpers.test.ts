import { describe, expect, it } from 'vitest'
import type { Project } from '@/lib/services/creators-data'
import {
  filterProjectsByCategory,
  getProjectDetail,
  getProjectStatus,
  getProjectTechStack,
  projectCategoryOptions,
} from '@/lib/utils/project-helpers'

const sample: Project[] = [
  {
    id: 'a',
    title: 'A',
    description: 'Short',
    category: 'Alpha',
    image: '/x.jpg',
    tags: ['t1'],
    year: 2024,
    techStack: ['React'],
    detail: 'Long story',
  },
  {
    id: 'b',
    title: 'B',
    description: 'Beta desc',
    category: 'Beta',
    image: '/y.jpg',
    tags: ['t2', 't3'],
    year: 2023,
  },
]

describe('project-helpers', () => {
  it('lists categories with All first', () => {
    expect(projectCategoryOptions(sample)).toEqual(['All', 'Alpha', 'Beta'])
  })

  it('filters by category', () => {
    expect(filterProjectsByCategory(sample, 'All')).toHaveLength(2)
    expect(filterProjectsByCategory(sample, 'Alpha')).toHaveLength(1)
    expect(filterProjectsByCategory(sample, 'Beta')[0]?.id).toBe('b')
  })

  it('defaults status to completed', () => {
    expect(getProjectStatus(sample[1]!)).toBe('completed')
  })

  it('prefers techStack over tags', () => {
    expect(getProjectTechStack(sample[0]!)).toEqual(['React'])
    expect(getProjectTechStack(sample[1]!)).toEqual(['t2', 't3'])
  })

  it('uses detail when present', () => {
    expect(getProjectDetail(sample[0]!)).toBe('Long story')
    expect(getProjectDetail(sample[1]!)).toBe('Beta desc')
  })
})
