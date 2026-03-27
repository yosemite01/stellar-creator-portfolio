import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  validateRequest,
  formatZodErrors,
  applicationStatusBodySchema,
} from '@/lib/validators'
import {
  getApplicationById,
  updateApplicationStatus,
  clientCanManageBounty,
  pushNotification,
} from '@/lib/bounty-service'
import { getBountyById } from '@/lib/creators-data'
import { sendApplicantStatusEmail } from '@/lib/bounty-notify-email'

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteParams) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await context.params
  const application = getApplicationById(id)
  if (!application) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  }

  const bounty = getBountyById(application.bountyId)
  if (!bounty) {
    return NextResponse.json({ error: 'Bounty not found' }, { status: 404 })
  }

  const canManage = clientCanManageBounty(session.user.id, session.user.role, bounty)
  if (!canManage && session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const validation = validateRequest(applicationStatusBodySchema, body)
  if (!validation.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: formatZodErrors(validation.errors) },
      { status: 400 },
    )
  }

  const { status } = validation.data
  const result = updateApplicationStatus({
    applicationId: id,
    status,
    actorId: session.user.id,
    actorName: session.user.name || session.user.email || 'Client',
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  pushNotification({
    userId: application.applicantId,
    title: status === 'accepted' ? 'Application accepted' : 'Application update',
    body:
      status === 'accepted'
        ? `Your proposal for "${bounty.title}" was accepted.`
        : `Your application for "${bounty.title}" was not selected.`,
    applicationId: application.id,
    bountyId: bounty.id,
  })

  void (async () => {
    try {
      if (application.applicantEmail) {
        await sendApplicantStatusEmail({
          to: application.applicantEmail,
          name: application.applicantName,
          bountyTitle: bounty.title,
          status,
        })
      }
    } catch (e) {
      console.error('[bounty-applications] status email', e)
    }
  })()

  return NextResponse.json({ application: result.application })
}
