import { describe, it, expect } from 'vitest'
import {
  assignStrategy,
  scoreCreatorBountyPair,
  rankBountiesForCreator,
  rankCreatorsForBounty,
  tokenize,
  jaccard,
  aggregateStrategyInsights,
  exactSkillOverlap,
  exactCategoryMatch,
  activityBoost,
  type BountyFeatures,
  type CreatorFeatures,
} from '@/lib/matching-engine'

const sampleBounty = (over: Partial<BountyFeatures> = {}): BountyFeatures => ({
  id: 'b1',
  title: 'React dashboard',
  description: 'Build analytics dashboard with charts and TypeScript',
  budget: 4000,
  category: 'Development',
  tags: ['react', 'typescript', 'analytics'],
  ...over,
})

const sampleCreator = (over: Partial<CreatorFeatures> = {}): CreatorFeatures => ({
  profileId: 'p1',
  userId: 'u1',
  displayName: 'Alex Dev',
  bio: 'Frontend engineer focused on React and data visualization',
  discipline: 'Development',
  skills: ['react', 'typescript', 'figma'],
  rating: 4.5,
  completedProjects: 12,
  ...over,
})

describe('matching-engine', () => {
  it('tokenize removes stop words and punctuation', () => {
    const t = tokenize('Hello, the React & TypeScript!')
    expect(t).toContain('react')
    expect(t).toContain('typescript')
    expect(t).not.toContain('the')
  })

  it('jaccard is symmetric', () => {
    const a = new Set(['x', 'y'])
    const b = new Set(['y', 'z'])
    expect(jaccard(a, b)).toBeCloseTo(1 / 3, 5)
  })

  it('scoreCreatorBountyPair increases when skills align with tags', () => {
    const high = scoreCreatorBountyPair(sampleBounty(), sampleCreator())
    const low = scoreCreatorBountyPair(
      sampleBounty({ tags: ['legal'], category: 'Law', description: 'contract review' }),
      sampleCreator({ skills: ['react'], bio: 'developer', discipline: 'Development' }),
    )
    expect(high.score).toBeGreaterThan(low.score)
  })

  it('treatment_skill weighs overlap more than treatment_budget', () => {
    const bounty = sampleBounty()
    const creator = sampleCreator()
    const sSkill = scoreCreatorBountyPair(bounty, creator, 'treatment_skill')
    const sBudget = scoreCreatorBountyPair(bounty, creator, 'treatment_budget')
    expect(sSkill.components.skillOverlap).toBe(sBudget.components.skillOverlap)
    expect(sSkill.score).not.toBe(sBudget.score)
  })

  it('assignStrategy is stable for same userId', () => {
    expect(assignStrategy('user-abc')).toBe(assignStrategy('user-abc'))
  })

  it('rankBountiesForCreator sorts by score descending', () => {
    const creator = sampleCreator()
    const ranked = rankBountiesForCreator(
      [
        sampleBounty({ id: 'a', tags: ['rust'] }),
        sampleBounty({ id: 'b', tags: ['react', 'typescript'] }),
      ],
      creator,
      'control',
      10,
    )
    expect(ranked[0]!.bounty.id).toBe('b')
  })

  it('rankCreatorsForBounty respects limit', () => {
    const bounty = sampleBounty()
    const creators = [
      sampleCreator({ profileId: '1', userId: 'u1', skills: ['vue'] }),
      sampleCreator({ profileId: '2', userId: 'u2', skills: ['react', 'typescript'] }),
      sampleCreator({ profileId: '3', userId: 'u3', skills: ['rust'] }),
    ]
    const ranked = rankCreatorsForBounty(bounty, creators, 'control', 2)
    expect(ranked).toHaveLength(2)
  })

  it('aggregateStrategyInsights computes helpful rates', () => {
    const out = aggregateStrategyInsights([
      { strategy: 'control', helpful: true },
      { strategy: 'control', helpful: false },
      { strategy: 'treatment_skill', helpful: true },
    ])
    const ctrl = out.find((s) => s.strategy === 'control')
    expect(ctrl?.helpfulRate).toBe(50)
    expect(ctrl?.samples).toBe(2)
  })

  it('ranks hundreds of bounties within performance budget', () => {
    const bounties = Array.from({ length: 400 }, (_, i) =>
      sampleBounty({ id: `b${i}`, tags: i % 2 === 0 ? ['react'] : ['legal'] }),
    )
    const creator = sampleCreator()
    const t0 = performance.now()
    rankBountiesForCreator(bounties, creator, 'control', 50)
    expect(performance.now() - t0).toBeLessThan(2000)
  })

  // -------------------------------------------------------------------------
  // #878 — Exact skill/category weighting and activity boost
  // -------------------------------------------------------------------------

  describe('exactSkillOverlap', () => {
    it('returns 1 when all bounty tags are exact creator skills', () => {
      const bounty = sampleBounty({ tags: ['react', 'typescript'] })
      const creator = sampleCreator({ skills: ['react', 'typescript', 'figma'] })
      expect(exactSkillOverlap(bounty, creator)).toBe(1)
    })

    it('returns 0.5 when half of bounty tags are exact creator skills', () => {
      const bounty = sampleBounty({ tags: ['react', 'rust'] })
      const creator = sampleCreator({ skills: ['react', 'figma'] })
      expect(exactSkillOverlap(bounty, creator)).toBe(0.5)
    })

    it('returns 0 when no bounty tags match creator skills', () => {
      const bounty = sampleBounty({ tags: ['rust', 'webassembly'] })
      const creator = sampleCreator({ skills: ['figma', 'sketch'] })
      expect(exactSkillOverlap(bounty, creator)).toBe(0)
    })

    it('is case-insensitive', () => {
      const bounty = sampleBounty({ tags: ['React', 'TypeScript'] })
      const creator = sampleCreator({ skills: ['react', 'typescript'] })
      expect(exactSkillOverlap(bounty, creator)).toBe(1)
    })

    it('returns 0 when bounty has no tags', () => {
      const bounty = sampleBounty({ tags: [] })
      const creator = sampleCreator()
      expect(exactSkillOverlap(bounty, creator)).toBe(0)
    })
  })

  describe('exactCategoryMatch', () => {
    it('returns 1 for identical category and discipline', () => {
      const bounty = sampleBounty({ category: 'Design' })
      const creator = sampleCreator({ discipline: 'Design' })
      expect(exactCategoryMatch(bounty, creator)).toBe(1)
    })

    it('returns 0.5 when one contains the other', () => {
      const bounty = sampleBounty({ category: 'UI/UX Design' })
      const creator = sampleCreator({ discipline: 'Design' })
      expect(exactCategoryMatch(bounty, creator)).toBe(0.5)
    })

    it('returns 0 for completely different category and discipline', () => {
      const bounty = sampleBounty({ category: 'Legal' })
      const creator = sampleCreator({ discipline: 'Design' })
      expect(exactCategoryMatch(bounty, creator)).toBe(0)
    })

    it('returns 0 when category or discipline is missing', () => {
      expect(exactCategoryMatch(sampleBounty({ category: null }), sampleCreator())).toBe(0)
      expect(exactCategoryMatch(sampleBounty(), sampleCreator({ discipline: null }))).toBe(0)
    })
  })

  describe('activityBoost', () => {
    it('returns high score for recently active creator with perfect response rate', () => {
      const creator = sampleCreator({
        lastBountyCompletedAt: new Date().toISOString(),
        responseRate: 1,
      })
      const score = activityBoost(creator)
      expect(score).toBeCloseTo(1, 1)
    })

    it('returns 0 when no activity data provided', () => {
      const creator = sampleCreator({ lastBountyCompletedAt: null, responseRate: null })
      expect(activityBoost(creator)).toBe(0)
    })

    it('decays to 0 when last completion exceeds recencyWindowDays', () => {
      const oldDate = new Date(Date.now() - 400 * 86_400_000).toISOString()
      const creator = sampleCreator({ lastBountyCompletedAt: oldDate, responseRate: 0 })
      expect(activityBoost(creator, { recencyWindowDays: 180 })).toBe(0)
    })

    it('respects weight multiplier', () => {
      const creator = sampleCreator({
        lastBountyCompletedAt: new Date().toISOString(),
        responseRate: 1,
      })
      const base = activityBoost(creator, { weight: 1 })
      const half = activityBoost(creator, { weight: 0.5 })
      expect(half).toBeCloseTo(base * 0.5, 1)
    })
  })

  describe('scoreCreatorBountyPair — exact match edge cases', () => {
    it('exact skill match raises score vs text-similar but different skills', () => {
      const bounty = sampleBounty({ tags: ['react', 'typescript'], category: 'Development' })

      // High text similarity but NO exact skill match
      const textSimilarCreator = sampleCreator({
        bio: 'I work on react and typescript projects daily',
        skills: ['vue', 'javascript'], // different actual skills
        discipline: 'Development',
      })

      // Exact skill match
      const exactMatchCreator = sampleCreator({
        bio: 'Backend developer',
        skills: ['react', 'typescript'],
        discipline: 'Development',
      })

      const textScore = scoreCreatorBountyPair(bounty, textSimilarCreator)
      const exactScore = scoreCreatorBountyPair(bounty, exactMatchCreator)
      expect(exactScore.score).toBeGreaterThan(textScore.score)
    })

    it('components include exactSkill and exactCategory fields', () => {
      const result = scoreCreatorBountyPair(sampleBounty(), sampleCreator())
      expect(result.components).toHaveProperty('exactSkill')
      expect(result.components).toHaveProperty('exactCategory')
      expect(result.components).toHaveProperty('activity')
    })

    it('activity boost reason appears for highly active creator', () => {
      const creator = sampleCreator({
        lastBountyCompletedAt: new Date().toISOString(),
        responseRate: 1,
      })
      const result = scoreCreatorBountyPair(sampleBounty(), creator)
      expect(result.reasons.some((r) => r.toLowerCase().includes('active'))).toBe(true)
    })

    it('treatment_skill strategy boosts exact skill weight more than treatment_budget', () => {
      const bounty = sampleBounty({ tags: ['react', 'typescript'] })
      const creator = sampleCreator({ skills: ['react', 'typescript'] })
      const skillStrat = scoreCreatorBountyPair(bounty, creator, 'treatment_skill')
      const budgetStrat = scoreCreatorBountyPair(bounty, creator, 'treatment_budget')
      expect(skillStrat.score).toBeGreaterThan(budgetStrat.score)
    })
  })
})
