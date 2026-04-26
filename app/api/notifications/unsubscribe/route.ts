import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/** One-click unsubscribe from non-transactional product emails (linked from message footer). */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const appOrigin = process.env.NEXTAUTH_URL ?? request.nextUrl.origin
  const redirectBase = new URL(appOrigin)

  if (!process.env.DATABASE_URL) {
    redirectBase.pathname = '/'
    redirectBase.searchParams.set('unsub', 'unavailable')
    return NextResponse.redirect(redirectBase)
  }

  if (!token) {
    redirectBase.pathname = '/'
    redirectBase.searchParams.set('unsub', 'missing')
    return NextResponse.redirect(redirectBase)
  }

  const user = await prisma.user.findUnique({
    where: { emailUnsubscribeToken: token },
    select: { id: true },
  })

  if (!user) {
    redirectBase.pathname = '/'
    redirectBase.searchParams.set('unsub', 'invalid')
    return NextResponse.redirect(redirectBase)
  }

  await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      emailBountyAlerts: false,
      emailApplicationUpdates: false,
      emailMessages: false,
      emailMarketing: false,
    },
    update: {
      emailBountyAlerts: false,
      emailApplicationUpdates: false,
      emailMessages: false,
      emailMarketing: false,
    },
  })

  redirectBase.pathname = '/'
  redirectBase.searchParams.set('unsub', 'ok')
  return NextResponse.redirect(redirectBase)
}
