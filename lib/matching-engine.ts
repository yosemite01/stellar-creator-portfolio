/**
 * Skill- and preference-based matching with deterministic A/B strategy weights.
 * Uses only public profile and bounty fields (no demographics) to reduce bias surface.
 * Replace inner scoring with an embedding model + vector search when you wire real ML.
 */

export const MATCHING_STRATEGIES = ['control', 'treatment_skill', 'treatment_budget'] as const
export type MatchingStrategy = (typeof MATCHING_STRATEGIES)[number]

export type MatchMode = 'FOR_CREATOR' | 'FOR_CLIENT'

export interface BountyFeatures {
  id: string
  title: string
  description: string
  budget: number
  category: string | null
  tags: string[]
}

export interface CreatorFeatures {
  profileId: string
  userId: string
  displayName: string
  bio: string | null
  discipline: string | null
  skills: string[]
  rating: number
  completedProjects: number
  /** ISO timestamp of last completed bounty — used for activity boost */
  lastBountyCompletedAt?: string | null
  /** Response rate 0–1 — used for activity boost */
  responseRate?: number | null
}

export interface MatchScoreBreakdown {
  score: number
  /** 0–100 before strategy multiplier noise */
  rawScore: number
  reasons: string[]
  components: {
    skillOverlap: number
    exactSkill: number
    exactCategory: number
    textRelevance: number
    disciplineMatch: number
    reputation: number
    budgetFit: number
    activity: number
  }
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your', 'our', 'we', 'you',
  'is', 'are', 'be', 'this', 'that', 'from', 'as', 'at', 'by', 'it', 'will', 'can', 'need', 'looking',
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP.has(t))
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const x of a) {
    if (b.has(x)) inter++
  }
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

export function bagOverlap(a: string[], b: string[]): number {
  const A = new Set(a.map((s) => s.toLowerCase().trim()).filter(Boolean))
  const B = new Set(b.map((s) => s.toLowerCase().trim()).filter(Boolean))
  return jaccard(A, B)
}

function textRelevance(bounty: BountyFeatures, creator: CreatorFeatures): number {
  const bountyTokens = new Set(
    tokenize(`${bounty.title} ${bounty.description} ${bounty.category ?? ''} ${bounty.tags.join(' ')}`),
  )
  const creatorTokens = new Set(
    tokenize(`${creator.displayName} ${creator.bio ?? ''} ${creator.discipline ?? ''} ${creator.skills.join(' ')}`),
  )
  return jaccard(bountyTokens, creatorTokens)
}

function skillTagOverlap(bounty: BountyFeatures, creator: CreatorFeatures): number {
  const bountySide = [...bounty.tags, bounty.category].filter(Boolean) as string[]
  return bagOverlap(bountySide, creator.skills)
}

/**
 * Exact skill match: counts how many of the bounty's required tags appear
 * verbatim in the creator's skills (case-insensitive). Returns 0–1 where 1
 * means every bounty tag is exactly covered.
 */
export function exactSkillOverlap(bounty: BountyFeatures, creator: CreatorFeatures): number {
  const required = bounty.tags.filter(Boolean).map((t) => t.toLowerCase().trim())
  if (required.length === 0) return 0
  const creatorSet = new Set(creator.skills.map((s) => s.toLowerCase().trim()))
  const matches = required.filter((t) => creatorSet.has(t)).length
  return matches / required.length
}

/**
 * Exact category match: 1 if creator's discipline exactly equals the bounty
 * category, 0.5 if one contains the other, 0 otherwise.
 */
export function exactCategoryMatch(bounty: BountyFeatures, creator: CreatorFeatures): number {
  if (!creator.discipline || !bounty.category) return 0
  const d = creator.discipline.toLowerCase().trim()
  const c = bounty.category.toLowerCase().trim()
  if (d === c) return 1
  if (d.includes(c) || c.includes(d)) return 0.5
  return 0
}

/**
 * Activity boost: rewards creators with recent completions and high response
 * rates. Configurable via `boostConfig`.
 */
