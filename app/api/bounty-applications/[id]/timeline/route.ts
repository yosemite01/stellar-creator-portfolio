import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getApplicationById,
  getTimelineForApplication,
  canViewApplication,
} from '@/lib/bounty-service'
import { getBountyById } from '@/lib/creators-data'

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteParams) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: applicationId } = await context.params
  const application = getApplicationById(applicationId)
  const bounty = application ? getBountyById(application.bountyId) : undefined
  if (!application || !bounty) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (
    !canViewApplication(session.user.id, session.user.role, application, bounty)
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const timeline = getTimelineForApplication(applicationId)
  return NextResponse.json({ timeline })
}
