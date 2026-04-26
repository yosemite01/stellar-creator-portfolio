import { NextRequest, NextResponse } from 'next/server'
import { getReviewSummaryForCreator } from '@/lib/review-service'
import type { ReviewSummaryOptions } from '@/lib/review-service'

type RouteContext = {
  params: {
    creatorId: string
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { searchParams } = new URL(request.url)
  const sort = searchParams.get('sort') as ReviewSummaryOptions['sort'] | null
  const filterRating = searchParams.get('filterRating') ? Number(searchParams.get('filterRating')) : undefined
  const page = Number(searchParams.get('page') ?? 1)
  const limit = Number(searchParams.get('limit') ?? 10)

  return NextResponse.json(
    getReviewSummaryForCreator(params.creatorId, {
      sort: sort ?? 'recent',
      filterRating,
      page,
      limit,
    })
  )
}
