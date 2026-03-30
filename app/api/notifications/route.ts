import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  fetchInAppNotifications,
  markInAppNotificationRead,
  markAllInAppNotificationsRead,
  getEmailDeliveryStats,
  listEmailHistoryForUser,
} from '@/lib/notifications'
import {
  listNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/services/bounty-service'

function mapDbNotification(n: {
  id: string
  userId: string
  title: string
  body: string
  read: boolean
  applicationId: string | null
  bountyId: string | null
  createdAt: Date
}) {
  return {
    id: n.id,
    userId: n.userId,
    title: n.title,
    body: n.body,
    read: n.read,
    applicationId: n.applicationId ?? undefined,
    bountyId: n.bountyId ?? undefined,
    createdAt: n.createdAt.toISOString(),
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams

  if (session.user.role === 'ADMIN' && sp.get('deliveryStats') === '1') {
    const deliveryStats = await getEmailDeliveryStats()
    return NextResponse.json({ deliveryStats })
  }

  const rows = await fetchInAppNotifications(session.user.id)
  const notifications =
    rows === null ? listNotificationsForUser(session.user.id) : rows.map(mapDbNotification)

  const out: Record<string, unknown> = { notifications }

  if (sp.get('emailHistory') === '1') {
    out.emailHistory = await listEmailHistoryForUser(session.user.id)
  }

  return NextResponse.json(out)
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; readAll?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.readAll) {
    let dbUpdated = 0
    if (process.env.DATABASE_URL) {
      dbUpdated = await markAllInAppNotificationsRead(session.user.id)
    }
    const memUpdated = markAllNotificationsRead(session.user.id)
    return NextResponse.json({ updated: Math.max(dbUpdated, memUpdated) })
  }

  if (body.id) {
    if (process.env.DATABASE_URL) {
      const c = await markInAppNotificationRead(body.id, session.user.id)
      if (c > 0) {
        markNotificationRead(body.id, session.user.id)
        return NextResponse.json({ success: true })
      }
    }
    const ok = markNotificationRead(body.id, session.user.id)
    if (!ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Provide id or readAll: true' }, { status: 400 })
}
