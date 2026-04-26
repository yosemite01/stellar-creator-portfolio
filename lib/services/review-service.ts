/**
 * Review service - handles all review/rating business logic
 * Uses in-memory store (swap for Supabase/Prisma in production)
 */

export interface Review {
  id: string
  creatorId: string
  reviewerId: string
  reviewerName: string
  reviewerAvatar?: string
  rating: number // 1-5
  title: string
  body: string
  isVerifiedPurchase: boolean
  helpfulCount: number
  notHelpfulCount: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  updatedAt: string
}

export interface ReviewVote {
  reviewId: string
  userId: string
  vote: 'helpful' | 'not_helpful'
}

export interface AggregateRating {
  average: number
  total: number
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>
}

// In-memory store (replace with DB calls in production)
const reviewStore = new Map<string, Review>()
const voteStore = new Map<string, ReviewVote>() // key: `${reviewId}:${userId}`

export function calculateAggregate(reviews: Review[]): AggregateRating {
  const approved = reviews.filter((r) => r.status === 'approved')
  const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }

  if (approved.length === 0) {
    return { average: 0, total: 0, breakdown: breakdown as AggregateRating['breakdown'] }
  }

  let sum = 0
  for (const r of approved) {
    sum += r.rating
    breakdown[r.rating] = (breakdown[r.rating] || 0) + 1
  }

  return {
    average: Math.round((sum / approved.length) * 10) / 10,
    total: approved.length,
    breakdown: breakdown as AggregateRating['breakdown'],
  }
}

export function getReviewsForCreator(
  creatorId: string,
  options: {
    sort?: 'recent' | 'helpful' | 'rating_high' | 'rating_low'
    filterRating?: number
    page?: number
    limit?: number
  } = {}
): { reviews: Review[]; total: number } {
  const { sort = 'recent', filterRating, page = 1, limit = 10 } = options

  let reviews = Array.from(reviewStore.values()).filter(
    (r) => r.creatorId === creatorId && r.status === 'approved'
  )

  if (filterRating) {
    reviews = reviews.filter((r) => r.rating === filterRating)
  }

  switch (sort) {
    case 'helpful':
      reviews.sort((a, b) => b.helpfulCount - a.helpfulCount)
      break
    case 'rating_high':
      reviews.sort((a, b) => b.rating - a.rating)
      break
    case 'rating_low':
      reviews.sort((a, b) => a.rating - b.rating)
      break
    case 'recent':
    default:
      reviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  const total = reviews.length
  const paginated = reviews.slice((page - 1) * limit, page * limit)
  return { reviews: paginated, total }
}

export function createReview(
  data: Omit<Review, 'id' | 'helpfulCount' | 'notHelpfulCount' | 'status' | 'createdAt' | 'updatedAt'>
): Review {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const review: Review = {
    ...data,
    id,
    helpfulCount: 0,
    notHelpfulCount: 0,
    status: 'pending', // requires moderation before showing
    createdAt: now,
    updatedAt: now,
  }
  reviewStore.set(id, review)
  return review
}

export function voteOnReview(
  reviewId: string,
  userId: string,
  vote: 'helpful' | 'not_helpful'
): Review | null {
  const review = reviewStore.get(reviewId)
  if (!review) return null

  const voteKey = `${reviewId}:${userId}`
  const existing = voteStore.get(voteKey)

  // Undo previous vote counts
  if (existing) {
    if (existing.vote === 'helpful') review.helpfulCount = Math.max(0, review.helpfulCount - 1)
    else review.notHelpfulCount = Math.max(0, review.notHelpfulCount - 1)
  }

  // Apply new vote (toggle off if same)
  if (existing?.vote === vote) {
    voteStore.delete(voteKey)
  } else {
    voteStore.set(voteKey, { reviewId, userId, vote })
    if (vote === 'helpful') review.helpfulCount++
    else review.notHelpfulCount++
  }

  review.updatedAt = new Date().toISOString()
  reviewStore.set(reviewId, review)
  return review
}

export function moderateReview(reviewId: string, status: 'approved' | 'rejected'): Review | null {
  const review = reviewStore.get(reviewId)
  if (!review) return null
  review.status = status
  review.updatedAt = new Date().toISOString()
  reviewStore.set(reviewId, review)
  return review
}

export function getPendingReviews(): Review[] {
  return Array.from(reviewStore.values()).filter((r) => r.status === 'pending')
}

export function getUserVote(reviewId: string, userId: string): ReviewVote | null {
  return voteStore.get(`${reviewId}:${userId}`) ?? null
}

// Seed some demo data so the UI isn't empty
;(function seedDemoReviews() {
  if (reviewStore.size > 0) return
  const demos: Omit<Review, 'id' | 'helpfulCount' | 'notHelpfulCount' | 'updatedAt'>[] = [
    {
      creatorId: '1',
      reviewerId: 'user-demo-1',
      reviewerName: 'Alex Rivera',
      rating: 5,
      title: 'Exceptional work, highly recommend',
      body: 'Delivered beyond expectations. Communication was clear throughout and the final result was polished and professional.',
      isVerifiedPurchase: true,
      status: 'approved',
      createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    },
    {
      creatorId: '1',
      reviewerId: 'user-demo-2',
      reviewerName: 'Jordan Kim',
      rating: 4,
      title: 'Great quality, minor delays',
      body: 'The work quality was excellent. There were some small timeline delays but the end result was worth it.',
      isVerifiedPurchase: true,
      status: 'approved',
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    },
    {
      creatorId: '1',
      reviewerId: 'user-demo-3',
      reviewerName: 'Sam Chen',
      rating: 5,
      title: 'Would hire again without hesitation',
      body: 'Incredibly talented and easy to work with. Understood the brief immediately and executed perfectly.',
      isVerifiedPurchase: false,
      status: 'approved',
      createdAt: new Date(Date.now() - 21 * 86400000).toISOString(),
    },
  ]

  for (const d of demos) {
    const id = crypto.randomUUID()
    reviewStore.set(id, { ...d, id, helpfulCount: 0, notHelpfulCount: 0, updatedAt: d.createdAt })
  }
})()
