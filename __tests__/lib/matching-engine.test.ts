import { describe, it, expect } from 'vitest'
import {
  assignStrategy,
  scoreCreatorBountyPair,
  rankBountiesForCreator,
  rankCreatorsForBounty,
  tokenize,
  jaccard,
  aggregateStrategyInsights,
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
})
