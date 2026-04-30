import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import {
  assignStrategy,
  rankBountiesForCreator,
  rankCreatorsForBounty,
  aggregateStrategyInsights,
  type BountyFeatures,
  type CreatorFeatures,
  type MatchingStrategy,
  MATCHING_STRATEGIES,
} from '@/lib/matching-engine'

const prisma = new PrismaClient()

const feedbackSchema = z.object({
  strategy: z.string(),
  mode: z.enum(['FOR_CREATOR', 'FOR_CLIENT']),
  contextId: z.string().nullable().optional(),
  matchId: z.string().min(1),
  score: z.number().optional(),
  helpful: z.boolean(),
})

function toBountyFeatures(b: {
  id: string
  title: string
  description: string
  budget: number
  category: string | null
  tags: string[]
}): BountyFeatures {
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    budget: b.budget,
    category: b.category,
    tags: b.tags ?? [],
  }
}

function toCreatorFeatures(p: {
  id: string
  userId: string
  displayName: string
  bio: string | null
  discipline: string | null
  skills: string[]
  rating: number
  completedProjects: number
}): CreatorFeatures {
  return {
    profileId: p.id,
    userId: p.userId,
    displayName: p.displayName,
    bio: p.bio,
    discipline: p.discipline,
    skills: p.skills ?? [],
    rating: p.rating,
    completedProjects: p.completedProjects,
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const metrics = searchParams.get('metrics') === '1'

  if (metrics) {
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const rows = await prisma.matchFeedback.findMany({
      select: { strategy: true, helpful: true },
    })
    return NextResponse.json({
      insights: aggregateStrategyInsights(rows),
      totalFeedback: rows.length,
    })
  }

  const role = session.user.role
  const forParam = searchParams.get('for')
  const bountyId = searchParams.get('bountyId')
  const strategyOverride = searchParams.get('strategy')
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') ?? '12') || 12))

  const strategy = assignStrategy(session.user.id, strategyOverride) as MatchingStrategy

  const wantCreatorFeed =
    forParam === 'creator' ||
    (forParam == null && (role === 'CREATOR' || role === 'ADMIN'))

  if (wantCreatorFeed && role !== 'CREATOR' && role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (wantCreatorFeed) {
    const profile = await prisma.creatorProfile.findUnique({
      where: { userId: session.user.id },
    })
    if (!profile) {
      if (role !== 'ADMIN') {
        return NextResponse.json(
          { error: 'Creator profile required', matches: [], strategy },
          { status: 400 },
        )
      }
      /* Admin without creator profile: fall through to client recommendations */
    } else {
      const open = await prisma.bounty.findMany({
        where: {
          status: 'OPEN',
          creatorId: { not: session.user.id },
        },
      })

      const creator = toCreatorFeatures(profile)
      const ranked = rankBountiesForCreator(
        open.map(toBountyFeatures),
        creator,
        strategy,
        limit,
      )

      return NextResponse.json({
        strategy,
        mode: 'FOR_CREATOR' as const,
        matches: ranked.map((r) => ({
          type: 'bounty' as const,
          id: r.bounty.id,
          title: r.bounty.title,
          budget: r.bounty.budget,
          category: r.bounty.category,
          tags: r.bounty.tags,
          score: r.breakdown.score,
          reasons: r.breakdown.reasons,
          components: r.breakdown.components,
          href: '/bounties',
        })),
      })
    }
  }

  if (role !== 'CLIENT' && role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const bounty =
    bountyId != null
      ? await prisma.bounty.findFirst({
          where: {
            id: bountyId,
            creatorId: session.user.id,
            status: 'OPEN',
          },
        })
      : await prisma.bounty.findFirst({
          where: { creatorId: session.user.id, status: 'OPEN' },
          orderBy: { updatedAt: 'desc' },
        })

  if (!bounty) {
    return NextResponse.json({
      strategy,
      mode: 'FOR_CLIENT' as const,
      matches: [],
      message: 'Create an open bounty to see recommended creators.',
    })
  }

  const profiles = await prisma.creatorProfile.findMany({
    where: { userId: { not: session.user.id } },
  })

  const bountyFeat = toBountyFeatures(bounty)
  const ranked = rankCreatorsForBounty(
    bountyFeat,
    profiles.map(toCreatorFeatures),
    strategy,
    limit,
  )

  return NextResponse.json({
    strategy,
    mode: 'FOR_CLIENT' as const,
    contextBounty: {
      id: bounty.id,
      title: bounty.title,
      budget: bounty.budget,
      category: bounty.category,
    },
    matches: ranked.map((r) => ({
      type: 'creator' as const,
      id: r.creator.profileId,
      userId: r.creator.userId,
      title: r.creator.displayName,
      discipline: r.creator.discipline,
      skills: r.creator.skills,
      rating: r.creator.rating,
      completedProjects: r.creator.completedProjects,
      score: r.breakdown.score,
      reasons: r.breakdown.reasons,
      components: r.breakdown.components,
      href: '/creators',
    })),
  })
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = feedbackSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const { strategy, mode, contextId, matchId, score, helpful } = parsed.data
  if (!MATCHING_STRATEGIES.includes(strategy as MatchingStrategy)) {
    return NextResponse.json({ error: 'Unknown strategy' }, { status: 400 })
  }

  await prisma.matchFeedback.create({
    data: {
      userId: session.user.id,
      strategy,
      mode,
      contextId: contextId ?? null,
      matchId,
      score: score ?? null,
      helpful,
    },
  })

  return NextResponse.json({ ok: true })
}
