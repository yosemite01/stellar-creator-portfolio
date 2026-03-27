import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { validateRequest, formatZodErrors, bountyMessageBodySchema } from '@/lib/validators'
import {
  getApplicationById,
  addThreadMessage,
  listThreadMessages,
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

  const messages = listThreadMessages(applicationId)
  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest, context: RouteParams) {
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const validation = validateRequest(bountyMessageBodySchema, body)
  if (!validation.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: formatZodErrors(validation.errors) },
      { status: 400 },
    )
  }

  const result = addThreadMessage({
    applicationId,
    bountyId: bounty.id,
    senderId: session.user.id,
    senderName: session.user.name || session.user.email || 'User',
    senderEmail: session.user.email || '',
    body: validation.data.body,
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ message: result.message }, { status: 201 })
}
