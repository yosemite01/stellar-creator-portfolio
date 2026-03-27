import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  validateRequest,
  formatZodErrors,
  applicationSubmitSchema,
} from '@/lib/validators'
import {
  submitApplication,
  listApplicationsForBounty,
  listApplicationsForApplicant,
  getApplicantCountsForBounties,
  clientCanManageBounty,
  pushNotification,
} from '@/lib/bounty-service'
import { getBountyById, bounties } from '@/lib/creators-data'
import {
  sendApplicantReceivedEmail,
  sendClientNewApplicationEmail,
  getEmailForUserId,
} from '@/lib/bounty-notify-email'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const countsOnly = searchParams.get('counts') === '1'
  if (countsOnly) {
    const ids = bounties.map((b) => b.id)
    const counts = getApplicantCountsForBounties(ids)
    return NextResponse.json({ counts })
  }

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bountyId = searchParams.get('bounty_id')
  const applicantMe = searchParams.get('applicant') === 'me'

  if (applicantMe) {
    if (session.user.role !== 'CREATOR' && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const applications = listApplicationsForApplicant(session.user.id)
    return NextResponse.json({ applications })
  }

  if (bountyId) {
    const bounty = getBountyById(bountyId)
    if (!bounty) {
      return NextResponse.json({ error: 'Bounty not found' }, { status: 404 })
    }
    const canManage = clientCanManageBounty(session.user.id, session.user.role, bounty)
    if (!canManage && session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const applications = listApplicationsForBounty(bountyId)
    return NextResponse.json({ applications })
  }

  return NextResponse.json(
    { error: 'Specify applicant=me or bounty_id' },
    { status: 400 },
  )
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (session.user.role !== 'CREATOR' && session.user.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Only creator accounts can submit applications' },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const validation = validateRequest(applicationSubmitSchema, body)
  if (!validation.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: formatZodErrors(validation.errors) },
      { status: 400 },
    )
  }

  const { bounty_id, proposed_budget, timeline, proposal } = validation.data
  const bounty = getBountyById(bounty_id)
  if (!bounty) {
    return NextResponse.json({ error: 'Bounty not found' }, { status: 404 })
  }

  const result = submitApplication({
    bountyId: bounty_id,
    applicantId: session.user.id,
    applicantName: session.user.name || session.user.email || 'Creator',
    applicantEmail: session.user.email || '',
    proposedBudget: proposed_budget,
    timelineDays: timeline,
    proposal,
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const { application } = result

  pushNotification({
    userId: session.user.id,
    title: 'Application submitted',
    body: `Your proposal for "${bounty.title}" was sent to the client.`,
    applicationId: application.id,
    bountyId: bounty.id,
  })

  if (bounty.ownerUserId) {
    pushNotification({
      userId: bounty.ownerUserId,
      title: 'New bounty application',
      body: `${application.applicantName} applied to "${bounty.title}".`,
      applicationId: application.id,
      bountyId: bounty.id,
    })
  }

  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  void (async () => {
    try {
      if (session.user.email) {
        await sendApplicantReceivedEmail({
          to: session.user.email,
          name: session.user.name || 'there',
          bountyTitle: bounty.title,
        })
      }
    } catch (e) {
      console.error('[bounty-applications] applicant email', e)
    }

    try {
      let clientEmail: string | null = null
      let clientName = 'there'
      if (bounty.ownerUserId) {
        clientEmail = await getEmailForUserId(bounty.ownerUserId)
        clientName = clientEmail?.split('@')[0] ?? clientName
      }
      if (!clientEmail && process.env.BOUNTY_NOTIFY_EMAIL) {
        clientEmail = process.env.BOUNTY_NOTIFY_EMAIL
      }
      if (clientEmail) {
        await sendClientNewApplicationEmail({
          to: clientEmail,
          name: clientName,
          bountyTitle: bounty.title,
          applicantName: application.applicantName,
          bountyId: bounty.id,
        })
      }
    } catch (e) {
      console.error('[bounty-applications] client email', e)
    }
  })()

  return NextResponse.json(
    {
      application,
      bounty: {
        id: bounty.id,
        title: bounty.title,
        status: bounty.status,
      },
      message: `Application submitted successfully. View progress in your dashboard: ${appUrl}/dashboard/applications`,
    },
    { status: 201 },
  )
}