export interface ActivityBoostConfig {
  /** Multiplier applied to the raw activity score (default 1). */
  weight?: number
  /** Age in days beyond which activity score decays to 0 (default 180). */
  recencyWindowDays?: number
}

export function activityBoost(
  creator: CreatorFeatures,
  config: ActivityBoostConfig = {},
): number {
  const { weight = 1, recencyWindowDays = 180 } = config

  let recency = 0
  if (creator.lastBountyCompletedAt) {
    const ageMs = Date.now() - new Date(creator.lastBountyCompletedAt).getTime()
    const ageDays = ageMs / 86_400_000
    recency = Math.max(0, 1 - ageDays / recencyWindowDays)
  }

  const responseRate = typeof creator.responseRate === 'number'
    ? Math.max(0, Math.min(1, creator.responseRate))
    : 0

  // Combine: 60% recency, 40% response rate
  return clamp01((recency * 0.6 + responseRate * 0.4) * weight)
}

function disciplineMatch(bounty: BountyFeatures, creator: CreatorFeatures): number {
  if (!creator.discipline || !bounty.category) return 0.35
  const d = creator.discipline.toLowerCase()
  const c = bounty.category.toLowerCase()
  if (d === c) return 1
  if (c.includes(d) || d.includes(c)) return 0.75
  return 0.2
}

function reputation(creator: CreatorFeatures): number {
  const r = Math.min(1, creator.rating / 5)
  const exp = Math.min(1, creator.completedProjects / 25)
  return r * 0.65 + exp * 0.35
}

/** Heuristic: higher completion count → comfortable with larger briefs */
function budgetFit(bounty: BountyFeatures, creator: CreatorFeatures): number {
  const b = bounty.budget
  const tier = Math.min(1, creator.completedProjects / 20)
  const softMin = 300 + tier * 1500
  const softMax = 5000 + tier * 25000
  if (b >= softMin && b <= softMax) return 1
  const dist =
    b < softMin ? (softMin - b) / softMin : (b - softMax) / Math.max(softMax, 1)
  return Math.max(0, 1 - Math.min(1, dist))
}

const WEIGHTS = {
  //                     skill  text  disc   rep  budget  exactSkill  exactCat  activity
  control:          { skill: 1,    text: 1, disc: 1,    rep: 1, budget: 1, exactSkill: 1.5, exactCat: 1.4, activity: 1 },
  treatment_skill:  { skill: 1.85, text: 1, disc: 1.1, rep: 0.95, budget: 0.85, exactSkill: 2.2, exactCat: 1.8, activity: 1.2 },
  treatment_budget: { skill: 0.9,  text: 1, disc: 1,   rep: 1, budget: 1.75, exactSkill: 1.2, exactCat: 1.2, activity: 0.9 },
} as const

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/**
 * Compatibility score for pairing a creator with a bounty (symmetric use).
 */
