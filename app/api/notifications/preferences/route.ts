import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serverConfig } from '@/lib/config'

const putSchema = z.object({
  emailBountyAlerts: z.boolean().optional(),
  emailApplicationUpdates: z.boolean().optional(),
  emailMessages: z.boolean().optional(),
  emailMarketing: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!serverConfig.db.databaseUrl) {
    return NextResponse.json(
      { error: 'Notification preferences require a configured database' },
      { status: 503 },
    )
  }

  await prisma.notificationPreference.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id },
    update: {},
  })
  const preferences = await prisma.notificationPreference.findUnique({
    where: { userId: session.user.id },
  })
  return NextResponse.json({ preferences })
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!serverConfig.db.databaseUrl) {
    return NextResponse.json(
      { error: 'Notification preferences require a configured database' },
      { status: 503 },
    )
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = putSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const preferences = await prisma.notificationPreference.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...parsed.data },
    update: parsed.data,
  })

  return NextResponse.json({ preferences })
}
