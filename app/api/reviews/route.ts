import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  createReview,
  getReviewsForCreator,
  calculateAggregate,
  getPendingReviews,
  moderateReview,
  voteOnReview,
} from '@/lib/services/review-service'
import { z } from 'zod'
import { validateRequest, formatZodErrors } from '@/lib/validators'

const createReviewSchema = z.object({
  creatorId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(1).max(100),
  body: z.string().min(10).max(2000),
})

const voteSchema = z.object({
  reviewId: z.string().min(1),
  vote: z.enum(['helpful', 'not_helpful']),
})

const moderateSchema = z.object({
  reviewId: z.string().min(1),
  status: z.enum(['approved', 'rejected']),
})

const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

function checkRateLimit(ip: string, max = 20): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(ip)
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + 60_000 })
    return true
  }
  if (record.count >= max) return false
  record.count++
  return true
}

function getIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'
}

// GET /api/reviews?creatorId=&sort=&filterRating=&page=&limit=
export async function GET(request: NextRequest) {
  const ip = getIp(request)
  if (!checkRateLimit(ip, 60)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const creatorId = searchParams.get('creatorId')

  // Admin: list pending reviews
  if (searchParams.get('pending') === 'true') {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return NextResponse.json({ reviews: getPendingReviews() })
  }

  if (!creatorId) {
    return NextResponse.json({ error: 'creatorId is required' }, { status: 400 })
  }

  const sort = (searchParams.get('sort') as 'recent' | 'helpful' | 'rating_high' | 'rating_low') ?? 'recent'
  const filterRating = searchParams.get('filterRating') ? Number(searchParams.get('filterRating')) : undefined
  const page = Number(searchParams.get('page') ?? 1)
  const limit = Math.min(50, Number(searchParams.get('limit') ?? 10))

  const { reviews, total } = getReviewsForCreator(creatorId, { sort, filterRating, page, limit })

  // Calculate aggregate from all approved reviews (not just current page)
  const { reviews: allReviews } = getReviewsForCreator(creatorId, { limit: 1000 })
  const aggregate = calculateAggregate(allReviews)

  return NextResponse.json({
    reviews,
    aggregate,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}

// POST /api/reviews  - submit a review
// POST /api/reviews?action=vote  - vote helpful/not helpful
// POST /api/reviews?action=moderate  - admin moderation
export async function POST(request: NextRequest) {
  const ip = getIp(request)
  if (!checkRateLimit(ip, 10)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const action = new URL(request.url).searchParams.get('action')
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Vote
  if (action === 'vote') {
    const validation = validateRequest(voteSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', details: formatZodErrors(validation.errors) }, { status: 400 })
    }
    const updated = voteOnReview(validation.data.reviewId, session.user.id, validation.data.vote)
    if (!updated) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    return NextResponse.json({ review: updated })
  }

  // Moderate (admin only)
  if (action === 'moderate') {
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const validation = validateRequest(moderateSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', details: formatZodErrors(validation.errors) }, { status: 400 })
    }
    const updated = moderateReview(validation.data.reviewId, validation.data.status)
    if (!updated) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    return NextResponse.json({ review: updated })
  }

  // Create review
  const validation = validateRequest(createReviewSchema, body)
  if (!validation.success) {
    return NextResponse.json({ error: 'Validation failed', details: formatZodErrors(validation.errors) }, { status: 400 })
  }

  // Basic content moderation: block obvious spam/profanity patterns
  const blockedPatterns = [/<script/i, /javascript:/i]
  if (blockedPatterns.some((p) => p.test(validation.data.body) || p.test(validation.data.title))) {
    return NextResponse.json({ error: 'Review contains disallowed content' }, { status: 422 })
  }

  const review = createReview({
    creatorId: validation.data.creatorId,
    reviewerId: session.user.id,
    reviewerName: session.user.name ?? session.user.email,
    rating: validation.data.rating,
    title: validation.data.title,
    body: validation.data.body,
    isVerifiedPurchase: false, // set true when purchase verification is implemented
  })

  return NextResponse.json({ review }, { status: 201 })
}
