import { NextRequest, NextResponse } from 'next/server'

import { isValidCreatorId } from '@/lib/services/creators-data'
import { getCreatorByIdFromDB } from '@/server/services/creators-directory'

type CreatorRouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_request: NextRequest, context: CreatorRouteContext) {
  const { id } = await context.params

  if (!isValidCreatorId(id)) {
    return NextResponse.json(
      { error: 'Invalid creator id' },
      { status: 400 },
    )
  }

  const creator = await getCreatorByIdFromDB(id)
  if (!creator) {
    return NextResponse.json(
      { error: 'Creator not found' },
      { status: 404 },
    )
  }

  return NextResponse.json(
    { data: creator },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  )
}
