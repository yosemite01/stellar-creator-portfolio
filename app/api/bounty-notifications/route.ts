import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  listNotificationsForUser,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/bounty-service'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const notifications = listNotificationsForUser(session.user.id)
  return NextResponse.json({ notifications })
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
    const n = markAllNotificationsRead(session.user.id)
    return NextResponse.json({ updated: n })
  }

  if (body.id) {
    const ok = markNotificationRead(body.id, session.user.id)
    if (!ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Provide id or readAll: true' }, { status: 400 })
}