export function scoreCreatorBountyPair(
  bounty: BountyFeatures,
  creator: CreatorFeatures,
  strategy: MatchingStrategy = 'control',
  activityConfig?: ActivityBoostConfig,
): MatchScoreBreakdown {
  const w = WEIGHTS[strategy] ?? WEIGHTS.control
  const skillOverlap = skillTagOverlap(bounty, creator)
  const exactSkill = exactSkillOverlap(bounty, creator)
  const exactCat = exactCategoryMatch(bounty, creator)
  const textRel = textRelevance(bounty, creator)
  const disc = disciplineMatch(bounty, creator)
  const rep = reputation(creator)
  const budget = budgetFit(bounty, creator)
  const activity = activityBoost(creator, activityConfig)

  // Base weights (sum to ~1 before strategy multipliers)
  const weighted =
    skillOverlap  * 0.24 * w.skill +
    exactSkill    * 0.20 * w.exactSkill +
    exactCat      * 0.10 * w.exactCat +
    textRel       * 0.16 * w.text +
    disc          * 0.10 * w.disc +
    rep           * 0.12 * w.rep +
    budget        * 0.06 * w.budget +
    activity      * 0.02 * w.activity

  const norm =
    0.24 * w.skill +
    0.20 * w.exactSkill +
    0.10 * w.exactCat +
    0.16 * w.text +
    0.10 * w.disc +
    0.12 * w.rep +
    0.06 * w.budget +
    0.02 * w.activity

  const raw = clamp01(weighted / norm)
  const score = Math.round(raw * 1000) / 10

  const reasons: string[] = []
  if (exactSkill >= 0.6)  reasons.push('Exact skill match with bounty requirements')
  if (exactCat >= 0.5)    reasons.push('Category exactly matches your discipline')
  if (skillOverlap >= 0.35) reasons.push('Strong overlap between bounty tags and your skills')
  if (textRel >= 0.12)    reasons.push('Brief aligns with your profile and bio')
  if (disc >= 0.75)       reasons.push('Category fits your discipline')
  if (rep >= 0.72)        reasons.push('Solid track record on the platform')
  if (budget >= 0.85)     reasons.push('Budget tier fits your experience level')
  if (activity >= 0.6)    reasons.push('Recently active with high response rate')
  if (reasons.length === 0) reasons.push('Exploratory match — review the brief to decide fit')

  return {
    score,
    rawScore: Math.round(raw * 1000) / 10,
    reasons,
    components: {
      skillOverlap:    Math.round(skillOverlap * 100) / 100,
      exactSkill:      Math.round(exactSkill  * 100) / 100,
      exactCategory:   Math.round(exactCat    * 100) / 100,
      textRelevance:   Math.round(textRel     * 100) / 100,
      disciplineMatch: Math.round(disc        * 100) / 100,
      reputation:      Math.round(rep         * 100) / 100,
      budgetFit:       Math.round(budget      * 100) / 100,
      activity:        Math.round(activity    * 100) / 100,
    },
  }
}

export function assignStrategy(userId: string, override?: string | null): MatchingStrategy {
  if (override && MATCHING_STRATEGIES.includes(override as MatchingStrategy)) {
    return override as MatchingStrategy
  }
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0
  }
  const bucket = h % 3
  return MATCHING_STRATEGIES[bucket]!
}

export function rankBountiesForCreator(
  bounties: BountyFeatures[],
  creator: CreatorFeatures,
  strategy: MatchingStrategy,
  limit = 20,
): Array<{ bounty: BountyFeatures; breakdown: MatchScoreBreakdown }> {
  const ranked = bounties
    .map((bounty) => ({
      bounty,
      breakdown: scoreCreatorBountyPair(bounty, creator, strategy),
    }))
    .sort((a, b) => b.breakdown.score - a.breakdown.score)
  return ranked.slice(0, limit)
}

export function rankCreatorsForBounty(
  bounty: BountyFeatures,
  creators: CreatorFeatures[],
  strategy: MatchingStrategy,
  limit = 20,
): Array<{ creator: CreatorFeatures; breakdown: MatchScoreBreakdown }> {
  const ranked = creators
    .map((creator) => ({
      creator,
      breakdown: scoreCreatorBountyPair(bounty, creator, strategy),
    }))
    .sort((a, b) => b.breakdown.score - a.breakdown.score)
  return ranked.slice(0, limit)
}

export interface StrategyInsight {
  strategy: string
  samples: number
  helpfulRate: number | null
}

/**
 * Aggregate helpful rate per strategy for dashboards (A/B readout).
 */
export function aggregateStrategyInsights(
  rows: { strategy: string; helpful: boolean }[],
): StrategyInsight[] {
  const map = new Map<string, { yes: number; no: number }>()
  for (const r of rows) {
    const cur = map.get(r.strategy) ?? { yes: 0, no: 0 }
    if (r.helpful) cur.yes++
    else cur.no++
    map.set(r.strategy, cur)
  }
  return MATCHING_STRATEGIES.map((strategy) => {
    const c = map.get(strategy) ?? { yes: 0, no: 0 }
    const n = c.yes + c.no
    return {
      strategy,
      samples: n,
      helpfulRate: n === 0 ? null : Math.round((c.yes / n) * 1000) / 10,
    }
  })
}
